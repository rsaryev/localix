import { parsePrerequisite, type Prerequisite } from '@localixai/plugin-sdk/prerequisite'

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
 * Normalize both plugin-owned errors (`{ error: string, code, detail }`) and the
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

/** Successful plugin payloads never carry `error`; keep that contract explicit. */
export function hasApiFailure(body: unknown): boolean {
  return record(body)?.error !== undefined
}
