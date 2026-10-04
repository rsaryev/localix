// The apply_patch ENVELOPE GRAMMAR: the marker vocabulary plus the line
// classifiers that decide what a raw line *is* (directive / narration / git-diff
// metadata / hunk content). Pure predicates over a single line — no state, no I/O.
//
// Kept separate from the parser (patch-parse.ts) and the input repairs
// (patch-normalize.ts) because it changes for its own reason: every time a weak
// model invents a new way to mangle a marker, the tolerance lands HERE, not in
// the control flow that consumes it.

export const BEGIN_PATCH = '*** Begin Patch'
export const END_PATCH = '*** End Patch'
export const ADD_FILE = '*** Add File: '
export const UPDATE_FILE = '*** Update File: '
export const UPDATE_FILE_ALT = '*** Update File '
// Models split the header: "*** File: <path>" on one line, a bare "*** Update File"
// on the next (which then reads as narration and is skipped). Accept it as Update.
export const FILE_HEADER_ALT = '*** File: '
export const DELETE_FILE = '*** Delete File: '
export const MOVE_TO = '*** Move to: '
export const CHANGE_CONTEXT = '@@ '
export const EMPTY_CHANGE_CONTEXT = '@@'
export const END_OF_FILE = '*** End of File'

/**
 * A directive's NAME, without the `: ` that introduces its argument —
 * `directiveName(ADD_FILE)` → `*** Add File`.
 *
 * The model-facing text has two registers: a LINE to copy (`*** Add File: <path>`, which
 * is the constant plus its argument) and PROSE that merely names the operation ("Use
 * *** Add File / *** Delete File …"). Both must come from the constants above — the
 * `apply_patch` error messages and the tool description exist to TEACH this grammar, so a
 * marker they spell out by hand is a marker that can teach a form the parser rejects.
 */
export function directiveName(directive: string): string {
  return directive.replace(/:?\s*$/, '')
}

/** Git/unified-diff FILE-BLOCK metadata that carries no content. */
export const DIFF_META =
  /^(diff --git |index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files )/

/**
 * Canonical form of a "***" marker line for comparison: whitespace-collapsed,
 * lower-cased, and stripped of a mirrored trailing asterisk run (models write
 * "*** Update File: x ***" / "*** Begin Patch ***").
 */
export function normalizeMarker(line: string): string {
  return line
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*\*+\s*$/, '')
    .toLowerCase()
}

/** Strip the trailing asterisk run models mirror onto a file header's path. */
export function cleanHeaderPath(path: string): string {
  return path.replace(/\s*\*+\s*$/, '').trim()
}

/** Drop the `a/` or `b/` prefix a git diff puts on its paths. */
export function stripABPrefix(path: string): string {
  return path.replace(/^[ab]\//, '')
}

// Git/unified-diff FILE-HEADER (metadata) lines. Weak models (e.g.
// deepseek-v4-flash) wrap a raw `git diff` INSIDE the apply_patch envelope, so
// these leak between an "*** Update File:"/"*** Add File:" header and the first
// "@@". They are NOT hunk content — skip them, otherwise "--- a/x" parses as a
// "-"-delete of literal "-- a/x" and "+++ b/x" as a "+"-add of "++ b/x", which
// then never match the file. Kept conservative: only unambiguous git syntax
// (a/ b/ /dev/null prefixes, diff --git, index <sha>..<sha>, file-mode lines),
// so genuine deletions like "--foo" or "- --" still parse as content.
export function isDiffFileHeader(line: string, targetPath?: string): boolean {
  if (line.startsWith('diff --git ')) return true
  if (/^index [0-9a-f]+\.\.[0-9a-f]+/.test(line)) return true
  if (/^(new|deleted) file mode \d+/.test(line)) return true
  const m = /^(?:---|\+\+\+) (\S.*)$/.exec(line)
  if (!m) return false
  const path = m[1].trim()
  if (/^[ab]\//.test(path) || path === '/dev/null') return true
  // `git diff --no-prefix` emits "--- <path>" / "+++ <path>" with the bare path;
  // only treat that as a header when it names the file we're already editing, so
  // a real content deletion that happens to start with "--- " is never swallowed.
  if (targetPath) {
    const target = stripABPrefix(targetPath)
    if (
      path === targetPath ||
      path === target ||
      path.endsWith(`/${target}`) ||
      target.endsWith(`/${path}`)
    ) {
      return true
    }
  }
  return false
}

/**
 * A FILE-section directive: the four headers that can legally open a patch body.
 * (`*** Begin/End Patch` and `*** End of File` are structural but not file headers.)
 * Used to recognise an envelope-less patch, whose intent is unambiguous.
 */
export function isFileDirective(line: string): boolean {
  const t = normalizeMarker(line)
  return (
    t.startsWith('*** add file:') ||
    t.startsWith('*** update file:') ||
    t.startsWith('*** update file ') ||
    t.startsWith('*** delete file:') ||
    t.startsWith('*** file:') ||
    t.startsWith('*** move to:')
  )
}

// A real "*** …" STRUCTURAL directive (Begin/End Patch, Add/Update/Delete File,
// Move to, End of File) — space/case tolerant, and tolerant of a mirrored trailing
// "***" run (models write "*** Update File: x ***"). Everything else that starts
// with "***" is decorative NARRATION, not a directive.
export function isStructuralDirective(line: string): boolean {
  const t = normalizeMarker(line)
  return (
    t === '*** begin patch' ||
    t === '*** end patch' ||
    t === '*** end of file' ||
    isFileDirective(line)
  )
}

/** Any line that starts with a "***" marker: a bare "***"/"*** " or "*** something". */
export function startsWithMarker(line: string): boolean {
  return /^\*\*\*(\s|$)/.test(line.trim())
}

// A "***" line shaped like a real file directive but with the WRONG keyword —
// "*** Rename File: …", "*** Copy to: …" — mirroring the "*** <Verb> File:" /
// "*** Move to:" headers. This is a MALFORMED directive, not decorative narration:
// keep the existing "here is the correct envelope" teaching error rather than
// silently skipping it (which would drop the model's file-operation intent).
function looksLikeAttemptedDirective(line: string): boolean {
  return /^\*\*\*\s+[A-Za-z]+\s+(?:File|to)\s*:/i.test(line.trim())
}

// A decorative NARRATION line: a "***"-prefixed line that is NOT a structural
// directive and NOT a misspelled file directive — a bare "***"/"*** " separator, or
// prose like "*** Update the beginning of the file …". Weak models (e.g.
// tencent/hy3-preview) interleave these between a file directive
// and its first hunk, or between hunks, mirroring the "***" ceremony as commentary.
// It is neither a directive nor hunk content: skip it wherever it appears (and let it
// terminate a hunk body rather than corrupt it).
export function isNarrationLine(line: string): boolean {
  return (
    startsWithMarker(line) && !isStructuralDirective(line) && !looksLikeAttemptedDirective(line)
  )
}
