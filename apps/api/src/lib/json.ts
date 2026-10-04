/** Parse JSON, returning null for null/empty input or any parse error. */
export function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
