import { parsePrerequisite, type Prerequisite } from '@localixai/mini-app-sdk/prerequisite'
import type { ProblemRequest } from '@localixai/mini-app-sdk/ui/problems'
import { problemRequestOf } from '@localixai/mini-app-sdk/ui/transport'

interface ApiFailureRecord {
  error?: unknown
  message?: unknown
  code?: unknown
  detail?: unknown
  prerequisite?: unknown
}

export interface ParsedApiFailure<Code extends string = string> {
  message: string
  code?: Code
  detail?: string
  /** The absent/stopped dependency, when the failure is one — validated, never trusted raw. */
  prerequisite?: Prerequisite
}

function record(value: unknown): ApiFailureRecord | null {
  return value !== null && typeof value === 'object' ? (value as ApiFailureRecord) : null
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * Normalize both mini-app-owned errors (`{ error: string, code, detail }`) and the
 * host's generic envelope (`{ error: { code, message } }`). Unknown object bodies
 * deliberately fall back to status text instead of leaking `[object Object]`.
 */
export function parseApiFailure<Code extends string = string>(
  body: unknown,
  status: number,
): ParsedApiFailure<Code> {
  const outer = record(body)
  const nested = record(outer?.error)
  const message =
    text(outer?.error) ??
    text(nested?.message) ??
    text(outer?.message) ??
    `Request failed (${status})`
  const code = text(outer?.code) ?? text(nested?.code)
  const detail = text(outer?.detail) ?? text(nested?.detail)
  const prerequisite = parsePrerequisite(outer?.prerequisite ?? nested?.prerequisite)
  return {
    message,
    ...(code ? { code: code as Code } : {}),
    ...(detail ? { detail } : {}),
    ...(prerequisite ? { prerequisite } : {}),
  }
}

/** Successful mini app payloads never carry `error`; keep that contract explicit. */
export function hasApiFailure(body: unknown): boolean {
  return record(body)?.error !== undefined
}

/** A failed DevOps RPC, typed by its provider's error codes. Each provider names its own subclass. */
export class DevOpsApiError<Code extends string> extends Error {
  readonly code?: Code
  readonly detail?: string
  /** A stopped local engine or a missing credential helper. */
  readonly prerequisite?: Prerequisite
  /** The call that failed — the Event Center traces exactly this request. */
  readonly request?: ProblemRequest
  constructor(
    message: string,
    code?: Code,
    detail?: string,
    extra: { prerequisite?: Prerequisite; request?: ProblemRequest } = {},
  ) {
    super(message)
    this.code = code
    this.detail = detail
    this.prerequisite = extra.prerequisite
    this.request = extra.request
  }
}

/** The typed body of a provider response, or its failure thrown as that provider's error. */
export async function readApiResponse<T, Code extends string>(
  res: Response,
  method: string,
  ApiError: new (...args: ConstructorParameters<typeof DevOpsApiError<Code>>) => Error,
): Promise<T> {
  const json = (await res.json().catch(() => null)) as T | null
  if (!res.ok || hasApiFailure(json)) {
    const failure = parseApiFailure<Code>(json, res.status)
    throw new ApiError(failure.message, failure.code, failure.detail, {
      prerequisite: failure.prerequisite,
      request: problemRequestOf(res, method),
    })
  }
  return json as T
}
