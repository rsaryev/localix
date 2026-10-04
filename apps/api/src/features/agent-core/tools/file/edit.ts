/**
 * `edit` — replace one exact span of a file with another.
 *
 * The str_replace edit, alongside `apply_patch`. `apply_patch` failed 4 of 26 calls on a
 * small landing page because a hunk's context lines drifted by a space. An exact
 * `old_string` has no context lines to get wrong, so a weaker model lands its edit first time,
 * and the patch tool stays for the multi-file, multi-hunk work it is good at.
 *
 * Same host guarantees as `write`/`apply_patch`, from the same owners: path scope
 * (`resolveFileTarget`), per-path locks, the stale-mtime guard, the read/write bookkeeping the
 * `read` dedup stub relies on, CRLF preservation, and LSP diagnostics folded into the result.
 */
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
  scopePathInput,
  staleFileMessage,
  statIfExists,
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
import { buildToolError } from '../tool-errors'
import { fileOpenMarkdownLink, fileUiUri } from '../source-refs'
import { fileWriteClass } from './file-call-class'

export const editToolInputSchema = z.object({
  path: z.string().min(1).describe('The file, relative to cwd. Emit this field FIRST.'),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Copied verbatim from a `read` result (same indentation and line breaks); include a line or two around it when it is not unique.',
    ),
  new_string: z.string().describe('The replacement; empty deletes the span.'),
  replace_all: z
    .boolean()
    .optional()
    .describe('Replace every occurrence instead of requiring exactly one.'),
  cwd: z.string().optional().describe('Base for relative paths (defaults to the session root).'),
})

export interface EditToolDetails {
  path: string
  openUri: string
  cwd: string
  replacements: number
  diff?: string
}

/** 1-based line numbers at which `needle` starts in `haystack`. */
function occurrenceLines(haystack: string, needle: string): number[] {
  const lines: number[] = []
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return lines
    lines.push(haystack.slice(0, at).split('\n').length)
    from = at + needle.length
  }
}

/**
 * Why an exact match failed, in the terms the model can act on. Order matters: the
 * whitespace diagnosis is the common typo; the unread/edited-outside causes are the ones the
 * patch tool learned the hard way (13 of 65 recorded context failures were on unread files).
 */
function noMatchDiagnosis(
  text: string,
  oldString: string,
  path: string,
  mtimes: FileMtimeStore,
): string {
  const squash = (s: string) =>
    s
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .trim()
  if (squash(text).includes(squash(oldString))) {
    return ' The text exists but differs in indentation or spacing — copy it exactly as `read` printed it.'
  }
  if (mtimes.wasInvalidated(path)) {
    return ` ${path} was modified outside this session after you last read it; read it again and rebuild \`old_string\` from the current content.`
  }
  if (!mtimes.has(path)) {
    return ` You have not read ${path} with the \`read\` tool in this session, so \`old_string\` came from memory. Read it first, then edit.`
  }
  return ' Re-read the region and copy the current text verbatim.'
}

export function createEditTool(
  env: ExecutionEnvironment = localEnvironment,
  defaultCwd?: string,
  reportDiagnostics?: DiagnosticsReporter,
  concurrency?: FileToolConcurrencyOptions,
  /** Session-scoped read/write bookkeeping shared with read, write and apply_patch. */
  mtimes: FileMtimeStore = createFileMtimeStore(),
  /** Says when the file is open in the person's editor with unsaved edits. */
  editorBuffer?: EditorBufferProbe,
) {
  return defineAgentTool<z.infer<typeof editToolInputSchema>, EditToolDetails>({
    name: TOOL.edit,
    label: 'Edit',
    activeVerb: 'Editing',
    // Which edit tool fits which change is the prompt's routing line, stated once there.
    description:
      'Replace an exact span of text in an existing file: `old_string` → `new_string`. `old_string` must occur exactly once, or pass `replace_all`.',
    inputSchema: editToolInputSchema,
    executionMode: concurrency?.parallel ? 'parallel' : 'sequential',
    parallelScopePaths: (input) => {
      const s = scopePathInput(input)
      return s ? [resolveFileTarget(s.path, s.cwd, defaultCwd).path] : []
    },
    mutates: true,
    // Undeclared, an edit reads as `external`; it only ever reaches a file (path rules judge which),
    // and the conversation's own plan file is session state (`file-call-class.ts`).
    classify: (input) => {
      const s = scopePathInput(input)
      return fileWriteClass(s ? [resolveFileTarget(s.path, s.cwd, defaultCwd).path] : [])
    },
    async execute(_toolCallId, input) {
      if (input.old_string === input.new_string) {
        return buildToolError({
          message: '`new_string` is identical to `old_string` — nothing to change.',
        })
      }
      const target = resolveFileTarget(input.path, input.cwd, defaultCwd)
      return withPathLocks(workspaceLockPaths(target.cwd, [target.path]), async () => {
        const existing = await statIfExists(target.path)
        if (!existing?.isFile()) {
          return buildToolError({
            message: `${target.path} does not exist. Use \`write\` to create a new file.`,
          })
        }
        if (mtimes.isStale(target.path, existing.mtimeMs)) {
          return buildToolError({ message: staleFileMessage(target.path), retryable: true })
        }

        const raw = await env.readFile(target.path)
        // Before the write: afterwards a clean tab and one with unsaved edits look the same.
        const editorNote = editorBuffer?.(target.path, raw, 'write') ?? ''
        const { bom, text: original } = stripBom(raw)
        const ending = detectLineEnding(original)
        const text = normalizeToLF(original)
        const oldString = normalizeToLF(input.old_string)
        const newString = normalizeToLF(input.new_string)

        const lines = occurrenceLines(text, oldString)
        if (lines.length === 0) {
          return buildToolError({
            message:
              `\`old_string\` was not found in ${target.path}.` +
              noMatchDiagnosis(text, oldString, target.path, mtimes),
            retryable: true,
          })
        }
        if (lines.length > 1 && !input.replace_all) {
          return buildToolError({
            message:
              `\`old_string\` occurs ${lines.length} times in ${target.path} (lines ${lines.join(', ')}). ` +
              'Include surrounding lines to make it unique, or pass `replace_all: true` to change every occurrence.',
            retryable: true,
          })
        }

        const updated = input.replace_all
          ? text.split(oldString).join(newString)
          : text.replace(oldString, () => newString)
        const content = bom + restoreLineEndings(updated, ending)
        await env.writeFile(target.path, content)
        await mtimes.recordNow(target.path)

        const details: EditToolDetails = {
          path: target.path,
          openUri: fileUiUri({ path: target.path }),
          cwd: target.cwd,
          replacements: lines.length,
          diff: capDiff(createTwoFilesPatch(target.path, target.path, original, updated)),
        }
        const diagnostics = await reportDiagnostics?.([target.path]).catch(() => undefined)
        return {
          content: appendEditorBufferNote(
            appendDiagnostics(
              `Edited ${details.path}: ${details.replacements} replacement${details.replacements === 1 ? '' : 's'} (line ${lines.join(', ')})\nOpen in Localix: ${fileOpenMarkdownLink(details.path)}`,
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
