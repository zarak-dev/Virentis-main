/**
 * VIRentis — Database Module (Compatibility Bridge)
 *
 * Forwards to src/database/connection.js which includes migration management
 * and prevents destructive table drops on restart.
 */
module.exports = require('./database/connection');
