/**
 * VIRentis — Diagnosis Domain Types
 *
 * Shared type definitions for the diagnosis domain.
 * These types represent the contract between frontend and backend.
 *
 * IMPORTANT: When modifying these types, ensure both client and server agree.
 * The backend should produce responses matching these interfaces.
 */

// ─── Treatment ──────────────────────────────────────────────────────────────

export interface Treatment {
  common_name: string;
  symptoms: string;
  cultural_control: string;
  chemical_control: string;
  biological_control?: string;
  prevention?: string;
}

// ─── Diagnosis Response (Current API) ───────────────────────────────────────

/**
 * Current diagnosis response from POST /api/diagnose.
 * This interface matches the EXISTING backend response shape.
 * Gemini should evolve this toward the target DiagnosisResult as the
 * backend API is upgraded in Phase 3.
 */
export interface DiagnosisResponse {
  species: string;
  speciesName: string;
  classIndex: number;
  diseaseKey: string;
  diseaseName: string;
  commonName: string;
  logit: number;
  confidence: number;
  processingTimeMs?: number; // Added in app-factory.js
  treatment: Treatment;
}

// ─── Target Diagnosis Result (Phase 3+) ─────────────────────────────────────

/**
 * Target enriched diagnosis result.
 * Gemini should migrate toward this in Phase 3.
 */
export interface DiagnosisResult {
  id: string;
  timestamp: string;

  crop: {
    key: string;
    name: string;
  };

  diagnosis: {
    key: string;
    name: string;
    commonName: string;
    isHealthy: boolean;
    classIndex: number;
  };

  confidence: {
    score: number;
    level: ConfidenceLevel;
    rawLogit: number;
  };

  image: {
    filename: string;
    blurScore: number;
    sizeBytes: number;
  };

  model: {
    name: string;
    version: string;
    ttaVariants: number;
    processingTimeMs: number;
  };

  severity?: {
    percentage: number;
    level: SeverityLevel;
  };

  treatment: TreatmentInfo;
}

export interface TreatmentInfo {
  symptoms: string;
  culturalControl: string;
  chemicalControl: string;
  biologicalControl: string;
  prevention: string;
}

export type ConfidenceLevel = 'high' | 'moderate' | 'low';
export type SeverityLevel = 'none' | 'mild' | 'moderate' | 'severe' | 'critical';

// ─── Species ────────────────────────────────────────────────────────────────

export interface DiseaseInfo {
  key: string;
  label: string;
  index: number;
}

export interface SpeciesInfo {
  key: string;
  label: string;
  diseases: DiseaseInfo[];
}

// ─── App State ──────────────────────────────────────────────────────────────

export type AppState = 'select' | 'uploading' | 'results';

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Derive confidence level from numeric score.
 */
export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 80) return 'high';
  if (score >= 50) return 'moderate';
  return 'low';
}

/**
 * Check if a diagnosis indicates a healthy plant.
 */
export function isHealthyDiagnosis(diseaseKey: string): boolean {
  return diseaseKey?.includes('healthy') ?? false;
}
