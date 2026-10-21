/**
 * TOOL-CALL IDS another provider will accept. A conversation keeps the ids its models gave
 * (`functions.read:0` from Kimi, `call_…` from OpenAI), and a strict provider refuses ids not in
 * its own form: Anthropic (and Claude on Bedrock or Vertex) takes `[a-zA-Z0-9_-]{1,64}`, Mistral
 * exactly nine letters and digits. One request maps every id the same way, so a call and its
 * result stay paired; the mapping is a pure function of the ids, so the prefix a cache read is
 * unchanged from one request to the next.
 */

export type ToolCallIdFormat = 'anthropic' | 'mistral'

const ANTHROPIC_ID = /^[a-zA-Z0-9_-]{1,64}$/u
const MISTRAL_ID = /^[a-zA-Z0-9]{9}$/u

/** FNV-1a: a short, stable digest of an id, salted so a collision can be stepped past. */
function digest(text: string, salt: number): string {
  let hash = 0x811c9dc5 ^ salt
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function candidate(id: string, format: ToolCallIdFormat, salt: number): string {
  if (format === 'mistral')
    return (digest(id, salt) + digest(id, salt + 1)).padEnd(9, '0').slice(0, 9)
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/gu, '_') || 'call'
  if (salt === 0) return cleaned.slice(0, 64)
  const suffix = `_${digest(id, salt)}`
  return cleaned.slice(0, 64 - suffix.length) + suffix
}

/** The id each original becomes in one request; identity when the provider takes any id. */
export function toolCallIdMapper(format: ToolCallIdFormat | undefined): (id: string) => string {
  if (!format) return (id) => id
  const valid = format === 'mistral' ? MISTRAL_ID : ANTHROPIC_ID
  const mapped = new Map<string, string>()
  const taken = new Map<string, string>()
  return (id) => {
    const known = mapped.get(id)
    if (known !== undefined) return known
    let next = valid.test(id) ? id : candidate(id, format, 0)
    for (let salt = 1; taken.has(next) && taken.get(next) !== id; salt++)
      next = candidate(id, format, salt)
    mapped.set(id, next)
    taken.set(next, id)
    return next
  }
}
