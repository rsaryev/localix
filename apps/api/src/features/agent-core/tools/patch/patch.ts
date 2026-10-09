import { createTwoFilesPatch } from 'diff'
import { errorMessage } from '../../../../lib/errors'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import {
  createFileMtimeStore,
  detectLineEnding,
  normalizeToLF,
  resolveFileTarget,
  restoreLineEndings,
  staleFileMessage,
  statIfExists,
  stripBom,
  withPathLocks,
  workspaceLockPaths,
  type DiagnosticsReporter,
  type EditorBufferProbe,
  type FileMtimeStore,
} from '../file/file-utils'
import { type ExecutionEnvironment, shellQuote } from '../environment'
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
import { applyUpdateChunks, errorResult, trimTrailingPatchMetadata } from './patch-apply'
import {
  buildAppliedPatchSummary,
  projectPatchChanges,
  toLineCount,
  type PatchFailure,
  type PreparedPatchChange,
  type PatchToolDetails,
} from './patch-report'
import { patchTargetPaths } from './patch-scope'
import { malformedPatchMessage } from './patch-messages'
import { unreadFileDiagnosis } from './patch-diagnosis'
import { fileWriteClass } from '../file/file-call-class'

export const patchToolInputSchema = z.object({
  patch: z
    .string()
    .min(1)
    .describe(`Full apply_patch text including ${BEGIN_PATCH} / ${END_PATCH} markers.`),
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
})

export type { PatchFileChange, PatchToolDetails } from './patch-report'

// Re-export the tolerant matching helpers (the apply_patch matcher) so the
// historical `./patch` import surface stays stable for every existing importer.
export {
  findMatch,
  findUniqueMatch,
  reindentNewLines,
  buildNotFoundHint,
  describeStrategy,
  closestLineHint,
  unescapeLiteral,
} from './patch-match'
export type { PatchMatch, MatchStrategy, UniqueMatchResult } from './patch-match'

// Re-export the header-path scan helpers so the historical `./patch` import
// surface stays stable for the permission engine and tools routes.
export { patchTargetPaths } from './patch-scope'

async function deleteFile(env: ExecutionEnvironment, filePath: string) {
  const result = await env.exec(`rm -f ${shellQuote(filePath)}`)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to delete ${filePath}`)
  }
}

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

      return withPathLocks(workspaceLockPaths(cwd, lockPaths), async () => {
        // Files that validated and are queued to write (Phase 2 applies these).
        const validated: PreparedPatchChange[] = []
        // Files we could NOT apply — recorded with an actionable reason instead of
        // aborting the whole patch, so one bad hunk never blocks the good files.
        const failures: PatchFailure[] = []
        let aborted = false

        const publishProgress = (
          status: PatchToolDetails['status'],
          appliedFiles: number,
          currentFile?: string,
        ) => {
          const { additions, deletions, files } = projectPatchChanges(validated)
          onUpdate?.({
            cwd,
            status,
            files,
            totalFiles: hunks.length,
            appliedFiles,
            additions,
            deletions,
            currentFile,
          })
        }

        // ── Phase 1: validate each file INDEPENDENTLY (no disk writes yet) ────────
        // A failure is recorded against that one file and the loop moves on — the
        // remaining files still get their chance. Nothing is written until a file
        // fully validates, so a rejected hunk never leaves a half-written file.
        for (const hunk of hunks) {
          if (signal?.aborted) {
            aborted = true
            break
          }
          const target = resolveFileTarget(hunk.path, input.cwd, defaultCwd)
          try {
            if (hunk.kind === 'add') {
              if (await statIfExists(target.path))
                throw new Error(`file already exists: ${target.path}`)
              const diff = trimTrailingPatchMetadata(
                createTwoFilesPatch(target.path, target.path, '', hunk.contents),
              )
              validated.push({
                originalPath: target.path,
                path: target.path,
                oldContent: '',
                newContent: hunk.contents,
                kind: 'add',
                diff,
                ...toLineCount('', hunk.contents),
              })
              publishProgress('validating', 0, target.path)
              continue
            }

            const existing = await statIfExists(target.path)
            if (!existing?.isFile()) throw new Error(`file not found: ${target.path}`)
            // Stale-file guard: refuse to patch a file that changed on disk since a
            // tool last read or wrote it (external formatter, another job, the user).
            if (mtimes.isStale(target.path, existing.mtimeMs))
              throw new Error(staleFileMessage(target.path))

            const rawOldContent = await env.readFile(target.path)
            // Match and splice in LF space with the BOM stripped; the original line
            // ending and BOM are restored on write (CRLF files stay CRLF).
            const { bom, text: bomFree } = stripBom(rawOldContent)
            const lineEnding = detectLineEnding(bomFree)
            const oldContent = normalizeToLF(bomFree)

            if (hunk.kind === 'delete') {
              const diff = trimTrailingPatchMetadata(
                createTwoFilesPatch(target.path, target.path, oldContent, ''),
              )
              validated.push({
                originalPath: target.path,
                path: target.path,
                oldContent: rawOldContent,
                newContent: '',
                kind: 'delete',
                diff,
                ...toLineCount(oldContent, ''),
              })
              continue
            }

            const newContent = applyUpdateChunks(oldContent, target.path, hunk.chunks, matchNotes)
            const nextPath = hunk.movePath
              ? resolveFileTarget(hunk.movePath, input.cwd, defaultCwd).path
              : target.path
            if (hunk.movePath && (await statIfExists(nextPath))) {
              throw new Error(`move target already exists: ${nextPath}`)
            }
            const diff = trimTrailingPatchMetadata(
              createTwoFilesPatch(target.path, nextPath, oldContent, newContent),
            )
            validated.push({
              originalPath: target.path,
              path: nextPath,
              oldContent: rawOldContent,
              newContent: bom + restoreLineEndings(newContent, lineEnding),
              kind: hunk.movePath ? 'move' : 'update',
              movePath: hunk.movePath ? nextPath : undefined,
              diff,
              ...toLineCount(oldContent, newContent),
            })
            publishProgress('validating', 0, nextPath)
          } catch (error) {
            failures.push({
              path: hunk.path,
              reason: errorMessage(error) + unreadFileDiagnosis(error, target.path, mtimes),
            })
          }
        }

        publishProgress('applying', 0)

        // ── Phase 2: apply the validated files. Each write is independent — a disk
        // failure on one file is recorded against THAT file and the rest still apply
        // (no cross-file rollback: already-applied files are meant to stay). ───────
        const modifiedPaths: string[] = []
        const applied: typeof validated = []
        for (const change of validated) {
          if (signal?.aborted) {
            aborted = true
            break
          }
          try {
            if (change.kind === 'delete') {
              await deleteFile(env, change.originalPath)
              mtimes.clear(change.originalPath)
            } else if (change.kind === 'move' && change.movePath) {
              await env.writeFile(change.movePath, change.newContent)
              try {
                await deleteFile(env, change.originalPath)
              } catch (deleteError) {
                // Crumple zone: the new path is written but the original could not be
                // removed (e.g. its directory is read-only, or a TOCTOU dir swap made
                // `rm -f` fail). Left as-is the "move" silently becomes a COPY — both
                // paths hold the content — and a retry then dies on "move target already
                // exists", stranding the task. Roll the write back so the tree returns to
                // its pre-move state (the original is untouched, fully recoverable), and
                // attribute the failure to originalPath (the path that actually failed),
                // not movePath as the generic catch below would.
                await deleteFile(env, change.movePath).catch(() => {})
                failures.push({
                  path: change.originalPath,
                  reason: `wrote ${change.movePath} but could not remove the original ${change.originalPath} (${errorMessage(deleteError)}); rolled the new file back — the original is unchanged`,
                })
                continue
              }
              mtimes.clear(change.originalPath)
              await mtimes.recordNow(change.movePath)
              modifiedPaths.push(change.movePath)
            } else {
              await env.writeFile(change.path, change.newContent)
              await mtimes.recordNow(change.path)
              modifiedPaths.push(change.path)
            }
            applied.push(change)
            publishProgress('applying', applied.length, change.path)
          } catch (error) {
            failures.push({ path: change.path, reason: errorMessage(error) })
          }
        }

        const { additions, deletions, files } = projectPatchChanges(applied)

        const details: PatchToolDetails = {
          cwd,
          status: 'completed',
          files,
          totalFiles: hunks.length,
          appliedFiles: applied.length,
          failedFiles: failures.length || undefined,
          failures: failures.length > 0 ? failures : undefined,
          additions,
          deletions,
        }

        // Before the diagnostics wait below (it can take seconds, and a clean tab reloads in that
        // time): each applied file against its pre-write disk text.
        const editorNotes = editorBuffer
          ? applied
              // The ORIGINAL path: a moved file's open tab still holds the old one.
              .map((change) => editorBuffer(change.originalPath, change.oldContent, 'write'))
              .filter(Boolean)
              .join('\n\n')
          : ''

        // Notify the LSP about every changed file and append errors to the result.
        const diagnostics =
          modifiedPaths.length > 0
            ? await reportDiagnostics?.(modifiedPaths).catch(() => undefined)
            : undefined

        const content = buildAppliedPatchSummary(
          applied,
          details,
          matchNotes,
          aborted,
          diagnostics,
          editorNotes,
        )

        // Zero files applied → a hard (retryable) failure so the agent loop treats the
        // call as failed and retries. Any partial success is a normal result whose body
        // lists exactly which files still need a corrected patch.
        if (applied.length === 0) {
          const kind = failures.some((f) => /file not found/.test(f.reason))
            ? 'not_found'
            : 'validation'
          return errorResult(content, kind, true)
        }
        return { content, details }
      })
    },
  })
}
