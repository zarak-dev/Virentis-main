/**
 * VIRentis — Image Preprocessing
 *
 * Extracted from: inference.js (preprocessImageToTensor + rawBufferToTensor)
 *
 * CRITICAL: These functions produce the tensor format expected by the Swin V2 model.
 * The normalization constants, image size, and channel ordering (CHW) MUST match
 * the training pipeline exactly. Any change will silently degrade accuracy.
 *
 * Layout: [1, C, H, W] float32 tensor with ImageNet normalization
 */
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const config = require('../config');

const { imageSize: IMAGE_SIZE, channels: CHANNELS } = config.model;
const { mean: IMAGENET_MEAN, std: IMAGENET_STD } = config.imagenet;

/**
 * Convert a raw image buffer into a normalized [1, C, H, W] float32 tensor
 * ready for ONNX inference.
 *
 * Pipeline:
 * 1. EXIF-aware rotation (sharp .rotate())
 * 2. Resize to 256×256 (fill, no padding)
 * 3. Remove alpha channel
 * 4. Normalize: (pixel/255 - mean) / std per channel
 * 5. Rearrange from HWC (sharp output) to CHW (model input)
 *
 * @param {Buffer} imageBuffer - Raw image file buffer (JPEG, PNG, WebP)
 * @returns {Promise<import('onnxruntime-node').Tensor>} Float32 tensor [1, 3, 256, 256]
 */
async function imageBufferToTensor(imageBuffer) {
  const { data } = await sharp(imageBuffer)
    .rotate()
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return rawPixelsToTensor(data);
}

/**
 * Convert raw pixel buffer (HWC, uint8) to normalized CHW float32 tensor.
 *
 * This is the inner function used by both direct preprocessing and TTA variants.
 *
 * @param {Buffer} data - Raw pixel data from sharp (HWC format, uint8)
 * @returns {import('onnxruntime-node').Tensor} Float32 tensor [1, 3, 256, 256]
 */
function rawPixelsToTensor(data) {
  const pixelsPerChannel = IMAGE_SIZE * IMAGE_SIZE;
  const tensorData = new Float32Array(CHANNELS * pixelsPerChannel);

  for (let y = 0; y < IMAGE_SIZE; y += 1) {
    for (let x = 0; x < IMAGE_SIZE; x += 1) {
      const hwIndex = y * IMAGE_SIZE + x;
      const bufferIndex = hwIndex * CHANNELS;

      const r = data[bufferIndex] / 255;
      const g = data[bufferIndex + 1] / 255;
      const b = data[bufferIndex + 2] / 255;

      tensorData[hwIndex] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
      tensorData[pixelsPerChannel + hwIndex] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
      tensorData[2 * pixelsPerChannel + hwIndex] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    }
  }

  return new ort.Tensor('float32', tensorData, [1, CHANNELS, IMAGE_SIZE, IMAGE_SIZE]);
}

/**
 * Create TTA (Test-Time Augmentation) variant buffers from an image.
 *
 * Produces 3 geometric variants:
 * 1. Original (resized, alpha-removed)
 * 2. Horizontal flip (flop in sharp)
 * 3. 90° clockwise rotation (re-resized to maintain dimensions)
 *
 * @param {Buffer} imageBuffer - Raw image file buffer
 * @returns {Promise<Buffer[]>} Array of 3 raw pixel buffers (HWC, uint8)
 */
async function createTTABuffers(imageBuffer) {
  const base = sharp(imageBuffer)
    .rotate()
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'fill' })
    .removeAlpha();

  const [original, flipped, rotated] = await Promise.all([
    base.clone().raw().toBuffer({ resolveWithObject: true }),
    base.clone().flop().raw().toBuffer({ resolveWithObject: true }),
    base.clone().rotate(90).resize(IMAGE_SIZE, IMAGE_SIZE).raw().toBuffer({ resolveWithObject: true }),
  ]);

  return [original.data, flipped.data, rotated.data];
}

/**
 * Create tensors for all TTA variants.
 *
 * @param {Buffer} imageBuffer - Raw image file buffer
 * @returns {Promise<import('onnxruntime-node').Tensor[]>} Array of 3 tensors
 */
async function createTTATensors(imageBuffer) {
  const buffers = await createTTABuffers(imageBuffer);
  return buffers.map(rawPixelsToTensor);
}

module.exports = {
  imageBufferToTensor,
  rawPixelsToTensor,
  createTTABuffers,
  createTTATensors,
};
