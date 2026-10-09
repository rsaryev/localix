/** Shared by the read emitter and wire-dump pointer detection. */
export const READ_DEDUP_STUB_PHRASE = 'unchanged since your earlier read'

/** `what` is the path, or `path (window)` for a ranged/paginated read. */
export function readDedupStub(what: string): string {
  return `[${what} is ${READ_DEDUP_STUB_PHRASE} this session — content omitted to save tokens (scroll up to that read). If it is no longer in your context, just read it again and the full content will be returned.]`
}
