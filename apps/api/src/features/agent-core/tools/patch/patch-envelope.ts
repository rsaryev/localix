import {
  mergeConcatenatedEnvelopes,
  synthesizeEnvelopeFromUnifiedDiff,
  unwrapPatchPayload,
} from './patch-normalize'
import { BEGIN_PATCH, END_PATCH, isFileDirective, normalizeMarker } from './patch-syntax'

/**
 * Bring the raw input into the canonical envelope, or explain why it cannot be:
 * unwrap a code fence, collapse concatenated envelopes, translate a raw git diff,
 * supply a missing Begin/End pair. Returns the envelope lines, ready to read.
 */
export function toEnvelopeLines(input: string, notes?: string[]): string[] {
  const normalized = mergeConcatenatedEnvelopes(unwrapPatchPayload(input)).trim()
  if (!normalized) {
    throw new Error('Patch is empty')
  }

  // A raw unified/git diff carries its own file paths — convert instead of rejecting.
  // The result always has "*** … File:" directives, so this never recurses twice.
  const asEnvelope = synthesizeEnvelopeFromUnifiedDiff(normalized, notes)
  if (asEnvelope) return toEnvelopeLines(asEnvelope, notes)

  const lines = normalized.split(/\r?\n/)
  // Accept minor whitespace/case variations to handle model formatting drift,
  // including a trailing run of asterisks (models often mirror the leading "***"
  // and emit "*** Begin Patch ***" / "*** End Patch ***").
  if (normalizeMarker(lines[0] ?? '') !== normalizeMarker(BEGIN_PATCH)) {
    // The envelope exists, just not first: drop whatever preamble precedes its
    // marker LINE. Use the same tolerant comparison as the main parser; a raw
    // substring search rejected e.g. preamble + "*** Begin Patch ***" even though
    // that marker is accepted when it happens to be the first line.
    const startLine = lines.findIndex(
      (line) => normalizeMarker(line) === normalizeMarker(BEGIN_PATCH),
    )
    if (startLine > 0) {
      notes?.push(`note: ignored ${startLine} line(s) before the patch envelope`)
      return toEnvelopeLines(lines.slice(startLine).join('\n'), notes)
    }
    // No envelope at all, but the body IS a sequence of file directives (models drop
    // the ceremony and write "*** Add File: …" straight away). The intent is not in
    // doubt — supply the envelope rather than spending a turn teaching it back.
    if (startLine < 0 && isFileDirective(lines[0] ?? '')) {
      notes?.push(
        'note: the patch was missing its "*** Begin Patch" / "*** End Patch" envelope — it was added for you',
      )
      return toEnvelopeLines(`${BEGIN_PATCH}\n${normalized}\n${END_PATCH}`, notes)
    }
    throw new Error(`The first line of the patch must be '${BEGIN_PATCH}'`)
  }
  if (normalizeMarker(lines[lines.length - 1] ?? '') !== normalizeMarker(END_PATCH)) {
    // End Patch terminates the payload. Ignore a closing fence, heredoc residue,
    // or narration after it instead of treating that transport text as patch data.
    let endLine = -1
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (normalizeMarker(lines[i] ?? '') === normalizeMarker(END_PATCH)) {
        endLine = i
        break
      }
    }
    if (endLine >= 0) {
      notes?.push(`note: ignored ${lines.length - endLine - 1} line(s) after the patch envelope`)
      return toEnvelopeLines(lines.slice(0, endLine + 1).join('\n'), notes)
    }
    // Auto-append the end marker if missing (model sometimes omits it).
    return toEnvelopeLines(normalized + `\n${END_PATCH}`, notes)
  }
  return lines
}
