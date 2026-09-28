/**
 * VIRentis — Postprocessing Utilities
 *
 * Extracted from: inference.js (softmax, maskedArgmax)
 *
 * These functions transform raw model logits into actionable predictions.
 * The species-masking approach is critical: the model outputs 38 logits,
 * but we only consider indices valid for the user-selected species.
 */
const { prettifyLabel } = require('../utils/label');

/**
 * Compute softmax probabilities from logits.
 * Uses the log-sum-exp trick for numerical stability.
 *
 * @param {number[]} logits - Array of raw model output logits
 * @returns {number[]} Probability distribution (sums to 1.0)
 */
function softmax(logits) {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => (l === -Infinity ? 0 : Math.exp(l - maxLogit)));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  if (sumExps === 0) return logits.map(() => 0);
  return exps.map((e) => e / sumExps);
}

/**
 * Find the argmax among only the valid (species-relevant) indices.
 *
 * All non-valid indices are set to -Infinity before comparison,
 * ensuring the model can never predict a disease from a different species.
 *
 * @param {Float32Array | number[]} logits - Full 38-class logit array
 * @param {number[]} validIndices - Indices valid for the selected species
 * @returns {{ index: number, value: number, maskedLogits: Float32Array }}
 */
function maskedArgmax(logits, validIndices) {
  const maskedLogits = new Float32Array(logits.length);
  maskedLogits.fill(Number.NEGATIVE_INFINITY);

  for (const idx of validIndices) {
    maskedLogits[idx] = logits[idx];
  }

  let bestIndex = -1;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let idx = 0; idx < maskedLogits.length; idx += 1) {
    const value = maskedLogits[idx];
    if (value > bestValue) {
      bestValue = value;
      bestIndex = idx;
    }
  }

  return { index: bestIndex, value: bestValue, maskedLogits };
}

/**
 * Compute confidence percentage from logits for a specific class index,
 * considering only valid species indices.
 *
 * @param {Float32Array | number[]} logits - Full 38-class logit array
 * @param {number[]} validIndices - Indices valid for the selected species
 * @param {number} targetIndex - The predicted class index
 * @returns {number} Confidence as percentage (0-100, 2 decimal places)
 */
function computeConfidence(logits, validIndices, targetIndex) {
  const maskedForSoftmax = Array.from(logits).map((v, i) =>
    validIndices.includes(i) ? v : -Infinity
  );
  const probs = softmax(maskedForSoftmax);
  return Math.round(probs[targetIndex] * 10000) / 100;
}

/**
 * Get sorted Top-K predictions for the selected species.
 *
 * @param {Float32Array | number[]} logits - Full 38-class logit array
 * @param {string} speciesKey - Key of the species
 * @param {Object} speciesMap - Mapping of diseaseKey to classIndex
 * @param {number} [k=3] - Number of top predictions to return
 * @returns {{ primary: Object, alternatives: Object[] }}
 */
function getTopPredictions(logits, speciesKey, speciesMap, k = 3) {
  const validIndices = Object.values(speciesMap);
  const maskedForSoftmax = Array.from(logits).map((v, i) =>
    validIndices.includes(i) ? v : -Infinity
  );
  const probs = softmax(maskedForSoftmax);

  const speciesName = prettifyLabel(speciesKey);

  // Build ranked list for all diseases of this species
  const candidates = Object.entries(speciesMap).map(([diseaseKey, classIndex]) => {
    const diseaseName = prettifyLabel(diseaseKey);
    const confidence = Math.round(probs[classIndex] * 10000) / 100;
    const isHealthy = diseaseKey.toLowerCase().includes('healthy');

    return {
      speciesKey,
      speciesName,
      diseaseKey,
      diseaseName,
      commonName: `${speciesName} ${diseaseName}`,
      classIndex,
      confidence,
      logit: logits[classIndex],
      isHealthy,
    };
  });

  candidates.sort((a, b) => b.confidence - a.confidence);

  const primary = candidates[0];
  const alternatives = candidates.slice(1, k);

  return { primary, alternatives };
}

module.exports = {
  softmax,
  maskedArgmax,
  computeConfidence,
  getTopPredictions,
};
