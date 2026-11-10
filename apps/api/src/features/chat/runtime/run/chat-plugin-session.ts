/**
 * The chat's session of the kit's plugin host, for this run: opened at the chat's first run, a
 * turn of the same session at each later one, forgotten when the chat is deleted
 * (`agent-runner-lifecycle.ts`). The folder, trust and directories are the ones the run's hooks
 * read from Claude Code's settings; the run's catalog gives the host its user installs and the
 * session its project's own, and its agent's selection is the session's `enabledPlugins`.
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
import type { PermissionMode } from '../../../../contracts/permission-modes'
import {
  settingsAdditionalDirectories,
  type ChatPluginSessions,
  type ClaudeSettings,
  type ScopePlugin,
} from '../../../plugins/kit'
import { ccPermissionMode } from './cc-hook-session-facts'

/** What the run's hooks already read: the folder and Claude Code's settings there. */
export interface ChatPluginSessionFacts {
  readonly chatId: string
  readonly cwd: string
  readonly settings: ClaudeSettings
  /** The plugins of the run's catalog, with this agent's selection (`LoadedPlugins.kitPlugins`). */
  readonly plugins: readonly ScopePlugin[]
}

export function openChatPluginSession(
  sessions: ChatPluginSessions | undefined,
  facts: ChatPluginSessionFacts,
  transcriptPath: string,
  permissionMode: PermissionMode | undefined,
): void {
  sessions?.forRun({
    chatId: facts.chatId,
    cwd: facts.cwd,
    transcriptPath,
    permissionMode: ccPermissionMode(permissionMode ?? 'default'),
    trusted: facts.settings.trusted,
    additionalDirectories: settingsAdditionalDirectories(facts.settings),
    layers: facts.settings.layers,
    plugins: facts.plugins,
  })
}
