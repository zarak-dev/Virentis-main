/**
 * VIRentis — API Response Types
 *
 * Standardized API response envelope types.
 * Matches the backend response.js helpers.
 */

/**
 * Success response wrapper.
 */
export interface ApiSuccess<T> {
  data: T;
}

/**
 * Error response wrapper.
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Union type for API responses.
 */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/**
 * Type guard to check if a response is an error.
 */
export function isApiError(response: unknown): response is ApiError {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    typeof (response as ApiError).error === 'object'
  );
}

/**
 * Known error codes returned by the backend.
 */
export type ErrorCode =
  | 'MISSING_IMAGE'
  | 'MISSING_SPECIES'
  | 'INVALID_SPECIES'
  | 'INVALID_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'IMAGE_TOO_BLURRY'
  | 'INFERENCE_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';
