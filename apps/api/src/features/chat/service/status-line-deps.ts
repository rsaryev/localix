import type { ManagedSettingsSource } from '../../cc-settings/managed-settings'
import type { HookCommandOptions, runHookCommand } from '../../lifecycle-hooks/command'
import type { SessionRecord } from '../repository'
import type { StatusLineModelInfo } from './status-line-input'
import type { StatusLineUsage } from './status-line-usage'
import type { StatusLineWorkspace } from './status-line-workspace'
import type { Timers } from './subagent-rows-live'

/** What a conversation's status line reads from, and where it draws; all injectable for tests. */
export interface StatusLineDeps {
  requireSession(userId: string, sessionId: string): Promise<SessionRecord>
  resolveSessionWorkingDir(userId: string, session: SessionRecord): Promise<string>
  usage(userId: string, sessionId: string): Promise<StatusLineUsage>
  /** The route's model as the catalog names it. */
  modelInfo?(
    userId: string,
    route: { providerConnectionId: string | null; modelId: string },
  ): Promise<StatusLineModelInfo>
  /** The folder's git repository and linked worktree; read from git by default. */
  workspace?(cwd: string): Promise<StatusLineWorkspace>
  /** The conversation's transcript file (`transcript_path`). */
  transcriptPath?(userId: string, session: SessionRecord, cwd: string): Promise<string>
  /** Draw (or with `undefined`, clear) the conversation's line: its rows, `\n` between. */
  publish(sessionId: string, text: string | undefined): void
  /** Is a client rendering the conversation? The refresh timer runs only then. */
  watched(userId: string, sessionId: string): boolean
  /** Call `onChange` when a settings file in `dirs` changes; returns the stop function. */
  watchSettings?(dirs: readonly string[], onChange: () => void): () => void
  homeDir?: string
  env?: Record<string, string | undefined>
  managed?: ManagedSettingsSource | null
  timers?: Timers
  run?: (options: HookCommandOptions) => ReturnType<typeof runHookCommand>
}
