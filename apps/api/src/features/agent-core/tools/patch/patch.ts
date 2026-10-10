import { errorMessage } from '../../../../lib/errors'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import {
  createFileMtimeStore,
  resolveFileTarget,
  withPathLocks,
  workspaceLockPaths,
  type DiagnosticsReporter,
  type EditorBufferProbe,
  type FileMtimeStore,
} from '../file/file-utils'
import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'
import {
  ADD_FILE,
  BEGIN_PATCH,
  DELETE_FILE,
  END_OF_FILE,
  END_PATCH,
  MOVE_TO,
  UPDATE_FILE,
  directiveName,
} from './patch-syntax'
import type { FileToolConcurrencyOptions } from '../file/file-utils'
import { parsePatchText, type PatchHunk } from './patch-parse'
import { errorResult } from './patch-apply'
import type { PatchToolDetails } from './patch-report'
import { executePatchFiles } from './patch-execute'
import { patchTargetPaths } from './patch-scope'
import { malformedPatchMessage } from './patch-messages'
import { fileWriteClass } from '../file/file-call-class'

export const patchToolInputSchema = z.object({
  patch: z
    .string()
    .min(1)
    .describe(`Full apply_patch text including ${BEGIN_PATCH} / ${END_PATCH} markers.`),
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
})

export type { PatchToolDetails } from './patch-report'

// Re-export the tolerant matching helpers (the apply_patch matcher) so the
// historical `./patch` import surface stays stable for every existing importer.
export { buildNotFoundHint, closestLineHint } from './patch-match'

// Re-export the header-path scan helpers so the historical `./patch` import
// surface stays stable for the permission engine and tools routes.
export { patchTargetPaths } from './patch-scope'

/** Every path a patch touches, resolved — `patchTargetPaths` splits a standalone "Move to:
 *  <old> -> <new>" into both endpoints, so locks and the class cover the real paths. */
function resolvedPatchTargets(input: unknown, defaultCwd: string | undefined): string[] {
  const i = input as { patch?: unknown; cwd?: unknown }
  if (typeof i?.patch !== 'string') return []
  const cwd = typeof i.cwd === 'string' ? i.cwd : undefined
  return patchTargetPaths(i.patch).map((p) => resolveFileTarget(p, cwd, defaultCwd).path)
}

export function createPatchTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  reportDiagnostics?: DiagnosticsReporter,
  concurrency?: FileToolConcurrencyOptions,
  /** Session-scoped read/write bookkeeping shared with read + write. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Says when a patched file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  // TDetails stated, not inferred — same reason as `read`/`bash`: the guard returns
  // carry no `details`, so inference collapsed the real PatchToolDetails to `{}`.
  return defineAgentTool<z.infer<typeof patchToolInputSchema>, PatchToolDetails>({
    name: TOOL.apply_patch,
    label: 'Apply Patch',
    activeVerb: 'Patching',
    description: [
      // Which edit tool fits which change is the prompt's routing line, stated once there.
      'Apply a multi-file patch (unified-diff hunks).',
      // Every marker in this description is INTERPOLATED from `patch-syntax.ts`, never
      // re-typed: a tool description IS the grammar lesson, and a hand-spelled marker here
      // could teach an envelope the parser rejects.
      `ONE call can touch MANY files: put every file section inside a single ${BEGIN_PATCH} / ${END_PATCH} envelope. Never split a multi-file change into separate calls.`,
      `Supports ${directiveName(ADD_FILE)}, ${directiveName(UPDATE_FILE)}, ${directiveName(DELETE_FILE)}, ${directiveName(MOVE_TO)}. A pure rename is "${MOVE_TO}<oldpath> -> <newpath>".`,
      'Files apply independently: the result names exactly which failed and why — re-send only those.',
      'Lines: " " keep, "-" remove, "+" add. Give each change up to 3 unchanged context lines above and below so it locates uniquely (none needed in a tiny file); a line is context OR a removal, never both, and changes within 3 lines of each other share ONE hunk with each line written once.',
      `Still ambiguous? Add an \`@@ <enclosing function/class>\` header. \`${END_OF_FILE}\` marks a change at the very end; a hunk that only adds lines needs an \`@@\` anchor or context, else it is appended.`,
      'Never paste full file contents — only changed lines with context.',
    ].join('\n'),
    inputSchema: patchToolInputSchema,
    executionMode: concurrency?.parallel ? 'parallel' : 'sequential',
    parallelScopePaths: (input) => resolvedPatchTargets(input, defaultCwd),
    mutates: true,
    // Undeclared, a patch reads as `external`; every hunk only reaches a file (path rules judge
    // which, from `patchTargetPaths`), and a patch of only the plan's files is session state.
    classify: (input) => fileWriteClass(resolvedPatchTargets(input, defaultCwd)),
    async execute(_toolCallId, input, signal, onUpdate) {
      const base = resolveFileTarget('.', input.cwd, defaultCwd)
      const cwd = base.cwd

      // Workspace-boundary / permission checks are enforced centrally by the
      // permission engine (loop beforeToolCall) — apply_patch just applies.
      // matchNotes collects model-facing "verify this" notes (narration/no-op skips,
      // tolerant matches) from parse + apply; surfaced by buildPatchSummary.
      const matchNotes: string[] = []
      let hunks: PatchHunk[]
      try {
        hunks = parsePatchText(input.patch, matchNotes)
      } catch (error) {
        // Malformed patch: no files were touched. Return an actionable, retryable
        // error with the exact envelope so the model fixes the format in one shot
        // instead of burning turns guessing (the common "first line must be …" case).
        return errorResult(
          malformedPatchMessage(errorMessage(error), input.patch),
          'validation',
          true,
        )
      }

      onUpdate?.({
        cwd,
        status: 'validating',
        files: [],
        totalFiles: hunks.length,
        appliedFiles: 0,
        additions: 0,
        deletions: 0,
      })

      // Hold the per-path mutation locks for every file the patch touches (move
      // targets included) across the whole read-validate-write cycle so a
      // concurrent run/job can't interleave its own read-modify-write.
      const lockPaths = hunks.flatMap((hunk) => {
        const paths = [resolveFileTarget(hunk.path, input.cwd, defaultCwd).path]
        if (hunk.kind === 'update' && hunk.movePath) {
          paths.push(resolveFileTarget(hunk.movePath, input.cwd, defaultCwd).path)
        }
        return paths
      })

      return withPathLocks(workspaceLockPaths(cwd, lockPaths), () =>
        executePatchFiles({
          env,
          defaultCwd,
          reportDiagnostics,
          mtimes,
          editorBuffer,
          input,
          hunks,
          matchNotes,
          cwd,
          onUpdate,
          signal,
        }),
      )
    },
  })
}
