/**
 * Defensive parser for the unified suggestion reply. The model is instructed to output one labeled
 * line per requested surface (`chat: …` / `<plugin>.<surface>: …`). Models being models, we
 * tolerate: code fences, blank/extra lines, label case drift, `-`/`—` separators, and — when only
 * ONE surface was requested — a reply that drops the label entirely (the whole first line is then
 * that surface's).
 *
 * The label charset includes `.` because a CONTRIBUTED surface id is namespaced by its plugin.
 * Without it every contributed answer parsed as no answer at all: the model replied correctly, the
 * line was dropped here, and the surface looked like a model that never has a suggestion.
 */

/** Strip surrounding markdown code fences. */
function stripFences(raw: string): string {
  return raw.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
}

/**
 * Extract each requested surface's raw suggestion text from the model reply.
 * Missing / unlabeled surfaces simply have no entry (→ no ghost). Per-surface
 * normalization (quotes, prompt symbols, length caps) is the surface's `clean`.
 */
export function parseSurfaceLines(raw: string, surfaceIds: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const text = stripFences(raw ?? '')
  const lines = text.split('\n').filter((l) => l.trim())

  for (const line of lines) {
    const m = /^\s*["'`*-]*\s*([a-zA-Z0-9_.-]+)\s*[:—–-]\s*(.*)$/.exec(line)
    if (!m) continue
    // Match against what was actually REQUESTED rather than lower-casing into a canonical form:
    // the id belongs to whoever declared it, and folding its case here would quietly rename it.
    const label = m[1].toLowerCase()
    const id = surfaceIds.find((candidate) => candidate.toLowerCase() === label)
    if (id && !(id in out)) out[id] = decodeCompletion(m[2])
  }

  // Single-surface fallback: no label matched → treat the first non-empty line
  // as that surface's suggestion (models often skip the label when asked for one
  // thing). Never applied for multi-surface replies — ambiguity means silence.
  if (Object.keys(out).length === 0 && surfaceIds.length === 1 && lines.length > 0) {
    out[surfaceIds[0]] = decodeCompletion(lines[0].trim())
  }
  return out
}

function decodeCompletion(raw: string): string {
  const value = raw.trim()
  if (!value.startsWith('"')) return value
  try {
    const decoded: unknown = JSON.parse(value)
    return typeof decoded === 'string' ? decoded : ''
  } catch {
    return '' // A broken quoted suffix must not insert protocol scaffolding.
  }
}
