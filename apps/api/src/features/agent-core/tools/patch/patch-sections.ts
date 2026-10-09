import {
  ADD_FILE,
  CHANGE_CONTEXT,
  EMPTY_CHANGE_CONTEXT,
  END_OF_FILE,
  FILE_HEADER_ALT,
  MOVE_TO,
  UPDATE_FILE,
  UPDATE_FILE_ALT,
  cleanHeaderPath,
  isDiffFileHeader,
  isNarrationLine,
  isStructuralDirective,
  startsWithMarker,
} from './patch-syntax'
import type { ParseTolerances, SectionResult, UpdateChunk } from './patch-parse-contracts'

/**
 * Body of an "*** Add File:" section: every line is new content. The "+" prefix,
 * stray "@@" anchors and wrapped git-diff headers are all ceremony here — strip
 * them rather than writing them into the created file.
 */
export function parseAddSection(lines: string[], index: number, header: string): SectionResult {
  const targetPath = cleanHeaderPath(header.slice(ADD_FILE.length).trim())
  let i = index + 1
  const added: string[] = []
  while (i < lines.length - 1) {
    const value = lines[i] ?? ''
    if (value.startsWith('*** ')) break
    // A stray "@@" / "@@ <anchor>" is meaningless in a pure Add (every line is
    // already new content) but weak models still emit it as noise — drop it
    // rather than treating it as content or rejecting the patch.
    if (value === EMPTY_CHANGE_CONTEXT || value.startsWith(CHANGE_CONTEXT)) {
      i += 1
      continue
    }
    // A wrapped `git diff` for a NEW file leaks its file headers here
    // (diff --git / new file mode / index / --- /dev/null / +++ b/x). Skip
    // them so they don't land as literal first lines of the created file.
    if (isDiffFileHeader(value, targetPath)) {
      i += 1
      continue
    }
    // Every line in an Add File block is new content by definition, so the "+"
    // prefix is pure ceremony: strip a single leading "+" for back-compat with
    // correct patches, but accept bare lines literally too (weak models often
    // omit it). Same leniency rationale as the Update-File context lines below.
    added.push(value.startsWith('+') ? value.slice(1) : value)
    i += 1
  }
  const contents = added.join('\n') + (added.length > 0 ? '\n' : '')
  return { hunk: { kind: 'add', path: targetPath, contents }, next: i }
}

/** The "@@"-anchor line that opens a chunk, if the chunk carries one. */
function readChangeContext(value: string): string | undefined {
  const afterAt = value.slice(CHANGE_CONTEXT.length)
  // Unified-diff hunk header: "@@ <range> @@[ function context]". Anything
  // before the SECOND "@@" is positional (and models garble it — "@@ line
  // 117,1 +117,1 @@"); the real anchor, when git emits one, follows it.
  // Line numbers are useless to us anyway: findMatch locates the block by
  // content. A lone "@@ <text>" has no second marker and IS the anchor.
  const closing = afterAt.lastIndexOf('@@')
  const anchor = closing >= 0 ? afterAt.slice(closing + 2).trim() : afterAt
  return anchor ? anchor : undefined
}

/** One chunk body: the run of " " keep / "-" remove / "+" add lines after an anchor. */
function readChunkBody(
  lines: string[],
  index: number,
  targetPath: string,
): { oldLines: string[]; newLines: string[]; isEndOfFile: boolean; next: number } {
  const oldLines: string[] = []
  const newLines: string[] = []
  let isEndOfFile = false
  let i = index

  while (i < lines.length - 1) {
    const body = lines[i] ?? ''
    if (body === END_OF_FILE) {
      isEndOfFile = true
      i += 1
      break
    }
    if (
      startsWithMarker(body) ||
      body === EMPTY_CHANGE_CONTEXT ||
      body.startsWith(CHANGE_CONTEXT)
    ) {
      break
    }
    // Defensive: a git file-header line (--- a/x / +++ b/x / diff --git / index)
    // that survived past the first "@@" (e.g. a second file's header inside a
    // wrapped multi-file diff) is metadata, not content — drop it.
    if (isDiffFileHeader(body, targetPath)) {
      i += 1
      continue
    }
    if (body.startsWith('-')) {
      oldLines.push(body.slice(1))
    } else if (body.startsWith('+')) {
      newLines.push(body.slice(1))
    } else if (body.startsWith(' ')) {
      const text = body.slice(1)
      oldLines.push(text)
      newLines.push(text)
    } else {
      // Any other line inside a hunk body (we already broke on *** / @@) is a
      // context line whose leading space the model dropped — extremely common,
      // e.g. blank lines emitted as "" or markdown lines like "## Goal". Treat
      // the whole line as unchanged context rather than rejecting the patch;
      // strict matching afterward validates it, so leniency here is safe.
      oldLines.push(body)
      newLines.push(body)
    }
    i += 1
  }

  return { oldLines, newLines, isEndOfFile, next: i }
}

/**
 * Body of an "*** Update File:" section (plus its optional "*** Move to:"): a run
 * of chunks, each an optional "@@" anchor followed by keep/remove/add lines.
 */
export function parseUpdateSection(
  lines: string[],
  index: number,
  header: string,
  tolerances: ParseTolerances,
): SectionResult {
  const headerPrefix = header.startsWith(UPDATE_FILE)
    ? UPDATE_FILE
    : header.startsWith(FILE_HEADER_ALT)
      ? FILE_HEADER_ALT
      : UPDATE_FILE_ALT
  const targetPath = cleanHeaderPath(header.slice(headerPrefix.length).trim())
  let i = index + 1
  let movePath: string | undefined
  if ((lines[i] ?? '').startsWith(MOVE_TO)) {
    movePath = cleanHeaderPath((lines[i] ?? '').slice(MOVE_TO.length).trim())
    i += 1
  }

  // Skip any leading git/unified-diff FILE-HEADER lines (diff --git / index /
  // --- a/x / +++ b/x) that appear between the file header and the first "@@" —
  // the sign a model wrapped a raw `git diff` for this file in the envelope.
  while (i < lines.length - 1 && isDiffFileHeader(lines[i] ?? '', targetPath)) {
    i += 1
  }

  const chunks: UpdateChunk[] = []
  while (i < lines.length - 1) {
    const value = lines[i] ?? ''
    if (!value.trim()) {
      i += 1
      continue
    }
    // Decorative "***" narration between the file directive and the first hunk, or
    // between hunks — skip it (do NOT end the file section, do NOT treat as content).
    if (isNarrationLine(value)) {
      tolerances.narrationSkipped += 1
      i += 1
      continue
    }
    if (startsWithMarker(value)) break

    let changeContext: string | undefined
    if (value === EMPTY_CHANGE_CONTEXT) {
      i += 1
    } else if (value.startsWith(CHANGE_CONTEXT)) {
      changeContext = readChangeContext(value)
      i += 1
    } else if (chunks.length > 0 && !/^[-+ ]/.test(value)) {
      throw new Error(`Expected @@ marker at line ${i + 1}, got: ${value}`)
    }
    // A follow-on chunk that starts straight at its "-"/"+"/" " lines with no
    // "@@" separator keeps an undefined anchor: chunks apply positionally from
    // the previous match, so the separator was never load-bearing.

    const body = readChunkBody(lines, i, targetPath)
    i = body.next

    // A body-less "@@ <anchor>" — models routinely close a patch with a trailing
    // anchor, or separate hunks with a bare anchor. It expresses no edit, so drop
    // it rather than failing the whole patch. If EVERY chunk is body-less the
    // "hunk is empty" error below still fires.
    if (body.oldLines.length === 0 && body.newLines.length === 0) {
      tolerances.emptyChunksSkipped += 1
      continue
    }

    chunks.push({
      changeContext,
      oldLines: body.oldLines,
      newLines: body.newLines,
      isEndOfFile: body.isEndOfFile,
    })
  }

  if (chunks.length === 0) {
    throw new Error(
      `Update file hunk for '${targetPath}' is empty — it has no " " keep, "-" remove or "+" add lines. ` +
        `To REPLACE a whole file, use the \`write\` tool with the new content; apply_patch only expresses diffs.`,
    )
  }
  return { hunk: { kind: 'update', path: targetPath, movePath, chunks }, next: i }
}

/**
 * A standalone "*** Move to: <old> -> <new>" — a pure rename the model invents as its
 * own op instead of attaching "*** Move to:" to an "*** Update File:". Returns the
 * rename hunk, or the rewritten patch text when the Move actually carried an edit
 * (in which case the caller re-parses; every chunk rule then applies unchanged).
 */
export function parseMoveSection(
  lines: string[],
  index: number,
  header: string,
  notes?: string[],
): { reparse: string } | SectionResult {
  const spec = cleanHeaderPath(header.slice(MOVE_TO.length).trim())
  const arrow = spec.match(/^(.*?)\s*(?:->|=>|→)\s*(.+)$/)
  if (!arrow) {
    throw new Error(
      `Line ${index + 1} ("${header}") — a standalone Move needs both paths: "*** Move to: <oldpath> -> <newpath>" ` +
        `(or attach "*** Move to: <newpath>" right after "*** Update File: <oldpath>").`,
    )
  }
  // A standalone Move that is FOLLOWED by hunk lines is not a pure rename: the
  // model used "*** Move to:" as the file header for an edit. That is exactly
  // "*** Update File: <old>" + "*** Move to: <new>", so rewrite it into the
  // canonical pair and re-parse.
  const next = lines.slice(index + 1).find((l) => l.trim())
  if (next && /^[-+ @]/.test(next) && !isStructuralDirective(next)) {
    notes?.push(
      `note: "${header.trim()}" carried an edit, so it was read as a rename of ${arrow[1].trim()} plus its hunks`,
    )
    return {
      reparse: [
        ...lines.slice(0, index),
        `${UPDATE_FILE}${arrow[1].trim()}`,
        `${MOVE_TO}${arrow[2].trim()}`,
        ...lines.slice(index + 1),
      ].join('\n'),
    }
  }
  return {
    hunk: { kind: 'update', path: arrow[1].trim(), movePath: arrow[2].trim(), chunks: [] },
    next: index + 1,
  }
}
