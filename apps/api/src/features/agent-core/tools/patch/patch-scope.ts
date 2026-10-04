// Header-path scanning for apply_patch — extracts the file paths a patch touches
// without paying the full parsePatchText cost. Used by the permission engine and
// the tool's parallel-scope resolver before validation runs.

import { synthesizeEnvelopeFromUnifiedDiff, unwrapPatchPayload } from './patch-normalize'

/**
 * Every `*** … File:` directive form the PARSER accepts, in one place.
 *
 * `Update File` keeps its optional colon (models drop it), and `File:` alone is
 * FILE_HEADER_ALT — the parser honours it, and leaving it out of this scan is what
 * made the permission gate blind: an unseen target resolves to no write paths, so
 * `outsideWorkspace` came out false and the default
 * `mutates + outside-workspace → ask` rule never fired. An agent could write
 * ~/.ssh/authorized_keys with no prompt by writing `*** File:` instead of
 * `*** Add File:`. Claude-Code `permissions` deny globs read the same targets and
 * were defeated identically.
 */
const FILE_DIRECTIVE_RE =
  /^\*\*\*\s+(?:(?:Add File|Delete File|Move to):|(?:Update )?File:?)\s*(.+)$/i

/**
 * Trailing mirrored asterisks: models echo the leading `***`, and the parser tolerates
 * `*** Update File: x ***`. Without stripping them the gate judges the path `"x ***"`,
 * which the applier never writes — so a glob-based deny rule misses the real one.
 */
const MIRRORED_TAIL_RE = /\s*\*+\s*$/

/**
 * Extract the target file paths a patch touches (Add/Update/Delete/Move headers).
 *
 * The input is normalized through the PARSER'S OWN converters first, so every dialect
 * the applier accepts is scanned by construction rather than by a second, hand-kept
 * regex. A raw git/unified diff is the case that matters: the parser rewrites it into
 * `*** … File:` directives, and re-implementing that rewrite here is exactly how the
 * two readers drifted apart in the first place. `patch-scope-parity.test.ts` pins them
 * together per dialect.
 */
export function patchTargetPaths(patch: string): string[] {
  const out: string[] = []
  for (const line of normalizedPatchLines(patch)) {
    const m = FILE_DIRECTIVE_RE.exec(line)
    if (!m) continue
    const target = m[1]!.replace(MIRRORED_TAIL_RE, '').trim()
    if (!target) continue
    // A standalone "Move to: <old> -> <new>" names BOTH endpoints — surface each
    // so the permission/boundary scan validates the real paths, not "old -> new".
    const arrow = target.match(/^(.*?)\s*(?:->|=>|→)\s*(.+)$/)
    if (arrow) out.push(arrow[1]!.trim(), arrow[2]!.trim())
    else out.push(target)
  }
  return out
}

/**
 * The patch as the parser will read it. Best-effort on purpose: this runs on the
 * permission hot path, and a malformed patch must not throw INSIDE the gate — it is
 * `parsePatchText` that owns rejecting it, with a real error message, a moment later.
 * Falling back to the raw text keeps the canonical directives scannable either way.
 */
function normalizedPatchLines(patch: string): string[] {
  let text = patch
  try {
    const unwrapped = unwrapPatchPayload(patch)
    text = synthesizeEnvelopeFromUnifiedDiff(unwrapped) ?? unwrapped
  } catch {
    text = patch
  }
  return text.split(/\r?\n/)
}
