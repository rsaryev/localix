import { normalizePermissionMode } from '@rsaryev/llx-plugin'
import { hookTightensOnly } from '@rsaryev/llx-plugin/mods'

/**
 * `tool.check`'s merge as the kit decides it (plugins/mods/events.md, "Approve or refuse a tool
 * call before the user is asked"; permissions.md, "Hook approvals in plan mode"): the decision the
 * host reached and the one a mod answered give the call's decision. Where hooks only tighten (plan
 * mode, `hooksTightenOnlyIn`), a mod may refuse a call that is not read-only but not approve it.
 */
export { mergeToolCheck, type ToolCheckContext, type ToolDecision } from '@rsaryev/llx-plugin/mods'

/** Whether a run in `mode`, in Claude Code's spelling (`ccPermissionMode`), lets hooks only tighten. */
export const hooksTightenOnlyIn = (mode: string): boolean =>
  hookTightensOnly(normalizePermissionMode(mode) ?? 'default')
