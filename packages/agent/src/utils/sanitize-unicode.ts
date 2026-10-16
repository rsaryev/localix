/**
 * Remove unpaired UTF-16 surrogate code units while preserving valid pairs.
 *
 * JavaScript strings may contain lone surrogates (commonly after an unsafe
 * substring/truncation boundary). JSON.stringify escapes them, but several LLM
 * gateways reject the resulting JSON string as invalid Unicode. Sanitize only at
 * the provider wire boundary so persisted/user-visible text remains untouched.
 */
export function sanitizeSurrogates(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1]
        i++
      }
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue
    out += text[i]
  }
  return out
}
