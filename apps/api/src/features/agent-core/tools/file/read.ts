import type { z } from 'zod'
import {
  defineAgentTool,
  type AgentTool,
  type AgentToolUpdateCallback,
} from '@localixai/agent/agents'
import { formatSize } from '@localixai/agent'
import { TOOL } from '../../tool-names'
import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'
import {
  appendEditorBufferNote,
  createFileMtimeStore,
  resolveTargetPath,
  sameNameInCwdHint,
  type EditorBufferProbe,
  type FileMtimeStore,
} from './file-utils'
import { renderLineRange } from './read-render'
import { MAX_OUTPUT_BYTES, looksBinary, modelFacingFile, truncateOutput } from './read-output'
import type { OutlineProvider } from './outline'
import { readOutline } from './read-outline'
import type { DocumentTextExtractor } from './document-ports'
import { isExtractableDocument, readDocument } from './read-document'
import { hasImageExtension } from './read-image-sniff'
import { MAX_IMAGE_FILE_BYTES, prepareImage, readImageBytes, sniffImageFile } from './read-image'
import { isNotebookPath, renderNotebook } from './read-notebook'
import { prepareReadArguments, readToolInputSchema, withLineLimit } from './read-input'
import { tryListDirectory } from './read-directory'
import { createReadResponder, type ReadItemResult } from './read-results'
import { readItems, readScopePaths, type ReadItemInput } from './read-items'
import { runReadBatch, type ReadStores } from './read-batch'

export { readToolInputSchema } from './read-input'
export { tryListDirectory } from './read-directory'

import type { ReadToolDetails } from './read-contracts'
export type { ReadToolDetails } from './read-contracts'

export function createReadTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  outlineProvider?: OutlineProvider,
  documentExtractor?: DocumentTextExtractor,
  /** Session-scoped read/write bookkeeping shared with write + edit. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Says when the file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  // Every read returns the bytes it just read. A repeat read of an unchanged file is answered
  // in full, never with a pointer at an earlier result the model may no longer hold.

  // One tool for every model: a model that cannot read images keeps `read` (it is how it reads
  // everything else) and gets a text answer for a picture. `forModel` picks the variant once
  // per run; a run with no stated modalities is assumed to see images.
  type ReadInput = z.infer<typeof readToolInputSchema>
  const make = (canSeeImages: boolean): AgentTool<ReadInput, ReadToolDetails> => {
    // TDetails stated, not inferred: a stated type keeps every branch on one card payload.
    const tool = defineAgentTool<ReadInput, ReadToolDetails>({
      name: TOOL.Read,
      label: 'Read File',
      activeVerb: 'Reading',
      // Batching reads into one turn is the prompt's cross-tool rule ("# Execution
      // discipline"); this says what one read returns.
      description:
        'Read a file (or several via `reads`): text as UTF-8, an image (PNG, JPEG, GIF, WebP) as a picture you can see, PDF/office documents as extracted text (`pages`, `sheet` narrow them), a Jupyter notebook as its cells and outputs, and a directory as its entries.',
      inputSchema: readToolInputSchema,
      prepareArguments: prepareReadArguments,
      forModel: (modelInput) => make(modelInput.includes('image')),
      mutates: false,
      // Read-only: runs concurrently with other calls in the same batch. A sequential call
      // (bash) is a barrier, and the scope paths (every file of a `reads` batch) order this
      // read behind an earlier edit/write of the same file (and a later one behind it), so it
      // sees the state the batch order implies.
      executionMode: 'parallel',
      parallelScopePaths: (input) =>
        readScopePaths(input).map((s) => resolveTargetPath(s.path, s.cwd, defaultCwd)),

      async execute(_toolCallId, rawInput, signal, onUpdate) {
        const [first, ...rest] = readItems(rawInput)
        if (!first)
          return { content: 'read needs `path`, or `reads` for several files.', isError: true }
        if (!rest.length) return readOne(first, signal, onUpdate, { mtimes })
        const read = (item: ReadItemInput, stores: ReadStores) =>
          readOne(item, signal, undefined, stores)
        const result = await runReadBatch([first, ...rest], read, { mtimes })
        onUpdate?.(result.details)
        return result
      },
    })

    // One item of a call. `stores` is the session's own store for a single read, and a staged
    // one inside a batch, so an item the batch does not deliver leaves no trace.
    async function readOne(
      rawInput: ReadItemInput,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<ReadToolDetails> | undefined,
      { mtimes }: ReadStores,
    ): Promise<ReadItemResult> {
      const input = withLineLimit(rawInput)
      const targetPath = resolveTargetPath(input.path, input.cwd, defaultCwd)
      const { respond, dirResult } = createReadResponder(targetPath, onUpdate)

      // Pixels are never decoded as UTF-8. Undefined: not an image after all (a text file
      // named `.png`) or unreadable — the text path below then answers.
      const readImage = async () => {
        const file = await readImageBytes(env, targetPath, signal)
        if (file.kind === 'unreadable') return undefined
        if (file.kind === 'too-big') {
          const limit = formatSize(MAX_IMAGE_FILE_BYTES)
          const content = `${targetPath} is ${formatSize(file.bytes)}, over the ${limit} image limit. Crop or convert it with \`Bash\` first.`
          return respond(content, { bytes: file.bytes, isError: true })
        }
        const image = await prepareImage(targetPath, file.data, file.bytes, canSeeImages)
        if (!image) return undefined
        await mtimes.recordNow(targetPath)
        const { mediaType, width, height } = image.sniff
        return respond(image.text, {
          bytes: file.bytes,
          extra: { kind: 'image', mediaType, width, height },
          ...(image.image ? { images: [image.image] } : {}),
          ...(image.isError ? { isError: true as const } : {}),
        })
      }
      if (hasImageExtension(targetPath)) {
        const image = await readImage()
        if (image) return image
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
        // write/edit (and unlocks write-over-existing for this path).
        await mtimes.recordNow(targetPath)
        // Binary files (NUL byte sniff): return a notice, not garbage UTF-8.
        if (looksBinary(fileContent)) {
          // Office/PDF documents read as binary, but their TEXT is extractable. The extractor
          // bounds its own output; `byte_offset`, `pages` and `sheet` narrow it. A null result
          // (extraction failed) falls through to the binary notice.
          const bytes = Buffer.byteLength(fileContent)
          if (isExtractableDocument(targetPath)) {
            const doc = await readDocument(documentExtractor, targetPath, input)
            if (doc)
              return respond(doc.output, { bytes, ...(doc.isError ? { isError: true } : {}) })
          } else if (!hasImageExtension(targetPath) && (await sniffImageFile(env, targetPath))) {
            // A misnamed image (`shot.bin`): the bytes, not the name, say it is a picture.
            const image = await readImage()
            if (image) return image
          }
          const notice = `Binary file: ${targetPath} (${formatSize(bytes)}) — contents not shown (a NUL byte was found). Reading it as text would produce garbage; use a dedicated tool if you need to inspect it.`
          return respond(notice, { bytes })
        }
        // What the person has on screen but not on disk rides along with every text answer
        // below — the full text and a range alike (they may have typed since the last read).
        const editorNote = editorBuffer?.(targetPath, fileContent, 'read') ?? ''
        const withEditorNote = (text: string) => appendEditorBufferNote(text, editorNote)

        // A notebook reads as its cells; a line range or outline still reads the raw JSON.
        const notebook =
          isNotebookPath(targetPath) && input.start_line == null && input.mode !== 'outline'
            ? renderNotebook(fileContent, canSeeImages)
            : undefined
        if (notebook) {
          const page = truncateOutput(notebook.text, input.byte_offset ?? 0)
          return respond(withEditorNote(page.output), {
            bytes: Buffer.byteLength(fileContent),
            truncated: page.truncated,
            extra: { kind: 'notebook' },
            images: notebook.images,
          })
        }

        if (input.mode === 'outline') {
          const outline = await readOutline(fileContent, targetPath, outlineProvider)
          return respond(outline.output, outline)
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
          return respond(withEditorNote(range.output), {
            bytes: range.bytes,
            truncated: range.truncated,
          })
        }
        const truncated = truncateOutput(fileContent, input.byte_offset ?? 0)
        // What the model actually SEES: `modelFacingFile` applies a secondary LINE cap
        // (2000 lines) ON TOP of the byte cap, so a file that fits the byte budget but is
        // long in LINES is still handed back head-only.
        const modelFacing = modelFacingFile(truncated.output, {
          continueFromByteOffset: input.byte_offset ?? 0,
        })

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
    }
    return tool
  }
  return make(true)
}
