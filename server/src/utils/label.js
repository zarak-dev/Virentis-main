/**
 * VIRentis — Label Utilities
 *
 * Single source of truth for label formatting.
 * Previously duplicated in inference.js and database.js
 */

/**
 * Convert a raw manifest key (e.g. "cedar_apple_rust") into a display-friendly label
 * (e.g. "Cedar Apple Rust").
 *
 * Handles: underscores, parentheses, commas, extra whitespace.
 *
 * @param {string} label - Raw key from plant_manifest.json
 * @returns {string} Prettified display label
 */
function prettifyLabel(label) {
  return label
    .replace(/_/g, ' ')
    .replace(/[(),]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Derive the confidence level from a numeric score.
 *
 * @param {number} score - Confidence percentage (0-100)
 * @returns {'high' | 'moderate' | 'low'}
 */
function getConfidenceLevel(score) {
  if (score >= 80) return 'high';
  if (score >= 50) return 'moderate';
  return 'low';
}

module.exports = {
  prettifyLabel,
  getConfidenceLevel,
};
