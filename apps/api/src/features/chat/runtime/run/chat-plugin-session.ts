/**
 * The chat's session of the kit's plugin host, for this run: opened at the chat's first run, a
 * turn of the same session at each later one, forgotten when the chat is deleted
 * (`agent-runner-lifecycle.ts`). The folder, trust and directories are the ones the run's hooks
 * read from Claude Code's settings.
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
import type { PermissionMode } from '../../../../contracts/permission-modes'
import {
  settingsAdditionalDirectories,
  type ChatPluginSessions,
  type ClaudeSettings,
} from '../../../plugins/kit'
import { ccPermissionMode } from './cc-hook-session-facts'

/** What the run's hooks already read: the folder and Claude Code's settings there. */
export interface ChatPluginSessionFacts {
  readonly chatId: string
  readonly cwd: string
  readonly settings: ClaudeSettings
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
  })
}
