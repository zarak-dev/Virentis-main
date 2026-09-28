/**
 * VIRentis — ONNX Inference Engine
 *
 * Refactored from: inference.js (monolith → focused module)
 *
 * Handles ONNX session management, image preprocessing orchestration,
 * TTA variant execution, and top-K prediction aggregation with model metadata.
 */
const ort = require('onnxruntime-node');
const config = require('../config');
const manifest = require('../plant_manifest.json');
const { imageBufferToTensor, createTTATensors } = require('./preprocessing');
const { maskedArgmax, computeConfidence, getTopPredictions } = require('./postprocessing');
const { checkBlur, validateImageQuality } = require('./blur-detection');
const { prettifyLabel, getConfidenceLevel } = require('../utils/label');

// ─── Model Session (Lazy Singleton) ─────────────────────────────────────────

let sessionPromise;

/**
 * Get (or create) the ONNX inference session.
 * The session is created lazily on first call and reused thereafter.
 *
 * @returns {Promise<import('onnxruntime-node').InferenceSession>}
 */
function getSession() {
  if (!sessionPromise) {
    console.log(`🔄 Loading ONNX model: ${config.model.name}`);
    const startTime = Date.now();
    sessionPromise = ort.InferenceSession.create(config.model.path).then((session) => {
      console.log(`✅ Model loaded in ${Date.now() - startTime}ms`);
      return session;
    });
  }
  return sessionPromise;
}

/**
 * Pre-warm the model by loading the session eagerly.
 */
async function preWarmModel() {
  await getSession();
}

// ─── Species Manifest ───────────────────────────────────────────────────────

/**
 * Get the disease-to-index mapping for a species.
 *
 * @param {string} speciesKey - Key from plant_manifest.json (e.g. "tomato")
 * @returns {Object} Map of disease keys to class indices
 * @throws {Error} If species key is unknown
 */
function getSpeciesMap(speciesKey) {
  const speciesMap = manifest[speciesKey];
  if (!speciesMap) {
    throw new Error(`Unknown species key: ${speciesKey}`);
  }
  return speciesMap;
}

// ─── Single Inference ───────────────────────────────────────────────────────

/**
 * Run a single inference pass (no TTA).
 *
 * @param {Buffer} imageBuffer - Raw image file buffer
 * @param {string} speciesKey - Species key from manifest
 * @returns {Promise<Object>} Diagnosis result
 */
async function diagnoseImage(imageBuffer, speciesKey) {
  const session = await getSession();
  const tensor = await imageBufferToTensor(imageBuffer);
  const speciesMap = getSpeciesMap(speciesKey);

  const feeds = { [session.inputNames[0]]: tensor };
  const outputs = await session.run(feeds);
  const logits = outputs[session.outputNames[0]].data;

  const { primary, alternatives } = getTopPredictions(logits, speciesKey, speciesMap, 4);

  return {
    ...primary,
    confidenceLevel: getConfidenceLevel(primary.confidence),
    isLowConfidence: primary.confidence < 45,
    alternatives,
    modelName: config.model.name,
    modelVersion: config.model.version,
    ttaUsed: false,
  };
}

// ─── TTA Inference ──────────────────────────────────────────────────────────

/**
 * Run TTA inference: 3 geometric variants, logit averaging, then masked classification.
 *
 * @param {Buffer} imageBuffer - Raw image file buffer
 * @param {string} speciesKey - Species key from manifest
 * @returns {Promise<Object>} Diagnosis result with averaged confidence and alternatives
 */
async function diagnoseImageWithTTA(imageBuffer, speciesKey) {
  const session = await getSession();
  const speciesMap = getSpeciesMap(speciesKey);
  const numClasses = config.model.numClasses;

  // Create 3 geometric variants and run them through the model
  const tensors = await createTTATensors(imageBuffer);

  const results = await Promise.all(
    tensors.map((t) => session.run({ [session.inputNames[0]]: t }))
  );

  // Average raw logits (Approach B: average before softmax)
  const avgLogits = new Float32Array(numClasses);
  for (const output of results) {
    const logits = output[session.outputNames[0]].data;
    for (let i = 0; i < numClasses; i++) {
      avgLogits[i] += logits[i] / results.length;
    }
  }

  const { primary, alternatives } = getTopPredictions(avgLogits, speciesKey, speciesMap, 4);

  return {
    ...primary,
    confidenceLevel: getConfidenceLevel(primary.confidence),
    isLowConfidence: primary.confidence < 45,
    alternatives,
    modelName: config.model.name,
    modelVersion: config.model.version,
    ttaUsed: true,
  };
}

module.exports = {
  getSession,
  preWarmModel,
  diagnoseImage,
  diagnoseImageWithTTA,
  checkBlur,
  validateImageQuality,
};
