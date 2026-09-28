/**
 * VIRentis — Image Quality Assessment & Blur Detection
 *
 * Implements:
 * 1. Laplacian Variance method for image sharpness / blur detection
 * 2. Resolution / dimension validation
 * 3. Exposure / lighting validation (under-exposed / over-exposed check)
 */
const sharp = require('sharp');
const config = require('../config');

const { threshold: DEFAULT_BLUR_THRESHOLD, analysisSize: BLUR_SIZE } = config.blur;

/**
 * Check whether an image is too blurry for reliable inference.
 *
 * @param {Buffer} imageBuffer - Raw image file buffer
 * @param {number} [threshold] - Override default blur threshold
 * @returns {Promise<{blurry: boolean, variance: number, threshold: number}>}
 */
async function checkBlur(imageBuffer, threshold = DEFAULT_BLUR_THRESHOLD) {
  const { data } = await sharp(imageBuffer)
    .rotate()
    .resize(BLUR_SIZE, BLUR_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = BLUR_SIZE;
  const h = BLUR_SIZE;
  const laplacian = new Float32Array((w - 2) * (h - 2));
  let sum = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const val =
        data[(y - 1) * w + x] +
        data[(y + 1) * w + x] +
        data[y * w + (x - 1)] +
        data[y * w + (x + 1)] -
        4 * data[y * w + x];
      const idx = (y - 1) * (w - 2) + (x - 1);
      laplacian[idx] = val;
      sum += val;
    }
  }

  const n = laplacian.length;
  const mean = sum / n;
  let varianceSum = 0;
  for (let i = 0; i < n; i++) {
    const diff = laplacian[i] - mean;
    varianceSum += diff * diff;
  }
  const variance = varianceSum / n;

  return {
    blurry: variance < threshold,
    variance: Math.round(variance * 100) / 100,
    threshold,
  };
}

/**
 * Validate comprehensive image quality before feeding into ML inference.
 *
 * @param {Buffer} imageBuffer - Raw image file buffer
 * @param {Object} [options]
 * @param {number} [options.blurThreshold]
 * @returns {Promise<{valid: boolean, code?: string, reason?: string, metrics: Object}>}
 */
async function validateImageQuality(imageBuffer, options = {}) {
  const threshold = options.blurThreshold !== undefined ? options.blurThreshold : DEFAULT_BLUR_THRESHOLD;

  // 1. Check metadata and dimensions
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height || metadata.width < 128 || metadata.height < 128) {
    return {
      valid: false,
      code: 'LOW_RESOLUTION',
      reason: `Image resolution (${metadata.width || 0}x${metadata.height || 0}) is too low. A minimum resolution of 128x128 pixels is required for accurate feature extraction.`,
      metrics: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      },
    };
  }

  // 2. Check exposure / brightness
  const stats = await image.stats();
  // Compute overall mean brightness across available channels
  const channelMeans = stats.channels.slice(0, 3).map((c) => c.mean);
  const brightness = Math.round(channelMeans.reduce((a, b) => a + b, 0) / channelMeans.length);

  if (brightness < 20) {
    return {
      valid: false,
      code: 'TOO_DARK',
      reason: 'Image is too dark or underexposed. Please capture another photo in well-lit natural daylight or even lighting.',
      metrics: {
        width: metadata.width,
        height: metadata.height,
        brightness,
        format: metadata.format,
      },
    };
  }

  if (brightness > 245) {
    return {
      valid: false,
      code: 'TOO_BRIGHT',
      reason: 'Image is overexposed or washed out with excessive glare. Please angle the camera to avoid harsh direct reflections.',
      metrics: {
        width: metadata.width,
        height: metadata.height,
        brightness,
        format: metadata.format,
      },
    };
  }

  // 3. Check sharpness / blur
  const blurResult = await checkBlur(imageBuffer, threshold);
  if (blurResult.blurry) {
    return {
      valid: false,
      code: 'IMAGE_TOO_BLURRY',
      reason: 'Image quality is insufficient for reliable analysis. The leaf appears too blurry. Please capture another photo with sharp focus on the leaf surface.',
      metrics: {
        width: metadata.width,
        height: metadata.height,
        brightness,
        sharpnessScore: blurResult.variance,
        sharpnessThreshold: blurResult.threshold,
        format: metadata.format,
      },
    };
  }

  return {
    valid: true,
    metrics: {
      width: metadata.width,
      height: metadata.height,
      brightness,
      sharpnessScore: blurResult.variance,
      sharpnessThreshold: blurResult.threshold,
      format: metadata.format,
    },
  };
}

module.exports = {
  checkBlur,
  validateImageQuality,
};
