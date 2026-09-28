/**
 * VIRentis — Frontend Constants
 *
 * Centralized constants for the frontend application.
 * Replaces magic values scattered throughout App.tsx.
 */

/**
 * Confidence level thresholds (must match backend config).
 */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 80,
  MODERATE: 50,
} as const;

/**
 * Accepted image file types for upload.
 */
export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

/**
 * Maximum upload file size (10MB, must match backend config).
 */
export const MAX_FILE_SIZE_MB = 10;

/**
 * Application metadata.
 */
export const APP = {
  NAME: 'VIRentis',
  TAGLINE: 'Intelligent Crop Health & Disease Analysis',
  MODEL_NAME: 'Swin Transformer V2',
  RUNTIME: 'ONNX Runtime',
  VERSION: '1.0.0',
} as const;
