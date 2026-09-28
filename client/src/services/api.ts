/**
 * VIRentis — Centralized API Service
 *
 * Single point of contact for all backend API calls.
 * Replaces the scattered fetch() calls in App.tsx.
 *
 * Design:
 * - Automatically resolves the base URL (dev vs Electron)
 * - Returns typed responses
 * - Handles error extraction consistently
 * - All API calls go through this service
 */
import type { DiagnosisResponse, SpeciesInfo } from '../types/diagnosis';
import type { ApiError } from '../types/api';

// ─── Base URL Resolution ────────────────────────────────────────────────────

/**
 * Resolve the API base URL.
 * In Vite dev mode (:5173), proxy to Express (:3001).
 * In Electron/production, same origin.
 */
const API_BASE = window.location.port === '5173' ? 'http://localhost:3001' : '';

// ─── Error Handling ─────────────────────────────────────────────────────────

/**
 * Custom error class for API errors with structured error codes.
 */
export class ApiRequestError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Process a fetch Response and either return data or throw ApiRequestError.
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const body = await response.json();

  if (!response.ok) {
    const err = body as ApiError;
    if (err.error) {
      throw new ApiRequestError(
        response.status,
        err.error.code,
        err.error.message,
        err.error.details as Record<string, unknown> | undefined
      );
    }
    // Fallback for old-style error responses (backward compat during migration)
    throw new ApiRequestError(
      response.status,
      'UNKNOWN_ERROR',
      (body as { error?: string; message?: string }).error ||
        (body as { message?: string }).message ||
        'An unknown error occurred'
    );
  }

  // Handle both new { data: T } and old direct response format
  if ('data' in body) {
    return body.data as T;
  }
  return body as T;
}

// ─── API Methods ────────────────────────────────────────────────────────────

/**
 * Fetch the list of supported crop species.
 */
export async function fetchSpecies(): Promise<SpeciesInfo[]> {
  const response = await fetch(`${API_BASE}/api/species`);
  const result = await handleResponse<SpeciesInfo[] | { species: SpeciesInfo[] }>(response);

  // Handle both old format { species: [...] } and new format [...]
  if (Array.isArray(result)) {
    return result;
  }
  return (result as { species: SpeciesInfo[] }).species || [];
}

/**
 * Submit an image for disease diagnosis.
 *
 * @param file - Image file to analyze
 * @param species - Species key (e.g. "tomato")
 * @returns Diagnosis result with treatment recommendations
 * @throws {ApiRequestError} On validation or inference errors
 */
export async function submitDiagnosis(file: File, species: string): Promise<DiagnosisResponse> {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('species', species);

  const response = await fetch(`${API_BASE}/api/diagnose`, {
    method: 'POST',
    body: formData,
  });

  return handleResponse<DiagnosisResponse>(response);
}

// ─── Future API Methods (for Gemini to implement) ───────────────────────────

// export async function fetchHistory(params?: { limit?: number; offset?: number; crop?: string }) { ... }
// export async function fetchHistoryItem(id: string) { ... }
// export async function deleteHistoryItem(id: string) { ... }
// export async function fetchCrops() { ... }
// export async function fetchCropDiseases(cropKey: string) { ... }
// export async function fetchSettings() { ... }
// export async function updateSettings(settings: Partial<Settings>) { ... }
