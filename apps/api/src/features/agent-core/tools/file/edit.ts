/**
 * `edit` — replace exact spans of text, in one file or several, in ONE call.
 *
 * The str_replace edit, and the only targeted-change tool. A context-line patch tool once
 * failed 4 of 26 calls on a small landing page because a hunk's context lines drifted by a
 * space. An exact `old_string` has no context lines to get wrong, so a weaker model lands its
 * edit first time.
 *
 * Batched because a call per change was a model round-trip per change. Claude Code MultiEdit
 * semantics per file (`edit-apply.ts`): edits apply in order to the in-memory text, and the
 * first one that cannot match fails that whole file — nothing is written for it. Across files
 * each file stands alone (`file-batch.ts`): the others are still applied and the result names
 * which failed and why.
 *
 * Same host guarantees as `write`, from the same owners: path scope (`resolveFileTarget`),
 * per-path locks taken for every file of the call together, the stale-mtime guard, the
 * read/write bookkeeping shared with `read`, CRLF/BOM preservation, and LSP
 * diagnostics folded into the result.
 */
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'
import { TOOL } from '../../tool-names'
import {
  createFileMtimeStore,
  resolveFileTarget,
  staleFileMessage,
  withPathLocks,
  workspaceLockPaths,
  type DiagnosticsReporter,
  type EditorBufferProbe,
  type FileMtimeStore,
  type FileToolConcurrencyOptions,
} from './file-utils'
import { detectLineEnding, normalizeToLF, restoreLineEndings, stripBom } from './file-line-endings'
import type { ExecutionEnvironment } from '../environment'
import { localEnvironment } from '../environments/local'
import { fileWriteClass } from './file-call-class'
import { applyEditSteps, type EditStep } from './edit-apply'
import {
  appliedFile,
  batchResult,
  failedFile,
  type FileBatchDetails,
  type FileResult,
} from './file-batch'
import { mutationTargets, prepareEditArguments } from './mutation-input'
import { statIfExists } from '@localixai/mini-app-sdk/backend'

const editEntrySchema = z.object({
  path: z.string().min(1).describe('The file, relative to cwd.'),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Copied verbatim from a `Read` result (same indentation and line breaks); include a line or two around it when it is not unique.',
    ),
  new_string: z.string().describe('The replacement; empty deletes the span.'),
  replace_all: z
    .boolean()
    .optional()
    .describe('Replace every occurrence instead of requiring exactly one.'),
})

const editObjectSchema = z.object({
  edits: z
    .array(editEntrySchema)
    .min(1)
    .describe(
      'Applied in order; edits to one file each match the text the previous one left. A failing edit leaves its whole file unchanged; other files still apply.',
    ),
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
})

/** The advertised shape, with the single-file shapes lifted into it (`mutation-input.ts`). */
export const editToolInputSchema = z.preprocess(prepareEditArguments, editObjectSchema)

export type EditToolInput = z.infer<typeof editObjectSchema>
export type EditToolDetails = FileBatchDetails

/** The call's edits grouped by resolved file, in first-seen order, each keeping its index. */
function groupByFile(input: EditToolInput, defaultCwd: string | undefined) {
  const files = new Map<string, EditStep[]>()
  let cwd = ''
  for (const [index, edit] of input.edits.entries()) {
    const target = resolveFileTarget(edit.path, input.cwd, defaultCwd)
    cwd = target.cwd
    const steps = files.get(target.path) ?? []
    steps.push({ index, ...edit })
    files.set(target.path, steps)
  }
  return { cwd: cwd || resolveFileTarget('.', input.cwd, defaultCwd).cwd, files }
}

export function createEditTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  reportDiagnostics?: DiagnosticsReporter,
  concurrency?: FileToolConcurrencyOptions,
  /** Session-scoped read/write bookkeeping shared with read and write. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Says when the file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  /** One file: read, apply its edits in memory, write only when every edit landed. */
  async function editFile(
    path: string,
    steps: readonly EditStep[],
    labelled: boolean,
  ): Promise<FileResult> {
    const existing = await statIfExists(path)
    if (!existing?.isFile()) {
      return failedFile(path, `${path} does not exist. Use \`Write\` to create a new file.`)
    }
    if (mtimes.isStale(path, existing.mtimeMs)) {
      return failedFile(path, staleFileMessage(path), true)
    }
    const raw = await env.readFile(path)
    const { bom, text: original } = stripBom(raw)
    const ending = detectLineEnding(original)
    const text = normalizeToLF(original)
    const applied = applyEditSteps(text, steps, path, mtimes, labelled)
    if (!applied.ok) return failedFile(path, applied.message, true)

    // Before the write: afterwards a clean tab and one with unsaved edits look the same.
    const editorNote = editorBuffer?.(path, raw, 'write') ?? ''
    await env.writeFile(path, bom + restoreLineEndings(applied.text, ending))
    await mtimes.recordNow(path)
    const { replacements, lines, skipped } = applied
    const editCount = steps.length > 1 ? `${steps.length} edits, ` : ''
    const where = `line${lines.length === 1 ? '' : 's'} ${[...new Set(lines)].join(', ')}`
    const noOps = skipped.length
      ? `; skipped ${skipped.map((index) => `edits[${index}]`).join(', ')} (new_string identical to old_string)`
      : ''
    const result = appliedFile(
      path,
      `Edited ${path}: ${editCount}${replacements} replacement${replacements === 1 ? '' : 's'} (${where})${noOps}`,
      { replacements, diff: createTwoFilesPatch(path, path, original, applied.text) },
    )
    return { ...result, editorNote }
  }

  return defineAgentTool<EditToolInput, EditToolDetails>({
    name: TOOL.Edit,
    label: 'Edit',
    activeVerb: 'Editing',
    // Which edit tool fits which change is the prompt's routing line, stated once there.
    description:
      'Replace exact spans of text in existing files: each `old_string` → `new_string`, where `old_string` must occur exactly once unless `replace_all`. Put every change you know of, in one file or several, in ONE call.',
    inputSchema: editToolInputSchema,
    prepareArguments: prepareEditArguments,
    executionMode: concurrency?.parallel ? 'parallel' : 'sequential',
    parallelScopePaths: (input) => mutationTargets(prepareEditArguments(input), defaultCwd),
    mutates: true,
    // Undeclared, an edit reads as `external`; it only ever reaches files (path rules judge
    // which), and the conversation's own plan file is session state (`file-call-class.ts`).
    classify: (input) => fileWriteClass(mutationTargets(prepareEditArguments(input), defaultCwd)),
    async execute(_toolCallId, rawInput) {
      // Idempotent on the canonical shape; a direct caller may still hand a single-file shape.
      const input = prepareEditArguments(rawInput) as EditToolInput
      const { cwd, files } = groupByFile(input, defaultCwd)
      const labelled = input.edits.length > 1
      return withPathLocks(workspaceLockPaths(cwd, [...files.keys()]), async () => {
        const results: FileResult[] = []
        for (const [path, steps] of files) {
          try {
            results.push(await editFile(path, steps, labelled))
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            results.push(failedFile(path, `Could not edit ${path}: ${reason}`))
          }
        }
        const changed = results.filter((r) => !r.outcome.failed).map((r) => r.outcome.path)
        const diagnostics = changed.length
          ? await reportDiagnostics?.(changed).catch(() => undefined)
          : undefined
        return batchResult(cwd, results, diagnostics)
      })
    },
  })
}
