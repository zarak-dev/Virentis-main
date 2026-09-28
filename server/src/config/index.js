/**
 * VIRentis — Centralized Configuration
 *
 * Single source of truth for all configurable constants.
 * Extracted from: inference.js, database.js, app.js
 *
 * IMPORTANT: These values are coupled to the trained model.
 * Do NOT change IMAGE_SIZE, IMAGENET_MEAN, IMAGENET_STD, or NUM_CLASSES
 * unless you retrain and re-export the ONNX model.
 */
const path = require('path');

const config = {
  // ── Server ──
  port: process.env.PORT || 3001,

  // ── Model ──
  model: {
    path: path.join(__dirname, '..', 'models', 'swin_v2_mvp_quantized.onnx'),
    name: 'swin_v2_mvp_quantized',
    version: '1.0.0',
    imageSize: 256,
    channels: 3,
    numClasses: 38,
  },

  // ── ImageNet normalization (MUST match training pipeline) ──
  imagenet: {
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },

  // ── Blur detection ──
  blur: {
    threshold: 100,
    analysisSize: 256,
  },

  // ── TTA (Test-Time Augmentation) ──
  tta: {
    enabled: true,
    variants: 3, // original, horizontal flip, 90° rotation
  },

  // ── Upload limits ──
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  },

  // ── Database ──
  database: {
    path: path.join(__dirname, '..', 'data', 'treatments.db'),
  },

  // ── Confidence thresholds ──
  confidence: {
    high: 80,
    moderate: 50,
  },
};

module.exports = config;
