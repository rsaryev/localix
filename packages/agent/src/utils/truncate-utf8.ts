// UTF-8 accounting and partial-line suffix slicing without a Node-only dependency.

interface RuntimeBuffer {
  byteLength(content: string, encoding: 'utf8'): number
}

const runtimeBuffer = (globalThis as { Buffer?: RuntimeBuffer }).Buffer
// oxlint-disable-next-line no-control-regex -- the ASCII range 0x00-0x7f is the point: this matches any non-ASCII byte
const nonAsciiPattern = /[^\x00-\x7f]/

/** UTF-8 byte length of a string. Uses Buffer when available, else a manual scan. */
export function utf8ByteLength(content: string): number {
  if (runtimeBuffer) return runtimeBuffer.byteLength(content, 'utf8')

  const firstNonAscii = content.search(nonAsciiPattern)
  if (firstNonAscii === -1) return content.length

  let bytes = firstNonAscii
  for (let i = firstNonAscii; i < content.length; i++) {
    const code = content.charCodeAt(i)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < content.length) {
      const next = content.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

/** Replace any unpaired surrogate with U+FFFD so the result is valid UTF-16/UTF-8. */
function replaceUnpairedSurrogates(content: string): string {
  let output = ''
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < content.length) {
        const next = content.charCodeAt(i + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          output += content[i] + content[i + 1]
          i++
          continue
        }
      }
      output += '�'
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += '�'
    } else {
      output += content[i]
    }
  }
  return output
}

/**
 * Truncate a string to fit within a byte limit, keeping the END.
 * Handles multi-byte UTF-8 characters and surrogate pairs correctly.
 */
export function truncateStringToBytesFromEnd(str: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''

  let outputBytes = 0
  let start = str.length
  let needsReplacement = false
  for (let i = str.length; i > 0;) {
    let characterStart = i - 1
    const code = str.charCodeAt(characterStart)
    let characterBytes: number
    let unpairedSurrogate = false
    if (code >= 0xdc00 && code <= 0xdfff && characterStart > 0) {
      const previous = str.charCodeAt(characterStart - 1)
      if (previous >= 0xd800 && previous <= 0xdbff) {
        characterStart--
        characterBytes = 4
      } else {
        characterBytes = 3
        unpairedSurrogate = true
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      characterBytes = 3
      unpairedSurrogate = true
    } else {
      characterBytes = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3
    }
    if (outputBytes + characterBytes > maxBytes) break
    outputBytes += characterBytes
    start = characterStart
    needsReplacement ||= unpairedSurrogate
    i = characterStart
  }

  const output = str.slice(start)
  return needsReplacement ? replaceUnpairedSurrogates(output) : output
}
