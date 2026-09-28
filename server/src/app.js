/**
 * VIRentis — API Server Entry Point
 *
 * Runs the Express application in standalone/development mode.
 */
const { createApp } = require('./app-factory');
const { preWarmModel } = require('./ml/inference');
const config = require('./config');

const app = createApp({ serveStaticClient: false });

const server = app.listen(config.port, () => {
  console.log(`🌱 VIRentis API Server listening on http://localhost:${config.port}`);
  console.log(`   Model: ${config.model.name} (v${config.model.version})`);
  console.log(`   Database: ${config.database.path}`);

  // Pre-warm the ONNX model in background to eliminate first-request latency
  preWarmModel().catch((err) => {
    console.error('Warning: Model pre-warming failed:', err.message);
  });
});

module.exports = server;
