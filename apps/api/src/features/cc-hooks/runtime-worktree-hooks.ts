/**
 * Claude Code's `WorktreeCreate`: a configured hook makes an isolated agent's worktree in place of
 * `git worktree add`. There is no allow/block model: the hook returns the folder's path, and its
 * failure, or no path at all, fails the creation. `systemMessage` and `continue` are discarded.
 * The path comes back as the hook returned it, with the folder the hook ran in; the caller
 * resolves and screens it (`agent-core/tools/workflow/hook-worktree.ts`).
 */
import type { CcHookInput } from './contracts'
import type { HookDispatchDeps } from './runtime-tool-hooks'

/** What the WorktreeCreate handlers answered. */
export type WorktreeCreateResult =
  | {
      ok: true
      /** The path as the hook returned it: absolute, or relative to {@link cwd}. */
      path: string
      /** The folder the hook ran in. */
      cwd: string
    }
  | { ok: false; error: string }

export interface CcWorktreeHooksRuntime {
  /**
   * Make the worktree `name` with the WorktreeCreate hooks. Undefined when no handler runs (none
   * is registered, or every one is spent or guarded), so the caller uses git as without a hook.
   */
  runWorktreeCreate(name: string): Promise<WorktreeCreateResult | undefined>
}

export function createWorktreeHookRunners({
  select,
  runHandler,
  fireAsync,
  baseInput,
}: HookDispatchDeps): CcWorktreeHooksRuntime {
  return {
    async runWorktreeCreate(name) {
      // No matcher support: every handler runs, as in Claude Code.
      const selected = select('WorktreeCreate', () => true)
      if (!selected) return undefined
      const input: CcHookInput = { ...baseInput('WorktreeCreate'), name }
      fireAsync(selected.async, input)
      let path: string | undefined
      // Every handler must succeed; the last path one of them returned is the worktree.
      for (const handler of selected.sync) {
        const outcome = await runHandler('WorktreeCreate', handler, input, false)
        if (outcome.failed) {
          const why = outcome.failed === 'timeout' ? 'it timed out' : outcome.reason || 'it failed'
          return { ok: false, error: `a WorktreeCreate hook failed: ${why}` }
        }
        if (outcome.worktreePath) path = outcome.worktreePath
      }
      return path
        ? { ok: true, path, cwd: input.cwd }
        : { ok: false, error: 'the WorktreeCreate hook returned no worktree path' }
    },
  }
}
