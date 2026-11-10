/**
 * The chat's session of the kit's plugin host, for this run: opened at the chat's first run, a
 * turn of the same session at each later one, forgotten when the chat is deleted
 * (`agent-runner-lifecycle.ts`). The folder, trust and directories are the ones the run's hooks
 * read from Claude Code's settings.
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
import type { PermissionMode } from '../../../../contracts/permission-modes'
import { claudeCodeHome } from '../../../cc-settings/config-dir'
import { settingsAdditionalDirectories } from '../../../cc-settings/settings-permissions'
import type { SettingsLayer } from '../../../cc-settings/settings-files'
import type { ChatPluginSessions } from '../../../plugins/kit'
import { ccPermissionMode } from './cc-hook-session-facts'

/** What the run's hooks already read: the folder, its trust, and Claude Code's settings files. */
export interface ChatPluginSessionFacts {
  readonly chatId: string
  readonly cwd: string
  readonly trusted: boolean
  readonly layers: readonly SettingsLayer[]
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
    trusted: facts.trusted,
    additionalDirectories: settingsAdditionalDirectories(facts.layers, {
      projectTrusted: facts.trusted,
      cwd: facts.cwd,
      homeDir: claudeCodeHome(),
    }),
  })
}
