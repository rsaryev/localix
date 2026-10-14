/**
 * UTF-8 decoding for a byte stream that arrives in ARBITRARY chunks.
 *
 * A PTY read, a pipe read and a socket read all split wherever the OS buffer
 * happened to end — routinely in the middle of a multi-byte character. Decoding
 * each chunk independently (`new TextDecoder().decode(chunk)`, or Node's
 * `buffer.toString()`) turns that split character into U+FFFD on BOTH sides of the
 * boundary, and nothing anywhere reports it: the bytes were valid, the output is
 * quietly wrong.
 *
 * It bites exactly the content that matters here. Box-drawing characters
 * (U+2500–U+257F, three bytes each) are what every coding-agent TUI paints its
 * menus and frames with, and that painted screen is what the agent READS to decide
 * what to do next. Non-ASCII prose and emoji corrupt the same way.
 *
 * `TextDecoder` already solves this — but only when told the input is a stream, so
 * it holds an incomplete trailing sequence back until the next chunk completes it.
 * This wraps that one flag behind a name, because the flag is easy to omit and the
 * omission is invisible until someone reads a mangled frame.
 */

/**
 * A stateful UTF-8 decoder for one stream. Feed it chunks in order; a character
 * split across two chunks is emitted whole with the second.
 *
 * The returned function is NOT safe to share between two streams — each stream
 * needs its own, or one's trailing bytes would be completed with the other's.
 */
export function createStreamTextDecoder(): (chunk: Uint8Array) => string {
  const decoder = new TextDecoder()
  return (chunk) => decoder.decode(chunk, { stream: true })
}
