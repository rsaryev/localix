import { ApiError } from '@localixai/mini-app-sdk/backend'

/**
 * Domain errors: what a service, repository or runtime module throws when a request cannot be
 * served. Each names the kind of failure; `DOMAIN_ERROR_STATUS` is the one place a kind meets
 * HTTP. They stay `ApiError`s so every existing reader (the central error handler, the realtime
 * RPC replies, the mini app SDK) answers with the same status, code and body as before.
 */
export type DomainErrorKind =
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'internal'
  | 'unavailable'

export const DOMAIN_ERROR_STATUS = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  internal: 500,
  unavailable: 503,
} as const satisfies Record<DomainErrorKind, ApiError['status']>

export class DomainError extends ApiError {
  readonly kind: DomainErrorKind

  constructor(kind: DomainErrorKind, code: string, message: string, detail?: string) {
    super(DOMAIN_ERROR_STATUS[kind], code, message, detail)
    this.kind = kind
  }
}

/** The request is malformed or names something it may not (HTTP 400). */
export class InvalidRequestError extends DomainError {
  constructor(code: string, message: string, detail?: string) {
    super('invalid', code, message, detail)
  }
}

/** The caller may not do this (HTTP 403). */
export class ForbiddenError extends DomainError {
  constructor(code: string, message: string, detail?: string) {
    super('forbidden', code, message, detail)
  }
}

/** The addressed record does not exist for this caller (HTTP 404). */
export class NotFoundError extends DomainError {
  constructor(code: string, message: string, detail?: string) {
    super('not_found', code, message, detail)
  }
}

/** The request conflicts with the record's current state (HTTP 409). */
export class ConflictError extends DomainError {
  constructor(code: string, message: string, detail?: string) {
    super('conflict', code, message, detail)
  }
}

/** The request is well formed but its content cannot be accepted (HTTP 422). */
export class UnprocessableError extends DomainError {
  constructor(code: string, message: string, detail?: string) {
    super('unprocessable', code, message, detail)
  }
}

/** The operation failed on the server's side (HTTP 500). */
export class InternalError extends DomainError {
  constructor(code: string, message: string, detail?: string) {
    super('internal', code, message, detail)
  }
}

/** A dependency the operation needs is not available right now (HTTP 503). */
export class UnavailableError extends DomainError {
  constructor(code: string, message: string, detail?: string) {
    super('unavailable', code, message, detail)
  }
}
