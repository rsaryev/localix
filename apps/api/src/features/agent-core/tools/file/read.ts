import type { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { ELISION_MARKER, formatSize } from '@localixai/agent'
import { TOOL } from '../../tool-names'
import type { ExecutionEnvironment } from '../environment'
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
import { createReadDedupStore, type ReadDedupStore } from './read-dedup'
import { renderLineRange } from './read-render'
import { MAX_OUTPUT_BYTES, looksBinary, modelFacingFile, truncateOutput } from './read-output'
import { formatOutline, type OutlineProvider } from './outline'
import type { DocumentTextExtractor } from './document-ports'
import { isViewableImagePath } from './view-image'
import { readToolInputSchema, withLineLimit } from './read-input'
import { tryListDirectory } from './read-directory'
import { createReadResponder } from './read-results'
import { createReadRepeatPolicy } from './read-repeat'

export { readToolInputSchema } from './read-input'
export { tryListDirectory } from './read-directory'
export { READ_DEDUP_STUB_PHRASE, readDedupStub } from './read-dedup-stub'

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

import type { ReadToolDetails } from './read-contracts'
export type { ReadToolDetails } from './read-contracts'

export function createReadTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  outlineProvider?: OutlineProvider,
  documentExtractor?: DocumentTextExtractor,
  /**
   * Is the result of that earlier tool call no longer intact on the model's wire
   * (elided / crushed / truncated by context compression)? Injected by the chat
   * runtime, which collects the ids from the wire it actually sends
   * (`collectElidedToolCallIds`). Without a provider, one stub is allowed per
   * recorded full delivery before the next repeat delivers and re-arms it.
   */
  isResultElided?: (toolCallId: string) => boolean,
  /** Session-scoped read/write bookkeeping shared with write + apply_patch. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Session-scoped repeat-read bookkeeping (see {@link ReadDedupStore}). */
  dedup: ReadDedupStore = createReadDedupStore(),
  /** Says when the file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  // Reads fetch fresh bytes before checking the session-scoped repeat policy. The shared
  // store retains each window's last delivered hash and call id across runs. A pointer
  // is served only while that earlier result survives on the model's wire; an elided
  // result is delivered again and re-arms the pointer. Without isResultElided, each
  // full delivery permits one stub before the next repeat delivers the bytes again.

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

      const { respond, dirResult } = createReadResponder(targetPath, onUpdate)

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
        const dedupStub = createReadRepeatPolicy(targetPath, toolCallId, dedup, isResultElided)

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
