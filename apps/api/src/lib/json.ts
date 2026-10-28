import { readFile } from 'node:fs/promises'

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
