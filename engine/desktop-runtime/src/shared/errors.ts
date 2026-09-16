export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'UNIQUE_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'IMPORT_FAILED'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED'
  | 'BLUEPRINT_INCOMPATIBLE'
  | 'DATABASE_MIGRATION_FAILED'
  | 'INTERNAL_ERROR';

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

export interface SafeAppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly fieldErrors?: readonly FieldError[];
  readonly details?: Readonly<Record<string, unknown>>;
}

export type Success<T> = Readonly<{ ok: true; data: T }>;
export type Failure = Readonly<{ ok: false; error: SafeAppError }>;
export type Result<T> = Success<T> | Failure;

interface AppErrorOptions {
  readonly fieldErrors?: readonly FieldError[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

const RETRYABLE_CODES = new Set<AppErrorCode>(['VERSION_CONFLICT']);
const SENSITIVE_KEYS = /password|token|digest|sql|path|stack|cause/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!SENSITIVE_KEYS.test(key)) result[key] = redact(child);
  }
  return result;
}

function freezeFields(fields: readonly FieldError[] | undefined): readonly FieldError[] | undefined {
  if (!fields) return undefined;
  return Object.freeze(fields.map((entry) => Object.freeze({ ...entry })));
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly fieldErrors: readonly FieldError[] | undefined;
  readonly safeDetails: Readonly<Record<string, unknown>> | undefined;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.fieldErrors = freezeFields(options.fieldErrors);
    this.safeDetails = options.details
      ? Object.freeze(redact(options.details) as Record<string, unknown>)
      : undefined;
  }

  toSafeError(): SafeAppError {
    const value: {
      code: AppErrorCode;
      message: string;
      retryable: boolean;
      fieldErrors?: readonly FieldError[];
      details?: Readonly<Record<string, unknown>>;
    } = {
      code: this.code,
      message: this.message,
      retryable: this.retryable
    };
    if (this.fieldErrors) value.fieldErrors = this.fieldErrors;
    if (this.safeDetails && Object.keys(this.safeDetails).length > 0) value.details = this.safeDetails;
    return Object.freeze(value);
  }
}

export function ok<T>(data: T): Success<T> {
  return Object.freeze({ ok: true, data });
}

export function fail(error: AppError): Failure {
  return Object.freeze({ ok: false, error: error.toSafeError() });
}
