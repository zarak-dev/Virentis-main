/**
 * VIRentis — Express App Factory
 *
 * Single source of truth for all Express routes, middleware, and business logic.
 * Eliminates route duplication between dev server and Electron.
 */
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const config = require('./config');
const {
  diagnoseImageWithTTA,
  diagnoseImage,
  validateImageQuality,
  preWarmModel,
} = require('./ml/inference');
const {
  getTreatmentByCommonName,
  getAllTreatments,
  getSpeciesList,
  searchKnowledge,
  saveDiagnosisHistory,
  getDiagnosisHistory,
  getDiagnosisHistoryById,
  deleteDiagnosisHistory,
  clearDiagnosisHistory,
  getStats,
  getSettings,
  updateSettings,
} = require('./database/connection');
const { sendSuccess, sendError, errors } = require('./utils/response');

/**
 * Create and configure the Express application.
 *
 * @param {Object} [options]
 * @param {boolean} [options.serveStaticClient=false] - Serve built React client (for Electron/production)
 * @returns {import('express').Application}
 */
function createApp(options = {}) {
  const app = express();

  // ── Middleware ──
  app.use(cors());
  app.use(express.json({ limit: '15mb' }));

  // Serve the built React frontend (Electron / production mode)
  if (options.serveStaticClient) {
    const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
    app.use(express.static(clientDist));
  }

  // ── Multer upload config ──
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.upload.maxFileSize },
    fileFilter: (_req, file, cb) => {
      if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only JPEG, PNG, WebP and HEIC images are allowed'));
      }
    },
  });

  // ── System Health & Model Status ──
  app.get('/api/health', (_req, res) => {
    try {
      const stats = getStats();
      sendSuccess(res, {
        status: 'online',
        product: 'VIRentis',
        tagline: 'Intelligent Crop Health & Disease Analysis',
        version: '1.0.0',
        model: {
          name: config.model.name,
          version: config.model.version,
          architecture: 'Swin Transformer V2 Quantized',
          runtime: 'ONNX Runtime Node',
          classes: config.model.numClasses,
          imageResolution: `${config.model.imageSize}x${config.model.imageSize}`,
        },
        uptime: process.uptime(),
        database: 'SQLite (WAL mode)',
        totalDiagnoses: stats.totalDiagnoses,
      });
    } catch (err) {
      errors.internalError(res, err.message);
    }
  });

  // ── GET /api/species ──
  app.get('/api/species', (_req, res) => {
    try {
      const species = getSpeciesList();
      sendSuccess(res, species);
    } catch (err) {
      console.error('Species list error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── POST /api/diagnose ──
  app.post('/api/diagnose', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return errors.missingImage(res);
      }

      const species = req.body.species;
      if (!species) {
        return errors.missingSpecies(res);
      }

      const currentSettings = getSettings();
      const blurThreshold = currentSettings.blurThreshold || config.blur.threshold;
      const ttaEnabled = currentSettings.ttaEnabled !== undefined ? currentSettings.ttaEnabled : config.tta.enabled;

      // Step 1: Comprehensive Image Quality Assessment
      const quality = await validateImageQuality(req.file.buffer, { blurThreshold });
      if (!quality.valid) {
        return sendError(res, 422, quality.code || 'IMAGE_QUALITY_ERROR', quality.reason, quality.metrics);
      }

      // Step 2: Run Inference (TTA or single pass based on settings)
      const startTime = Date.now();
      const diagnosis = ttaEnabled
        ? await diagnoseImageWithTTA(req.file.buffer, species)
        : await diagnoseImage(req.file.buffer, species);
      const processingTimeMs = Date.now() - startTime;

      // Step 3: Look up treatment
      const treatment = getTreatmentByCommonName(diagnosis.commonName) || {
        common_name: diagnosis.commonName,
        symptoms: 'No detailed symptom data available in database.',
        cultural_control: 'Consult local agricultural extension services.',
        chemical_control: 'Consult local agricultural extension services and adhere to state/federal pesticide label instructions.',
        biological_control: 'Encourage natural predators and maintain soil microbial diversity.',
        prevention: 'Regularly inspect crops, sanitize pruning tools, and practice crop rotation.',
      };

      // Step 4: Create base64 thumbnail for offline persistent history
      let imageData = null;
      try {
        const mimeType = req.file.mimetype || 'image/jpeg';
        imageData = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
      } catch (e) {
        console.warn('Failed to encode image thumbnail:', e.message);
      }

      // Step 5: Save to SQLite diagnosis history
      let savedRecord = null;
      try {
        savedRecord = saveDiagnosisHistory({
          speciesKey: diagnosis.speciesKey,
          speciesName: diagnosis.speciesName,
          diseaseKey: diagnosis.diseaseKey,
          diseaseName: diagnosis.diseaseName,
          commonName: diagnosis.commonName,
          confidence: diagnosis.confidence,
          confidenceLevel: diagnosis.confidenceLevel,
          isHealthy: diagnosis.isHealthy,
          classIndex: diagnosis.classIndex,
          logit: diagnosis.logit,
          processingTimeMs,
          imageData,
          blurScore: quality.metrics?.sharpnessScore,
          alternatives: diagnosis.alternatives,
          treatment,
          modelName: diagnosis.modelName,
          modelVersion: diagnosis.modelVersion,
          notes: req.body.notes || '',
        });
      } catch (dbErr) {
        console.error('Failed to auto-save diagnosis record:', dbErr.message);
      }

      // Step 6: Assemble API response
      sendSuccess(res, {
        id: savedRecord?.id || null,
        timestamp: savedRecord?.timestamp || new Date().toISOString(),
        species: diagnosis.speciesKey,
        speciesName: diagnosis.speciesName,
        classIndex: diagnosis.classIndex,
        diseaseKey: diagnosis.diseaseKey,
        diseaseName: diagnosis.diseaseName,
        commonName: diagnosis.commonName,
        isHealthy: diagnosis.isHealthy,
        logit: diagnosis.logit,
        confidence: diagnosis.confidence,
        confidenceLevel: diagnosis.confidenceLevel,
        isLowConfidence: diagnosis.isLowConfidence,
        alternatives: diagnosis.alternatives,
        processingTimeMs,
        treatment,
        imageQuality: quality.metrics,
        model: {
          name: diagnosis.modelName,
          version: diagnosis.modelVersion,
          ttaUsed: diagnosis.ttaUsed,
        },
      });
    } catch (err) {
      console.error('Diagnosis error:', err);
      errors.inferenceError(res);
    }
  });

  // ── GET /api/history ──
  app.get('/api/history', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = parseInt(req.query.offset, 10) || 0;
      const species = req.query.species || 'all';
      const search = req.query.search || '';

      const history = getDiagnosisHistory({ limit, offset, species, search });
      sendSuccess(res, history);
    } catch (err) {
      console.error('History fetch error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── GET /api/history/:id ──
  app.get('/api/history/:id', (req, res) => {
    try {
      const record = getDiagnosisHistoryById(req.params.id);
      if (!record) {
        return errors.notFound(res, 'Diagnosis record');
      }
      sendSuccess(res, record);
    } catch (err) {
      console.error('History record error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── DELETE /api/history/:id ──
  app.delete('/api/history/:id', (req, res) => {
    try {
      const deleted = deleteDiagnosisHistory(req.params.id);
      if (!deleted) {
        return errors.notFound(res, 'Diagnosis record');
      }
      sendSuccess(res, { deleted: true, id: req.params.id });
    } catch (err) {
      console.error('History delete error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── DELETE /api/history ──
  app.delete('/api/history', (_req, res) => {
    try {
      const count = clearDiagnosisHistory();
      sendSuccess(res, { cleared: true, count });
    } catch (err) {
      console.error('History clear error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── GET /api/stats ──
  app.get('/api/stats', (_req, res) => {
    try {
      const stats = getStats();
      sendSuccess(res, stats);
    } catch (err) {
      console.error('Stats fetch error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── GET /api/knowledge ──
  app.get('/api/knowledge', (_req, res) => {
    try {
      const treatments = getAllTreatments();
      sendSuccess(res, treatments);
    } catch (err) {
      console.error('Knowledge fetch error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── GET /api/knowledge/search ──
  app.get('/api/knowledge/search', (req, res) => {
    try {
      const query = req.query.q || '';
      const results = searchKnowledge(query);
      sendSuccess(res, results);
    } catch (err) {
      console.error('Knowledge search error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── GET /api/settings ──
  app.get('/api/settings', (_req, res) => {
    try {
      const settings = getSettings();
      sendSuccess(res, settings);
    } catch (err) {
      console.error('Settings fetch error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── POST /api/settings ──
  app.post('/api/settings', (req, res) => {
    try {
      const newSettings = req.body;
      if (!newSettings || typeof newSettings !== 'object') {
        return sendError(res, 400, 'INVALID_SETTINGS', 'Settings payload must be an object.');
      }
      const updated = updateSettings(newSettings);
      sendSuccess(res, updated);
    } catch (err) {
      console.error('Settings update error:', err);
      errors.internalError(res, err.message);
    }
  });

  // ── Serve React SPA fallback (Electron / production mode) ──
  if (options.serveStaticClient) {
    const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // ── Global error handler ──
  app.use((err, _req, res, _next) => {
    console.error('Unhandled server error:', err);
    errors.internalError(res, err.message || 'An unexpected error occurred.');
  });

  return app;
}

module.exports = { createApp };
