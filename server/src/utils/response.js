/**
 * VIRentis — Standardized API Response Helpers
 *
 * All API endpoints MUST use these helpers to ensure consistent response format.
 *
 * Success: { data: T }
 * Error:   { error: { code: string, message: string, details?: any } }
 */

/**
 * Send a success response.
 *
 * @param {import('express').Response} res
 * @param {any} data - Response payload
 * @param {number} [statusCode=200]
 */
function sendSuccess(res, data, statusCode = 200) {
  res.status(statusCode).json({ data });
}

/**
 * Send an error response.
 *
 * @param {import('express').Response} res
 * @param {number} statusCode - HTTP status code
 * @param {string} code - Machine-readable error code (e.g. 'MISSING_IMAGE')
 * @param {string} message - Human-readable error message
 * @param {any} [details] - Optional additional details
 */
function sendError(res, statusCode, code, message, details) {
  const error = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  res.status(statusCode).json({ error });
}

/**
 * Common error responses
 */
const errors = {
  missingImage: (res) =>
    sendError(res, 400, 'MISSING_IMAGE', 'No image file was uploaded.'),

  missingSpecies: (res) =>
    sendError(res, 400, 'MISSING_SPECIES', 'Species parameter is required.'),

  invalidSpecies: (res, species) =>
    sendError(res, 400, 'INVALID_SPECIES', `Unknown species: '${species}'.`),

  invalidFileType: (res) =>
    sendError(res, 400, 'INVALID_FILE_TYPE', 'Only JPEG, PNG, and WebP images are accepted.'),

  fileTooLarge: (res) =>
    sendError(res, 413, 'FILE_TOO_LARGE', 'Image must be under 10MB.'),

  imageTooBlurry: (res, variance, threshold) =>
    sendError(
      res,
      422,
      'IMAGE_TOO_BLURRY',
      'Image is too blurry for reliable analysis. Please retake with a clearer, well-focused photo.',
      { variance, threshold }
    ),

  inferenceError: (res) =>
    sendError(res, 500, 'INFERENCE_ERROR', 'Model inference failed. Please try again.'),

  notFound: (res, resource = 'Resource') =>
    sendError(res, 404, 'NOT_FOUND', `${resource} not found.`),

  internalError: (res, message = 'An unexpected error occurred.') =>
    sendError(res, 500, 'INTERNAL_ERROR', message),
};

module.exports = {
  sendSuccess,
  sendError,
  errors,
};
