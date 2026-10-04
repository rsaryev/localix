import { TOOL } from './tool-names'

/**
 * The "# Execution discipline" rules BOTH variants state, one builder each.
 *
 * The defect these stop is the second copy. The chat and sub-agent variants each wrote their
 * own routing and batching lines, the chat variant then wrote routing TWICE ("Prefer dedicated
 * file tools…" and, one line later, "Edit with the dedicated file tools…"), and the preview
 * rule was a six-line block pasted into both. A rule restated is a rule that drifts: the
 * sub-agent's copy still taught `old_string` hygiene the `edit` schema already carries.
 *
 * Every builder is gated on the tools the run holds and returns `null` when there is nothing
 * true to say, so a caller never renders advice about a tool that is not there.
 */

type Has = (name: string) => boolean
const any = (has: Has, ...names: string[]) => names.some(has)

/** Which dedicated tool does which file job, and what the shell is left for. */
export function fileRoutingLine(has: Has): string | null {
  const routes = [
    has(TOOL.read) && '`read` over `cat`',
    has(TOOL.search) && '`search` over `grep`/`find`',
    has(TOOL.edit) && '`edit` for one exact change',
    has(TOOL.apply_patch) &&
      `\`apply_patch\` for ${has(TOOL.edit) ? 'several hunks or files' : 'changes to existing files'}`,
    has(TOOL.write) && '`write` for new files',
  ].filter((route): route is string => Boolean(route))
  if (routes.length === 0) {
    return has(TOOL.bash)
      ? '- Use `bash` for workspace inspection, file changes, and process work; prefer non-interactive commands.'
      : null
  }
  const readFirst =
    any(has, TOOL.edit, TOOL.apply_patch) && any(has, TOOL.read, TOOL.search, TOOL.bash)
      ? ' Read before editing so the change targets the current text.'
      : ''
  // In one session every agent wrote its HTML/CSS/JS on one line, so five of its patches
  // failed: a context line is a whole line, and the only line was the entire stylesheet.
  const layout = any(has, TOOL.edit, TOOL.apply_patch, TOOL.write)
    ? ' Write source one rule or statement per line, never minified, so later edits can target it.'
    : ''
  const shell = has(TOOL.bash)
    ? ' Reserve `bash` for process work (installs, builds, tests, git).'
    : ''
  return `- Prefer the dedicated file tools: ${routes.join(', ')}.${readFirst}${layout}${shell}`
}

/**
 * Round trips are the cost lever: independent calls in one turn run in parallel. Re-reading
 * is not restated here — "# Core principles" owns "do not reread or rerun for reassurance".
 */
export function batchLine(has: Has): string | null {
  if (!any(has, TOOL.read, TOOL.search, TOOL.write, TOOL.edit, TOOL.apply_patch, TOOL.bash))
    return null
  const example = has(TOOL.write) ? ' (five new files are one turn of five `write`s)' : ''
  return `- Batch independent tool calls into ONE turn${example}; keep interdependent edits together, never one file or one command per turn.`
}

export function lspDiagnosticsLine(has: Has): string | null {
  if (!any(has, TOOL.write, TOOL.apply_patch)) return null
  const tools = [TOOL.edit, TOOL.write, TOOL.apply_patch]
    .filter(has)
    .map((name) => `\`${name}\``)
    .join('/')
  return `- Diagnostics are BEST-EFFORT: ${tools} may append \`<lsp_diagnostics>\`. Fix reported errors; do not rerun a build only to rediscover them. No block is not proof of a clean build.`
}

/**
 * The `<editor_buffer>` note (`chat/runtime/run/editor-buffer-note.ts`): a file tool saw that
 * the person has the file open with unsaved edits. The note says what the edits are; only the
 * prompt can say what to DO — the failure it prevents is writing over them and leaving the
 * person to untangle a reconcile banner they did not cause.
 */
export function editorBufferLine(has: Has): string | null {
  if (!any(has, TOOL.read, TOOL.edit, TOOL.write, TOOL.apply_patch)) return null
  return '- An `<editor_buffer>` note means the person has that file open with UNSAVED edits: treat them as part of the file, keep your change compatible with them, and say so when your write will make them reconcile.'
}

/**
 * What counts as EVIDENCE from the preview. How the tool behaves (ids, viewport, refs) is the
 * `browser` schema's; this is the part no schema can say. An unattended run opens in
 * the background because nobody is watching the panel it would take over.
 */
export function previewVerificationLine(has: Has, unattended: boolean): string | null {
  if (!has(TOOL.browser)) return null
  return `- Verify web work in the native preview with \`browser\`${unattended ? ', opened with background:true' : ''}: an opened URL proves neither probe readiness nor a working interaction, and resizing is not real-device touch. Recover from the reported error instead of retrying blindly; report an unavailable host as blocked.`
}

/**
 * The delegated child's REPORT, stated once. It used to be in three places — the sub-agent
 * role guidance, this section, and the task prompt a delegation sends — each listing a
 * slightly different set of fields.
 */
export function childReportLine(has: Has): string {
  return any(has, TOOL.read, TOOL.search, TOOL.write, TOOL.apply_patch, TOOL.bash)
    ? '- Your final reply is the report the parent reads: the outcome, the files or artifacts you changed, the checks you ran and what they showed, and anything failed, unverified or still open with the next action.'
    : '- Your final reply is the report the parent reads: the outcome grounded in the context you were given, and anything unverified or still open.'
}
