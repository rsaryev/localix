import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isRecord } from './record'

/** Parse JSON, returning null for null/empty input or any parse error. */
export function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Read and parse a JSON file; `undefined` when it is missing, unreadable or not JSON. */
export async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Read a JSON file holding an object; `undefined` when it is missing, unreadable, not JSON or not an object. */
export function readJsonRecordSync(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
