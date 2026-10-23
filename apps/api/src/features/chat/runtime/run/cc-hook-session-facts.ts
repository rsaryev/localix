/**
 * What a run tells its Claude Code hooks about the session, beyond its id and folder: the
 * permission mode in Claude Code's spelling, the subagent a delegated child is, and where the
 * session's `CLAUDE_ENV_FILE`s live (read back by the bash tool before each command).
 *
 * Layer rule: run/ may import runtime infrastructure + agent-core, never features/chat/service*.
 */
import { join } from 'node:path'

import type { PermissionMode } from '../../../../contracts/permission-modes'
import { ccSessionEnvFiles, type CcSessionEnvFiles } from '../../../cc-hooks'
import { sessionDataDir } from '../../../mini-apps/session-storage'
import type { SessionRecord } from '../../repository'

/**
 * hooks.md `permission_mode`: `default`, `plan`, `acceptEdits`, `auto`, `dontAsk` or
 * `bypassPermissions`. Bypass and autonomous both let every call through without a card.
 */
const CC_PERMISSION_MODE: Record<PermissionMode, string> = {
  default: 'default',
  plan: 'plan',
  bypass: 'bypassPermissions',
  autonomous: 'bypassPermissions',
}

export function ccPermissionMode(mode: PermissionMode): string {
  return CC_PERMISSION_MODE[mode]
}

/**
 * The subagent a delegated child's hooks fire in: its id is the one SubagentStart reported (the
 * child session's), its type the plugin agent type or the seated agent, as the parent named it.
 */
export function ccSubagentOf(
  session: Pick<SessionRecord, 'id' | 'provenance'>,
  speakerAgentId: string,
): { id: string; type: string } | undefined {
  const provenance = session.provenance
  if (provenance?.kind !== 'task-delegation') return undefined
  return { id: session.id, type: provenance.pluginAgent ?? speakerAgentId }
}

/**
 * The session tree's `CLAUDE_ENV_FILE`s: kept with the root's session data, so a delegated child's
 * commands see what the conversation's SessionStart hooks exported, and removed with the session.
 */
export function ccSessionEnvFilesOf(
  session: Pick<SessionRecord, 'id' | 'rootSessionId'>,
  dataRoot?: string,
): CcSessionEnvFiles {
  return ccSessionEnvFiles(
    join(sessionDataDir(session.rootSessionId ?? session.id, dataRoot), '.claude-code'),
  )
}
