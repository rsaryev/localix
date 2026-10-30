/**
 * SESSION RESIDUE — a reactor on the core change feed.
 *
 * Deleting a chat is a command (its runs are stopped first, then the subtree's rows go in one
 * transaction, each id announced `deleted`). What outlives the rows is cleaned here, per deleted
 * id, so a sub-session's residue goes too — the deletion used to reap only the root's:
 *
 *   - its monitors (live watch processes) and loops (the engine's in-memory read model; the
 *     trigger rows went with the foreign key);
 *   - its Event Center rows, which no foreign key reaches;
 *   - its scratch directory, `~/.localix/workspace/<id>`, unless a project lives there.
 *
 * Every step is idempotent, so a duplicate notice does nothing. The reconcile removes inbox rows
 * of chats that no longer exist (a notice lost while down).
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'
import type { ConsumerHandlers } from '@localixai/change-feed'

import { localixHome } from '../../lib/env'
import type { CoreCascades, CoreRefs } from '../changes/core-entities'

export interface SessionResiduePorts {
  stopMonitors(sessionId: string): void
  cancelLoops(sessionId: string): Promise<void> | void
  forgetNotifications(userId: string, sessionId: string): void
  /** Working dirs of the user's projects: a scratch dir that is one is never removed. */
  projectDirs(userId: string): Promise<readonly string[]>
  /** Sessions the inbox still has rows for, and which of them still exist. */
  inboxSessions(): Promise<ReadonlyArray<{ userId: string; sessionId: string }>>
  sessionExists(userId: string, sessionId: string): Promise<boolean>
  /** Where scratch directories live (tests). */
  workspaceDir?: string
}

export function createSessionResidue(ports: SessionResiduePorts) {
  const workspace = ports.workspaceDir ?? path.join(localixHome(), 'workspace')

  async function discardSandbox(userId: string, sessionId: string): Promise<void> {
    const dir = path.join(workspace, sessionId)
    if (path.dirname(dir) !== workspace) return
    const projects = (await ports.projectDirs(userId)).map((p) => path.resolve(p))
    if (projects.includes(path.resolve(dir))) return
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  async function deleted(userId: string, sessionId: string): Promise<void> {
    ports.stopMonitors(sessionId)
    await ports.cancelLoops(sessionId)
    ports.forgetNotifications(userId, sessionId)
    await discardSandbox(userId, sessionId)
  }

  async function reconcile(): Promise<void> {
    for (const { userId, sessionId } of await ports.inboxSessions())
      if (!(await ports.sessionExists(userId, sessionId)))
        ports.forgetNotifications(userId, sessionId)
  }

  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.session': (change) =>
      change.op === 'deleted' ? deleted(change.ref.userId, change.ref.id) : undefined,
    'chat.message': 'ignore',
    skill: 'ignore',
    plugin: 'ignore',
    'mini-app': 'ignore',
    'mini-app.marketplace': 'ignore',
    'mini-app.updates': 'ignore',
    mcp: 'ignore',
    agent: 'ignore',
    'capability.rule': 'ignore',
    project: 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': 'ignore',
  }
  return { handlers, reconcile, deleted }
}
