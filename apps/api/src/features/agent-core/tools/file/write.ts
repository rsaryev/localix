/**
 * `write` — create files, or replace them whole, several in ONE call.
 *
 * Batched because five new files used to be five model round-trips. Each file stands alone
 * (`file-batch.ts`): a stale or unwritable file is reported and left as it was while the
 * others are written. The blind-overwrite refusal is the exception — it is a pre-flight
 * guard over the whole call (`write-guard.ts`), so a call that would overwrite an unread
 * file writes nothing until the model has seen what it replaces.
 */
import { dirname } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import {
  createFileMtimeStore,
  resolveFileTarget,
  staleFileMessage,
  statIfExists,
  withPathLocks,
  workspaceLockPaths,
  type DiagnosticsReporter,
  type EditorBufferProbe,
  type FileToolConcurrencyOptions,
  type FileMtimeStore,
} from './file-utils'
import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'
import { buildToolError } from '../tool-errors'
import { evaluateBlindOverwriteGuard } from './write-guard'
import { fileWriteClass } from './file-call-class'
import {
  appliedFile,
  batchResult,
  failedFile,
  type FileBatchDetails,
  type FileResult,
} from './file-batch'
import { mutationTargets, prepareWriteArguments } from './mutation-input'

const writeObjectSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1).describe('The file, relative to cwd.'),
        content: z.string().describe('The full UTF-8 text.'),
      }),
    )
    .min(1)
    .describe('Each file written whole; a file that fails is reported, the rest are written.'),
  // "Defaults to process cwd" was false: a relative path resolves against the session root.
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
  create_directories: z
    .boolean()
    .optional()
    .describe('false: refuse instead of creating missing parent directories (default true).'),
})

/** The advertised shape, with the single-file shapes lifted into it (`mutation-input.ts`). */
export const writeToolInputSchema = z.preprocess(prepareWriteArguments, writeObjectSchema)

export type WriteToolInput = z.infer<typeof writeObjectSchema>
export type WriteToolDetails = FileBatchDetails

export function createWriteTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  reportDiagnostics?: DiagnosticsReporter,
  concurrency?: FileToolConcurrencyOptions,
  /** Session-scoped read/write bookkeeping shared with read + edit. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Says when the file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  async function writeFile(
    path: string,
    content: string,
    createDirectories: boolean,
  ): Promise<FileResult> {
    const existing = await statIfExists(path)
    // The blind-overwrite (unread file) refusal lives in `guard` (write-guard.ts). The
    // stale-mtime guard stays here — it needs the live stat at write time to compare.
    if (existing?.isFile() && mtimes.isStale(path, existing.mtimeMs)) {
      return failedFile(path, staleFileMessage(path), true)
    }
    // `create_directories: false` was once declared and never read, so a model that passed it
    // to avoid materialising a mistyped tree got `src/compnents/` created anyway. A field the
    // schema invites you to set and the code ignores is worse than no field.
    if (!createDirectories && !(await statIfExists(dirname(path)))?.isDirectory()) {
      return failedFile(
        path,
        `Refusing to write ${path}: its parent directory does not exist and ` +
          `\`create_directories\` is false. Create the directory first, or re-send with ` +
          `\`create_directories: true\` if the new tree is intended.`,
      )
    }

    let diff: string | undefined
    let editorNote = ''
    if (existing?.isFile()) {
      try {
        const oldContent = await env.readFile(path)
        diff = createTwoFilesPatch(path, path, oldContent, content)
        // Before the write: afterwards a clean tab and one with unsaved edits look the same.
        editorNote = editorBuffer?.(path, oldContent, 'write') ?? ''
      } catch {
        // ignore — diff is best-effort
      }
    }

    await env.writeFile(path, content)
    await mtimes.recordNow(path)
    const byteLength = Buffer.byteLength(content, 'utf8')
    const result = appliedFile(path, `Wrote ${byteLength} bytes to ${path}`, {
      byteLength,
      created: !existing,
      diff,
    })
    return { ...result, editorNote }
  }

  return defineAgentTool<WriteToolInput, WriteToolDetails>({
    name: TOOL.Write,
    label: 'Write',
    activeVerb: 'Writing',
    description: [
      'Create files, or replace them completely, when you know their full content. Several files go in ONE call.',
      'Overwriting an existing file requires reading it first.',
    ].join('\n'),
    inputSchema: writeToolInputSchema,
    prepareArguments: prepareWriteArguments,
    executionMode: concurrency?.parallel ? 'parallel' : 'sequential',
    parallelScopePaths: (input) => mutationTargets(prepareWriteArguments(input), defaultCwd),
    mutates: true,
    // Undeclared, a write reads as `external` and a session mode cannot tell it from a network
    // call. It only ever reaches files; WHICH files is the path rules' question — except the
    // conversation's own plan file, which is session state (`file-call-class.ts`).
    classify: (input) => fileWriteClass(mutationTargets(prepareWriteArguments(input), defaultCwd)),
    // Blind-overwrite refusal (single source of truth in write-guard.ts), judged over every
    // file of the call before the permission gate and before anything is written. There is no
    // `streamGuard`: its contract is top-level `requiredFields`, and a `files` array is only
    // complete once every body has streamed, so it could no longer stop a doomed body early.
    guard: (ctx) =>
      evaluateBlindOverwriteGuard(
        (prepareWriteArguments(ctx.input) as WriteToolInput).files.map((f) => f.path),
        ctx.input.cwd,
        defaultCwd,
        mtimes,
      ),
    async execute(_toolCallId, rawInput) {
      const input = prepareWriteArguments(rawInput) as WriteToolInput
      const targets = input.files.map((file) => ({
        ...file,
        resolved: resolveFileTarget(file.path, input.cwd, defaultCwd),
      }))
      const seen = new Set<string>()
      const twice = targets.find(({ resolved }) => seen.size === seen.add(resolved.path).size)
      if (twice) {
        return buildToolError({
          message: `${twice.resolved.path} is listed twice in \`files\`. Send each file once, with its final content.`,
        })
      }
      const cwd = targets[0]?.resolved.cwd ?? resolveFileTarget('.', input.cwd, defaultCwd).cwd

      // Serialize with other writers/editors of the same paths so concurrent runs/jobs can't
      // interleave their read-modify-write cycles; every file of the call is locked together.
      const paths = targets.map(({ resolved }) => resolved.path)
      return withPathLocks(workspaceLockPaths(cwd, paths), async () => {
        const results: FileResult[] = []
        for (const { resolved, content } of targets) {
          try {
            results.push(
              await writeFile(resolved.path, content, input.create_directories !== false),
            )
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            results.push(failedFile(resolved.path, `Could not write ${resolved.path}: ${reason}`))
          }
        }
        // Wait for the language server and append any errors directly to the result so the
        // model sees breakage it just caused — no separate diagnostics call.
        const changed = results.filter((r) => !r.outcome.failed).map((r) => r.outcome.path)
        const diagnostics = changed.length
          ? await reportDiagnostics?.(changed).catch(() => undefined)
          : undefined
        return batchResult(cwd, results, diagnostics)
      })
    },
  })
}
