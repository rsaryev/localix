import { dirname } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import {
  appendDiagnostics,
  appendEditorBufferNote,
  capDiff,
  createFileMtimeStore,
  resolveFileTarget,
  staleFileMessage,
  statIfExists,
  withPathLocks,
  workspaceLockPaths,
  type DiagnosticsReporter,
  type EditorBufferProbe,
  type FileToolConcurrencyOptions,
  scopePathInput,
  type FileMtimeStore,
} from './file-utils'
import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'
import { buildToolError } from '../tool-errors'
import { evaluateBlindOverwriteGuard } from './write-guard'
import { fileWriteClass } from './file-call-class'
import { fileOpenMarkdownLink, fileUiUri } from '../source-refs'

export const writeToolInputSchema = z.object({
  path: z
    .string()
    .min(1)
    // "Emit FIRST" is load-bearing: the stream guard refuses a blind overwrite the moment
    // `path` has streamed, before a large `content` body is generated for nothing.
    .describe('The file, relative to cwd. Emit this field FIRST, before `content`.'),
  content: z.string().describe('The full UTF-8 text.'),
  // "Defaults to process cwd" was false: a relative path resolves against the session root.
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
  create_directories: z
    .boolean()
    .optional()
    .describe('false: refuse instead of creating missing parent directories (default true).'),
})

export interface WriteToolDetails {
  path: string
  openUri: string
  cwd: string
  byteLength: number
  created: boolean
  diff?: string
}

export function createWriteTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  reportDiagnostics?: DiagnosticsReporter,
  concurrency?: FileToolConcurrencyOptions,
  /** Session-scoped read/write bookkeeping shared with read + apply_patch. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Says when the file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  // TInput/TDetails stated, not inferred: a `{content}`-only early return gives TS
  // no inference site for TDetails, so it silently fell back to `unknown` and the
  // tool advertised no usable details even though every success path returns a
  // WriteToolDetails. Stating it makes the compiler check what the card consumes.
  return defineAgentTool<z.infer<typeof writeToolInputSchema>, WriteToolDetails>({
    name: TOOL.write,
    label: 'Write',
    activeVerb: 'Writing',
    description: [
      'Create a file, or replace one completely, when you know its full content.',
      'Overwriting an existing file requires reading it first.',
    ].join('\n'),
    inputSchema: writeToolInputSchema,
    executionMode: concurrency?.parallel ? 'parallel' : 'sequential',
    parallelScopePaths: (input) => {
      const s = scopePathInput(input)
      return s ? [resolveFileTarget(s.path, s.cwd, defaultCwd).path] : []
    },
    mutates: true,
    // Undeclared, a write reads as `external` and a session mode cannot tell it from a network
    // call. It only ever reaches a file; WHICH file is the path rules' question — except the
    // conversation's own plan file, which is session state (`file-call-class.ts`).
    classify: (input) => {
      const s = scopePathInput(input)
      return fileWriteClass(s ? [resolveFileTarget(s.path, s.cwd, defaultCwd).path] : [])
    },
    // Blind-overwrite refusal as a guard (single source of truth in write-guard.ts).
    // streamGuard fires the moment `path` has streamed — aborting a doomed write
    // before its big `content` body generates (saving the wasted output tokens);
    // guard is the pre-execute backstop for a call whose args finished streaming
    // first. Both run the SAME check + embed-current-content + record-mtime, so the
    // model's re-issued write passes either way.
    streamGuard: {
      requiredFields: ['path'],
      evaluate: (partialInput) =>
        evaluateBlindOverwriteGuard(
          env,
          {
            path: typeof partialInput.path === 'string' ? partialInput.path : '',
            cwd: typeof partialInput.cwd === 'string' ? partialInput.cwd : undefined,
          },
          defaultCwd,
          mtimes,
        ),
    },
    guard: (ctx) =>
      evaluateBlindOverwriteGuard(
        env,
        { path: ctx.input.path, cwd: ctx.input.cwd },
        defaultCwd,
        mtimes,
      ),
    async execute(_toolCallId, input) {
      const target = resolveFileTarget(input.path, input.cwd, defaultCwd)

      // Serialize with other writers/editors of the same path so concurrent
      // runs/jobs can't interleave their read-modify-write cycles.
      return withPathLocks(workspaceLockPaths(target.cwd, [target.path]), async () => {
        const existing = await statIfExists(target.path)

        // The blind-overwrite (unread file) refusal now lives in `guard`/`streamGuard`
        // (write-guard.ts) so it can abort a doomed write mid-stream. The stale-mtime
        // guard stays here — it needs the live stat at write time to compare.
        if (existing?.isFile() && mtimes.isStale(target.path, existing.mtimeMs)) {
          return buildToolError({ message: staleFileMessage(target.path), retryable: true })
        }

        // `create_directories: false` was declared and never read: `atomicWriteFile` unconditionally
        // calls `ensureParentDir`, so a model that passed `false` precisely to avoid materialising a
        // mistyped tree got `src/compnents/` created anyway AND a plain success back. A field the schema
        // invites you to set and the code ignores is worse than no field — it is a documented capability
        // that silently is not one.
        if (input.create_directories === false) {
          const parent = dirname(target.path)
          const parentStat = await statIfExists(parent)
          if (!parentStat?.isDirectory()) {
            return buildToolError({
              message:
                `Refusing to write ${target.path}: its parent directory does not exist and ` +
                `\`create_directories\` is false. Create the directory first, or re-send with ` +
                `\`create_directories: true\` if the new tree is intended.`,
            })
          }
        }

        let diff: string | undefined
        let editorNote = ''
        if (existing?.isFile()) {
          try {
            const oldContent = await env.readFile(target.path)
            diff = capDiff(createTwoFilesPatch(target.path, target.path, oldContent, input.content))
            // Before the write: afterwards a clean tab and one with unsaved edits look the same.
            editorNote = editorBuffer?.(target.path, oldContent, 'write') ?? ''
          } catch {
            // ignore — diff is best-effort
          }
        }

        await env.writeFile(target.path, input.content)
        await mtimes.recordNow(target.path)

        const details: WriteToolDetails = {
          path: target.path,
          openUri: fileUiUri({ path: target.path }),
          cwd: target.cwd,
          byteLength: Buffer.byteLength(input.content, 'utf8'),
          created: !existing,
          diff,
        }

        // Wait for the language server and append any errors directly to the result
        // so the model sees breakage it just caused — no separate diagnostics call.
        const diagnostics = await reportDiagnostics?.([target.path]).catch(() => undefined)

        return {
          content: appendEditorBufferNote(
            appendDiagnostics(
              `Wrote ${details.byteLength} bytes to ${details.path}\nOpen in Localix: ${fileOpenMarkdownLink(details.path)}`,
              diagnostics,
            ),
            editorNote,
          ),
          details,
        }
      })
    },
  })
}
