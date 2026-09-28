/**
 * VIRentis — Database Connection & Migration Runner
 *
 * Replaces the old database.js which ran DROP TABLE IF EXISTS on every startup.
 * Uses CREATE TABLE IF NOT EXISTS and a schema_version tracking table.
 *
 * Migrations:
 * 001: treatments table + seeds
 * 002: diagnosis_history table + indexes
 * 003: app_settings table
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const config = require('../config');
const manifest = require('../plant_manifest.json');
const { prettifyLabel, getConfidenceLevel } = require('../utils/label');
const { seedTreatments } = require('./seeds/treatments');

// Ensure data directory exists
const dataDir = path.dirname(config.database.path);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.database.path);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// ─── Migration System ───────────────────────────────────────────────────────

function initVersionTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    )
  `);
}

function getCurrentVersion() {
  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  return row?.v || 0;
}

function recordMigration(version, description) {
  db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(version, description);
}

// ─── Migration 001: Initial Treatments Schema ────────────────────────────────

function migration001() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS treatments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      common_name TEXT UNIQUE NOT NULL,
      symptoms TEXT NOT NULL,
      cultural_control TEXT NOT NULL,
      chemical_control TEXT NOT NULL,
      biological_control TEXT NOT NULL DEFAULT '',
      prevention TEXT NOT NULL DEFAULT ''
    )
  `);

  const count = db.prepare('SELECT COUNT(*) as c FROM treatments').get();
  if (count.c === 0) {
    console.log('🌱 Seeding treatment database...');
    const upsert = db.prepare(`
      INSERT INTO treatments (common_name, symptoms, cultural_control, chemical_control, biological_control, prevention)
      VALUES (@common_name, @symptoms, @cultural_control, @chemical_control, @biological_control, @prevention)
      ON CONFLICT(common_name) DO UPDATE SET
        symptoms = excluded.symptoms,
        cultural_control = excluded.cultural_control,
        chemical_control = excluded.chemical_control,
        biological_control = excluded.biological_control,
        prevention = excluded.prevention
    `);

    const seedTransaction = db.transaction((records) => {
      for (const record of records) {
        upsert.run(record);
      }
    });

    seedTransaction(seedTreatments);
    console.log(`✅ Database seeded with ${seedTreatments.length} treatment records`);
  }

  recordMigration(1, 'Initial schema: treatments table');
}

// ─── Migration 002: Diagnosis History Schema ─────────────────────────────────

function migration002() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS diagnosis_history (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      species_key TEXT NOT NULL,
      species_name TEXT NOT NULL,
      disease_key TEXT NOT NULL,
      disease_name TEXT NOT NULL,
      common_name TEXT NOT NULL,
      confidence REAL NOT NULL,
      confidence_level TEXT NOT NULL,
      is_healthy INTEGER NOT NULL DEFAULT 0,
      class_index INTEGER NOT NULL,
      logit REAL NOT NULL,
      processing_time_ms INTEGER,
      image_data TEXT,
      blur_score REAL,
      alternatives_json TEXT,
      treatment_json TEXT,
      model_name TEXT,
      model_version TEXT,
      notes TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_history_timestamp ON diagnosis_history(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_history_species ON diagnosis_history(species_key);
    CREATE INDEX IF NOT EXISTS idx_history_disease ON diagnosis_history(disease_key);
  `);

  recordMigration(2, 'Diagnosis history table and indexes');
}

// ─── Migration 003: App Settings ────────────────────────────────────────────

function migration003() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const initialSettings = [
    { key: 'blurThreshold', value: JSON.stringify(config.blur.threshold) },
    { key: 'ttaEnabled', value: JSON.stringify(config.tta.enabled) },
    { key: 'theme', value: JSON.stringify('system') },
    { key: 'offlineMode', value: JSON.stringify(true) },
  ];

  const insert = db.prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)');
  for (const s of initialSettings) {
    insert.run(s.key, s.value);
  }

  recordMigration(3, 'App settings table');
}

// ─── Run Migrations ─────────────────────────────────────────────────────────

function runMigrations() {
  initVersionTable();
  const currentVersion = getCurrentVersion();

  const migrations = [
    { version: 1, name: 'Initial schema: treatments table', fn: migration001 },
    { version: 2, name: 'Diagnosis history table', fn: migration002 },
    { version: 3, name: 'App settings table', fn: migration003 },
  ];

  let applied = 0;
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`📦 Running migration ${migration.version}: ${migration.name}`);
      migration.fn();
      applied++;
    }
  }

  if (applied === 0) {
    console.log('✅ Database schema is up to date');
  }
}

// Run migrations on module load
runMigrations();

// ─── Query Functions: Treatments & Knowledge ────────────────────────────────

function getTreatmentByCommonName(commonName) {
  return db.prepare(
    'SELECT id, common_name, symptoms, cultural_control, chemical_control, biological_control, prevention FROM treatments WHERE common_name = ?'
  ).get(commonName) || null;
}

function getAllTreatments() {
  return db.prepare('SELECT id, common_name, symptoms, cultural_control, chemical_control, biological_control, prevention FROM treatments ORDER BY common_name ASC').all();
}

function getSpeciesList() {
  return Object.keys(manifest).map((key) => ({
    key,
    label: prettifyLabel(key),
    diseases: Object.keys(manifest[key]).map((d) => ({
      key: d,
      label: prettifyLabel(d),
      index: manifest[key][d],
      isHealthy: d.toLowerCase().includes('healthy'),
    })),
  }));
}

function searchKnowledge(query) {
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return getAllTreatments();
  }
  const term = `%${query.trim()}%`;
  return db.prepare(`
    SELECT id, common_name, symptoms, cultural_control, chemical_control, biological_control, prevention
    FROM treatments
    WHERE common_name LIKE ?
       OR symptoms LIKE ?
       OR cultural_control LIKE ?
       OR chemical_control LIKE ?
       OR biological_control LIKE ?
       OR prevention LIKE ?
    ORDER BY common_name ASC
  `).all(term, term, term, term, term, term);
}

// ─── Query Functions: Diagnosis History ─────────────────────────────────────

function saveDiagnosisHistory(record) {
  const id = record.id || crypto.randomUUID();
  const isHealthy = record.diseaseKey?.toLowerCase().includes('healthy') ? 1 : 0;
  const confidenceLevel = record.confidenceLevel || getConfidenceLevel(record.confidence);

  const stmt = db.prepare(`
    INSERT INTO diagnosis_history (
      id, timestamp, species_key, species_name, disease_key, disease_name, common_name,
      confidence, confidence_level, is_healthy, class_index, logit, processing_time_ms,
      image_data, blur_score, alternatives_json, treatment_json, model_name, model_version, notes
    ) VALUES (
      ?, datetime('now'), ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    id,
    record.speciesKey,
    record.speciesName,
    record.diseaseKey,
    record.diseaseName,
    record.commonName,
    record.confidence,
    confidenceLevel,
    isHealthy,
    record.classIndex,
    record.logit || 0,
    record.processingTimeMs || 0,
    record.imageData || null,
    record.blurScore || null,
    JSON.stringify(record.alternatives || []),
    JSON.stringify(record.treatment || {}),
    record.modelName || config.model.name,
    record.modelVersion || config.model.version,
    record.notes || ''
  );

  return getDiagnosisHistoryById(id);
}

function getDiagnosisHistory(options = {}) {
  const { limit = 50, offset = 0, species, search } = options;
  let sql = 'SELECT * FROM diagnosis_history WHERE 1=1';
  const params = [];

  if (species && species !== 'all') {
    sql += ' AND species_key = ?';
    params.push(species);
  }

  if (search && search.trim()) {
    sql += ' AND (common_name LIKE ? OR disease_name LIKE ? OR notes LIKE ?)';
    const term = `%${search.trim()}%`;
    params.push(term, term, term);
  }

  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);

  // Parse JSON fields
  return rows.map((row) => ({
    ...row,
    is_healthy: Boolean(row.is_healthy),
    alternatives: row.alternatives_json ? JSON.parse(row.alternatives_json) : [],
    treatment: row.treatment_json ? JSON.parse(row.treatment_json) : null,
  }));
}

function getDiagnosisHistoryById(id) {
  const row = db.prepare('SELECT * FROM diagnosis_history WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    is_healthy: Boolean(row.is_healthy),
    alternatives: row.alternatives_json ? JSON.parse(row.alternatives_json) : [],
    treatment: row.treatment_json ? JSON.parse(row.treatment_json) : null,
  };
}

function deleteDiagnosisHistory(id) {
  const info = db.prepare('DELETE FROM diagnosis_history WHERE id = ?').run(id);
  return info.changes > 0;
}

function clearDiagnosisHistory() {
  const info = db.prepare('DELETE FROM diagnosis_history').run();
  return info.changes;
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) as c FROM diagnosis_history').get()?.c || 0;
  const healthy = db.prepare('SELECT COUNT(*) as c FROM diagnosis_history WHERE is_healthy = 1').get()?.c || 0;
  const diseased = total - healthy;

  const topDiseases = db.prepare(`
    SELECT common_name, COUNT(*) as count
    FROM diagnosis_history
    WHERE is_healthy = 0
    GROUP BY common_name
    ORDER BY count DESC
    LIMIT 5
  `).all();

  const recentDiagnoses = getDiagnosisHistory({ limit: 5 });

  return {
    totalDiagnoses: total,
    healthyCount: healthy,
    diseasedCount: diseased,
    healthyRate: total > 0 ? Math.round((healthy / total) * 100) : 100,
    topDiseases,
    recentDiagnoses,
    supportedSpeciesCount: Object.keys(manifest).length,
    supportedConditionsCount: 38,
  };
}

// ─── Query Functions: Settings ──────────────────────────────────────────────

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const settings = {};
  for (const r of rows) {
    try {
      settings[r.key] = JSON.parse(r.value);
    } catch {
      settings[r.key] = r.value;
    }
  }
  return settings;
}

function updateSettings(newSettings) {
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction((settingsObj) => {
    for (const [k, v] of Object.entries(settingsObj)) {
      upsert.run(k, JSON.stringify(v));
    }
  });

  tx(newSettings);
  return getSettings();
}

module.exports = {
  db,
  getTreatmentByCommonName,
  getAllTreatments,
  getSpeciesList,
  searchKnowledge,
  saveDiagnosisHistory,
  getDiagnosisHistory,
  getDiagnosisHistoryById,
  deleteDiagnosisHistory,
  clearDiagnosisHistory,
  getStats,
  getSettings,
  updateSettings,
};
