const SAFE_ERROR_CODE = {
  ACCESS_DENIED: 'ACCESS_DENIED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SafeErrorCode = (typeof SAFE_ERROR_CODE)[keyof typeof SAFE_ERROR_CODE];

const SAFE_ERROR_STATUS: Record<SafeErrorCode, number> = {
  ACCESS_DENIED: 403,
  INVALID_REQUEST: 400,
  NOT_AVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

const SAFE_ERROR_MESSAGE: Record<SafeErrorCode, string> = {
  ACCESS_DENIED: 'Access is denied.',
  INVALID_REQUEST: 'The request is invalid.',
  NOT_AVAILABLE: 'The requested operation is not available.',
  INTERNAL_ERROR: 'An unexpected internal error occurred.',
};

export interface SafeHttpError {
  status: number;
  body: {
    error: string;
    code: SafeErrorCode;
  };
}

/** An operational error whose public projection never exposes its cause. */
export class SafeError extends Error {
  readonly code: SafeErrorCode;

  constructor(code: SafeErrorCode) {
    super(SAFE_ERROR_MESSAGE[code]);
    this.name = 'SafeError';
    this.code = code;
  }
}

export function safeError(code: SafeErrorCode): SafeError {
  return new SafeError(code);
}

/** Converts failures to a stable HTTP-safe projection without retaining details. */
export function toSafeHttpError(error: unknown): SafeHttpError {
  const code = error instanceof SafeError ? error.code : SAFE_ERROR_CODE.INTERNAL_ERROR;
  return {
    status: SAFE_ERROR_STATUS[code],
    body: { error: SAFE_ERROR_MESSAGE[code], code },
  };
}
