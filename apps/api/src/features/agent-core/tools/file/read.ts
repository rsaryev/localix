import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { ELISION_MARKER, formatSize } from '@localixai/agent'
import { TOOL } from '../../tool-names'
import { fileSource } from '../source-refs'
import { type ExecutionEnvironment, shellQuote } from '../environment'
import { localEnvironment } from '../environments/local'
import {
  appendEditorBufferNote,
  createFileMtimeStore,
  resolveTargetPath,
  sameNameInCwdHint,
  scopePathInput,
  type EditorBufferProbe,
  type FileMtimeStore,
} from './file-utils'
import { stringToInteger } from '../tool-schema'
import { createReadDedupStore, type ReadDedupStore } from './read-dedup'
import { renderLineRange } from './read-render'
import {
  MAX_DIR_ENTRIES,
  MAX_OUTPUT_BYTES,
  looksBinary,
  modelFacingFile,
  truncateOutput,
} from './read-output'
import { formatOutline, type OutlineProvider } from './outline'
import type { DocumentTextExtractor } from './document-ports'
import { isViewableImagePath } from './view-image'

/**
 * Office/PDF formats `read` sees as binary (a NUL-byte sniff trips on their ZIP /
 * PDF container). When an extractor is injected, these get their text extracted
 * instead of a binary-file refusal. csv/md are already plain text, so they take the
 * normal text path and aren't listed here.
 */
const EXTRACTABLE_DOC_EXTS = new Set(['docx', 'pptx', 'xlsx', 'pdf', 'odt'])
function isExtractableDocument(p: string): boolean {
  const dot = p.lastIndexOf('.')
  return dot >= 0 && EXTRACTABLE_DOC_EXTS.has(p.slice(dot + 1).toLowerCase())
}

/**
 * `limit` is the line-count shape Claude Code's read tool taught models (`offset`/`limit`);
 * a model that brings it here used to be refused for an unknown property.
 * It folds into the start/end pair the rest of the tool reads, so the range logic has one shape.
 */
function withLineLimit<T extends { start_line?: number; end_line?: number; limit?: number }>(
  input: T,
): T {
  if (input.limit == null) return input
  const start = input.start_line ?? 1
  return { ...input, start_line: start, end_line: input.end_line ?? start + input.limit - 1 }
}

export const readToolInputSchema = z.object({
  path: z.string().min(1).describe('File or directory, absolute or relative to cwd.'),
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
  mode: z
    .enum(['content', 'outline'])
    .optional()
    .describe(
      "'outline': the symbol outline with line spans — the cheap first look at a big file.",
    ),
  offset: z
    // Same tolerance as `start_line`/`end_line` two fields down. `offset` is the field a model is
    // MOST likely to send as a string: its own description says to reuse "the offset suggested in a
    // previous truncated read", i.e. copy a number out of a text marker. Two fields in one schema
    // behaving differently for the same input is the defect.
    .preprocess(stringToInteger, z.number().int().min(0))
    .optional()
    .describe('Byte offset to continue a truncated read (use the suggested value).'),
  start_line: z
    .preprocess(stringToInteger, z.number().int().min(1))
    .optional()
    .describe('1-based first line of a range, e.g. from `search`. Ignores `offset`.'),
  end_line: z
    .preprocess(stringToInteger, z.number().int().min(1))
    .optional()
    .describe('Inclusive last line (default: end of file).'),
  limit: z
    .preprocess(stringToInteger, z.number().int().min(1))
    .optional()
    .describe('Lines to return from start_line.'),
})

export interface ReadToolDetails {
  path: string
  bytes: number
  truncated: boolean
  output: string
}

/**
 * If `targetPath` is a directory, return a sorted listing (one entry per line,
 * directories suffixed with `/`); otherwise return null. Uses env.exec so it works
 * identically across local / ssh / docker backends.
 */
export async function tryListDirectory(
  env: ExecutionEnvironment,
  targetPath: string,
): Promise<string | null> {
  const q = shellQuote(targetPath)
  // -1: one per line, -A: almost-all (skip . and ..), -p: append / to directories.
  // Stop at one sentinel beyond the display cap. Letting `ls` finish first made
  // the shared exec capture keep an arbitrary tail past 4 MB, then this function
  // sorted that tail and reported its length as the directory's exact count.
  const cmd = `if [ -d ${q} ]; then ls -1Ap -- ${q} | head -n ${MAX_DIR_ENTRIES + 1}; else printf '__NOT_A_DIR__'; fi`
  let result: { stdout: string; stderr: string; exitCode: number }
  try {
    // `uncapped` is safe here because `head` has already bounded the producer to
    // 1,001 filesystem names (each component is itself filesystem-size-bounded).
    result = await env.exec(cmd, { uncapped: true })
  } catch {
    return null
  }
  // `head` owns the pipeline exit code, so stderr is the remaining `ls` failure signal.
  if (result.exitCode !== 0 || result.stderr.trim() || result.stdout.includes('__NOT_A_DIR__'))
    return null
  const entries = result.stdout
    .split('\n')
    .map((s) => s.trim())
    // The workspace's own `.localix/` is the host's cache, not the user's project.
    .filter((s) => s && s !== '.localix/')
    .sort()
  const sourceTruncated = entries.length > MAX_DIR_ENTRIES
  const shown = sourceTruncated ? entries.slice(0, MAX_DIR_ENTRIES) : entries
  if (sourceTruncated) {
    return `Directory ${targetPath} — more than ${MAX_DIR_ENTRIES} entries (showing first ${MAX_DIR_ENTRIES}):\n${shown.join('\n')}\n[…more entries omitted]`
  }
  return `Directory ${targetPath} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}:\n${shown.join('\n')}`
}

/**
 * The dedup stub `read` serves instead of re-delivering bytes the model already has —
 * and the PHRASE inside it, which a SECOND reader keys on.
 *
 * `chat/runtime/run/wire-dump.ts` classifies a tool result as a recoverable dedup POINTER
 * by looking for that phrase. It used to re-type the sentence to do so, because this module
 * emitted the stub as an inline template and exported nothing: two copies of one string in
 * two trees, with nothing holding the ends together. Reword the stub and the detector goes
 * quiet — an elided read silently stops being recognised as recoverable, which is the exact
 * signal the compression work is read off. The EMITTER owns it now; the detector imports it.
 *
 * MODEL-FACING, and covered by no ordinary test: this text REPLACES a file the model asked
 * for, so if it stops saying how to get the content back, the read is simply lost. The bytes
 * are pinned by a characterization test in `read.test.ts`.
 *
 * The phrase is spelled once as the constant and once inside the template, deliberately:
 * `wire-dump-stub.test.ts` (chat's tree) reads THIS SOURCE and requires the literal on the
 * emitting line. `readDedupStub()` containing `READ_DEDUP_STUB_PHRASE` is asserted in
 * `read.test.ts`, so the two cannot drift apart in silence. Collapse them once chat's lint
 * is retired in favour of importing the constant.
 */
export const READ_DEDUP_STUB_PHRASE = 'unchanged since your earlier read'

/** `what` is the path, or `path (window)` for a ranged/paginated read. */
export function readDedupStub(what: string): string {
  return `[${what} is unchanged since your earlier read this session — content omitted to save tokens (scroll up to that read). If it is no longer in your context, just read it again and the full content will be returned.]`
}

export function createReadTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  outlineProvider?: OutlineProvider,
  documentExtractor?: DocumentTextExtractor,
  /**
   * Is the result of that earlier tool call no longer intact on the model's wire
   * (elided / crushed / truncated by context compression)? Injected by the chat
   * runtime, which collects the ids from the wire it actually sends
   * (`collectElidedToolCallIds`). A missing provider means "assume it was elided" —
   * the safe answer, which degrades to the historical one-shot stub.
   */
  isResultElided?: (toolCallId: string) => boolean,
  /** Session-scoped read/write bookkeeping shared with write + apply_patch. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Session-scoped repeat-read bookkeeping (see {@link ReadDedupStore}). */
  dedup: ReadDedupStore = createReadDedupStore(),
  /** Says when the file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  // Session-scoped dedup (see `read-dedup.ts`): the hash of the last full content
  // returned for each path, and the read that returned it. On a repeat read of an
  // UNCHANGED file we still read fresh from disk (never serve stale content), but
  // return a short stub instead of re-sending the whole file into context — the
  // content is already present in an earlier turn. This is the common "re-read the
  // file I just looked at" waste; the stub saves the tokens. It spans RUNS because
  // the history does: the earlier read is still there after the next user message.
  //
  // The stub is only truthful while the EARLIER read it points at ("scroll up") is
  // still intact on the wire. Context compression can elide that read mid-run, and a
  // stub pointing at a pointer sends the model to `bash cat`, doubling every read
  // (one measured session: 131 reads over 37 distinct paths = 94 redundant re-reads).
  //
  // So we ask, per path, whether THAT specific earlier read result was elided:
  //   intact  → serve the stub, however many times the model re-reads;
  //   elided  → the model genuinely lost the content: send the full file, re-arm.
  //
  // The previous rule ("stub at most once per path, ever") could not see the wire, so
  // it guessed pessimistically and re-sent whole files on every second re-read even
  // when nothing had been compressed at all. Replayed over 30 recorded sessions, the
  // precise rule cuts read-result bytes by 23% (53% on the worst session).
  // Fallback rule for hosts that wire no `isResultElided` (tests, embedders): we cannot
  // see the wire, so keep the historical pessimistic one-stub-per-path behaviour. It
  // rides on the same store, so it is session-scoped too.

  // TDetails stated, not inferred: the early-return guards below carry no `details`, so
  // inference collapsed it to `{}` and `read` advertised a detail-less card payload
  // even though it builds a full ReadToolDetails on the success path.
  return defineAgentTool<z.infer<typeof readToolInputSchema>, ReadToolDetails>({
    name: TOOL.read,
    label: 'Read File',
    activeVerb: 'Reading',
    description: [
      // Batching reads into one turn is the prompt's cross-tool rule ("# Execution
      // discipline"); this says what one read returns.
      'Read a file as UTF-8 text (PDF/office documents are extracted; a directory lists its entries). For an image use `view_image`.',
      // `ELISION_MARKER` by INTERPOLATION, never re-typed: this line tells the model to
      // recognise the exact phrase the compression layers stamp on an elided result, so a
      // reword of the constant must reach this sentence or the advice points at words the
      // model will never see. See its declaration in `@localixai/agent` (`context/op-menu.ts`).
      `A repeat read of an unchanged file or range returns a short stub — unless the earlier read was ${ELISION_MARKER}, then the content comes back.`,
    ].join('\n'),
    inputSchema: readToolInputSchema,
    mutates: false,
    // Read-only: safe to run concurrently with other reads in the same batch. The
    // sequential track (edits, writes, bash) always completes first, so reads here
    // observe post-mutation state. The scope path lets the loop serialize a read
    // against any future same-file parallel writer.
    executionMode: 'parallel',
    parallelScopePaths: (input) => {
      const s = scopePathInput(input)
      return s ? [resolveTargetPath(s.path, s.cwd, defaultCwd)] : []
    },

    async execute(toolCallId, rawInput, signal, onUpdate) {
      const input = withLineLimit(rawInput)
      const targetPath = resolveTargetPath(input.path, input.cwd, defaultCwd)

      // Pixels are not text: an image has its own tool, so this one never decodes a PNG into
      // garbage nor carries a media clause the model has to learn from a text tool's schema.
      if (isViewableImagePath(targetPath)) {
        return {
          content: `${targetPath} is an image. Use \`view_image\` to look at it — \`read\` returns text.`,
          isError: true,
        }
      }

      /**
       * Return one read result. Every branch below — listing, binary notice, extracted
       * document, outline, line range, whole/paginated file, error — ends the same way:
       * build the `ReadToolDetails`, push it to the UI, hand the model its text. Written
       * out seven times it was seven chances to forget the `onUpdate`, or to let the
       * card and the model disagree about what was read.
       *
       * `output` is what the UI shows; `content` is what the MODEL sees, and they
       * legitimately differ (an outline is wrapped for the model; a whole file gets the
       * line cap applied) — so it is a separate, explicit parameter, never a default.
       */
      const respond = (
        output: string,
        meta: { bytes: number; truncated?: boolean; content?: string; isError?: true },
      ) => {
        const details: ReadToolDetails = {
          path: targetPath,
          bytes: meta.bytes,
          truncated: meta.truncated ?? false,
          output,
        }
        onUpdate?.(details)
        return {
          content: meta.content ?? output,
          details,
          // Provenance for the answer's Sources list. One place, because `respond` is the single
          // exit of all seven branches — a per-branch source would be seven chances to forget one.
          // A failed read still publishes, marked `failed`: "we tried to look at this and could
          // not" is part of what informed the answer, and the answer UI hides it while the tool
          // card keeps it.
          sources: [
            fileSource({
              path: targetPath,
              ...(meta.isError ? { status: 'failed' as const } : {}),
            }),
          ],
          ...(meta.isError ? { isError: true as const } : {}),
        }
      }

      const dirResult = (listing: string) => {
        const truncated = truncateOutput(listing)
        return respond(truncated.output, { bytes: truncated.bytes, truncated: truncated.truncated })
      }

      try {
        const fileContent = await env.readFile(targetPath, signal)
        // Some platforms read a directory as an empty string instead of throwing —
        // disambiguate so the model gets a listing, not a misleading "(empty file)".
        if (fileContent === '') {
          const listing = await tryListDirectory(env, targetPath)
          if (listing !== null) return dirResult(listing)
        }
        // A successful read marks the file fresh for the stale-file guard in
        // write/apply_patch (and unlocks write-over-existing for this path).
        // ORDERING (load-bearing): this MUST record before the dedup short-circuit
        // below. The dedup store outlives a run but the mtime store is per-run, so a
        // cross-run read that only serves a stub still has to record the mtime in THIS
        // run's store — otherwise the write-guard would refuse a file the model just
        // re-read this run as a blind overwrite. Pinned by read.test.ts.
        await mtimes.recordNow(targetPath)
        // Binary files (NUL byte sniff): return a notice, not garbage UTF-8.
        if (looksBinary(fileContent)) {
          // Office/PDF documents read as binary, but their TEXT is extractable — when
          // an extractor is injected, return that instead of refusing. The extractor
          // bounds its own output and `offset` pages further through a large document.
          // A null result falls through to the binary notice.
          if (documentExtractor && isExtractableDocument(targetPath)) {
            const extracted = await documentExtractor(targetPath, input.offset)
            if (extracted != null) {
              // A line range is meaningful on the EXTRACTED text, not on the document's
              // bytes. This branch used to return before the range code below, silently
              // handing back the whole extraction when the model asked for lines 100-200
              // — and `attachment-spill`'s manifest tells it to do exactly that.
              const output =
                input.start_line != null
                  ? renderLineRange(
                      extracted,
                      targetPath,
                      input.start_line,
                      input.end_line ?? undefined,
                      MAX_OUTPUT_BYTES,
                    ).output
                  : extracted
              return respond(output, { bytes: Buffer.byteLength(fileContent) })
            }
          }
          const bytes = Buffer.byteLength(fileContent)
          const notice = `Binary file: ${targetPath} (${formatSize(bytes)}) — contents not shown (a NUL byte was found). Reading it as text would produce garbage; use a dedicated tool if you need to inspect it.`
          return respond(notice, { bytes })
        }
        // What the person has on screen but not on disk rides along with every text answer
        // below — the full text, a range, and the "unchanged" stub alike (they may have
        // typed since the last read).
        const editorNote = editorBuffer?.(targetPath, fileContent, 'read') ?? ''
        const withEditorNote = (text: string) => appendEditorBufferNote(text, editorNote)
        /**
         * Serve a short stub instead of re-delivering bytes the model already has.
         *
         * `window` is the slice identity: `undefined` for a whole-file read, `L10-40` /
         * `O2000` for a ranged or paginated one. Two reads share a stub only when they
         * asked for the same window AND the delivered bytes are identical — we always read
         * fresh from disk, so a changed file simply misses the hash.
         *
         * The stub is only truthful while the EARLIER read it points at is still intact on
         * the wire; `isResultElided` answers that. `suppressArm` refuses to arm a stub for
         * a delivery that was CLIPPED while the model believed it asked for everything —
         * a later "unchanged, scroll up" would bury the tail it never received.
         */
        const dedupStub = (
          window: string | undefined,
          delivered: string,
          suppressArm: boolean,
        ): string | undefined => {
          const earlierCallId = dedup.lastCallId(targetPath, window)
          const stubOk = isResultElided
            ? earlierCallId !== undefined && !isResultElided(earlierCallId)
            : !dedup.stubServed(targetPath, window)
          if (dedup.isUnchanged(targetPath, window, delivered) && stubOk) {
            dedup.setStubServed(targetPath, window, true)
            const what = window === undefined ? targetPath : `${targetPath} (${window})`
            return readDedupStub(what)
          }
          if (!suppressArm) dedup.record(targetPath, window, delivered, toolCallId)
          return undefined
        }

        // Outline mode: symbol skeleton from the language server instead of text.
        // When it's unavailable (no LSP wired, unsupported language e.g. .md/.json,
        // server still starting) we do NOT dump the whole file — that was the surprise
        // token spend the old honest-error guarded against — but a bare error just cost
        // the model a wasted turn (measured: outline errored on .md/.tsx).
        // Fall back to a bounded HEAD: enough to orient, cheap, with the total line
        // count + how to read a specific span.
        if (input.mode === 'outline') {
          const OUTLINE_FALLBACK_HEAD_LINES = 40
          const fallbackHead = (reason: string) => {
            const head = renderLineRange(
              fileContent,
              targetPath,
              1,
              OUTLINE_FALLBACK_HEAD_LINES,
              MAX_OUTPUT_BYTES,
            )
            const content = `Outline unavailable for ${targetPath} (${reason}) — showing the first ${OUTLINE_FALLBACK_HEAD_LINES} lines. Use start_line/end_line for a specific span.\n${head.output}`
            return respond(content, { bytes: head.bytes, truncated: head.truncated })
          }
          if (!outlineProvider) return fallbackHead('no language server in this run context')
          let symbols
          try {
            symbols = await outlineProvider(targetPath)
          } catch (error) {
            return fallbackHead(error instanceof Error ? error.message : 'language server error')
          }
          if (!symbols || symbols.length === 0)
            return fallbackHead(
              'no symbols returned; unsupported language or the server is still starting',
            )
          const outline = formatOutline(targetPath, symbols)
          return respond(outline, {
            bytes: Buffer.byteLength(fileContent),
            content: modelFacingFile(outline),
          })
        }
        // Line-range read: return exactly the requested 1-based line span, each
        // line prefixed with its number so the model can line up `search` hits.
        // This is the cheap, elidable alternative to `bash cat/nl/sed`.
        if (input.start_line != null) {
          const range = renderLineRange(
            fileContent,
            targetPath,
            input.start_line,
            input.end_line ?? undefined,
            MAX_OUTPUT_BYTES,
          )
          // A ranged read is a read: the same span of an unchanged file, asked for twice,
          // is the same bytes. This branch used to return before any dedup at all — and it
          // is where the waste concentrated (498 of 646 no-change repeat reads on the
          // recorded corpus were ranged, every one re-delivered in full).
          const window = `L${input.start_line}-${input.end_line ?? ''}`
          const stub = dedupStub(window, range.output, range.truncated)
          return respond(withEditorNote(stub ?? range.output), {
            bytes: stub ? Buffer.byteLength(range.output) : range.bytes,
            truncated: stub ? false : range.truncated,
          })
        }
        const truncated = truncateOutput(fileContent, input.offset ?? 0)
        // What the model actually SEES: `modelFacingFile` applies a secondary LINE cap
        // (2000 lines) ON TOP of the byte cap, so a file that fits the byte budget but is
        // long in LINES is still handed back head-only. The dedup must account for this —
        // it is the same "model got a head, believed it got everything" hazard the byte
        // cap already guards, one layer down. Computed once, reused for the return.
        const modelFacing = modelFacingFile(truncated.output, {
          continueFromByteOffset: input.offset ?? 0,
        })
        const lineClipped = modelFacing !== truncated.output
        // A paginated read gets its own dedup entry per offset: two reads of the SAME
        // offset deliver the same slice, while a different offset is a different window
        // and never stubs against it.
        {
          const window = input.offset == null ? undefined : `O${input.offset}`
          const delivered = input.offset == null ? fileContent : truncated.output
          // Refuse to arm a stub when the model was handed a CLIPPED view of what it asked
          // for — by the byte cap (a PLAIN read's `truncated.truncated`) OR the line cap
          // (`lineClipped`, either window). A later "unchanged, scroll up" stub would
          // otherwise point the model at a head and bury the tail it never received.
          // A PAGINATED read's `truncated.truncated` only means "more pages follow" — the
          // page itself is whole — so it does NOT suppress; only a line-clip of the page does.
          const clipped = (window === undefined && truncated.truncated) || lineClipped
          const stub = dedupStub(window, delivered, clipped)
          if (stub) return respond(withEditorNote(stub), { bytes: Buffer.byteLength(fileContent) })
        }

        // No "next time, survey it first with mode:'outline'" hint here any more. It was a
        // MEASURED experiment and it failed: shipped because outline had 0 uses in 290 reads,
        // it then rode 146 large-file reads without producing a single outline call in 2552
        // reads. Advice delivered AFTER the whole file has already landed in context asks the
        // model to change a decision it has finished making, and it never transfers to the
        // next file. What remains is the opt-in `mode:'outline'` itself, in the schema.
        return respond(truncated.output, {
          bytes: truncated.bytes,
          truncated: truncated.truncated,
          content: withEditorNote(modelFacing || '(empty file)'),
        })
      } catch (error) {
        // A directory read throws on most backends (EISDIR / "Is a directory") — list it.
        const listing = await tryListDirectory(env, targetPath)
        if (listing !== null) return dirResult(listing)

        const message = error instanceof Error ? error.message : 'Unknown file read error'
        const notFound =
          typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
        // On a miss, the model often prepended "/" to a bare workspace filename
        // (read "/game2048.html" when it lives in the cwd) — point it at the
        // same-basename file in the working dir so it doesn't waste a retry guessing.
        const hint = notFound
          ? await sameNameInCwdHint(env, targetPath, input.cwd ?? defaultCwd)
          : ''
        const content = notFound
          ? `File not found: ${targetPath}${hint}`
          : `Failed to read file: ${targetPath}\n${message}`
        // The message is mirrored into details.output (respond's `output`) so consumers
        // that render `details` — not `content` — still surface the reason instead of an
        // empty box.
        return respond(content, { bytes: 0, isError: true })
      }
    },
  })
}
