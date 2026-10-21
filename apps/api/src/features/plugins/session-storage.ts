import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { defaultDbFile, localixHome, resolveDbFile } from '../../lib/env'

/**
 * THE ONE PLACE A PLUGIN KEEPS DATA THAT BELONGS TO ONE CHAT SESSION — and the guarantee that it
 * goes when that session does.
 *
 * The defect this layout exists to stop: session data used to live inside the session's sandbox
 * (`workspace/<session>/.localix/plugin-data/<plugin>`), so it was removed only as a side effect
 * of the sandbox cleanup — which, on purpose, never touches a session filed in a project (its
 * directory is the user's) or a sub-session (it shares the root's). A game played in a project
 * chat outlived the chat. So session data has its OWN tree, keyed by session first:
 *
 *   ~/.localix/session-data/<session id>/<plugin name>/
 *
 * Deleting a session removes `session-data/<id>` for every session in the deleted subtree
 * ({@link discardSessionData}), for every plugin at once, without knowing which plugins wrote
 * there — a new plugin is covered the day it ships, and no plugin can opt out by forgetting.
 */

const SAFE_PLUGIN_NAME = /^[a-z0-9][a-z0-9._-]{0,127}$/

/**
 * A startup sweep asks only its own database which sessions exist. Sharing the production
 * directory with an alternate database therefore deletes production data as "orphaned".
 * Keep the established default path, but give every alternate DB its own sibling directory.
 */
export function sessionDataRoot(databaseFile = resolveDbFile()): string {
  const database = resolve(databaseFile)
  return database === resolve(defaultDbFile())
    ? join(localixHome(), 'session-data')
    : `${database}.session-data`
}

/** One session's folder: every plugin's data for it lives beneath. */
export function sessionDataDir(sessionId: string, root = sessionDataRoot()): string {
  if (!sessionId.trim()) throw new Error('A session id is required')
  // Encoded, so an id can never name a path outside its own folder ("..", "a/b").
  return join(root, encodeURIComponent(sessionId))
}

export function pluginSessionDataDir(
  pluginName: string,
  sessionId: string,
  root = sessionDataRoot(),
): string {
  if (!SAFE_PLUGIN_NAME.test(pluginName)) throw new Error('Invalid plugin name')
  return join(sessionDataDir(sessionId, root), pluginName)
}

/**
 * The plugin's folder for a session, created on first use. `authorize` runs FIRST and rejects a
 * session the user does not own or that no longer exists — before anything touches the disk, so
 * a stale id can never recreate the folder of a deleted session.
 */
export async function resolvePluginSessionDataDir(options: {
  pluginName: string
  userId: string
  sessionId: string
  authorize: (userId: string, sessionId: string) => Promise<unknown>
  root?: string
}): Promise<string> {
  await options.authorize(options.userId, options.sessionId)
  const directory = pluginSessionDataDir(options.pluginName, options.sessionId, options.root)
  await mkdir(directory, { recursive: true })
  return directory
}

/**
 * Remove every plugin's data for `sessionIds` — a deleted session and its whole subtree. Runs after
 * the session rows are gone, so the ownership check above already refuses these ids and nothing can
 * write the folders back. Best-effort per folder: a folder that will not delete (an open handle)
 * must not fail the deletion of the session itself, nor stop the others from being removed.
 */
export async function discardSessionData(
  sessionIds: readonly string[],
  root = sessionDataRoot(),
): Promise<void> {
  await Promise.all(
    sessionIds.map((id) =>
      rm(sessionDataDir(id, root), { recursive: true, force: true }).catch(() => {}),
    ),
  )
}

/**
 * Remove the data of sessions that no longer exist — the backstop behind {@link
 * discardSessionData}, run once at startup.
 *
 * Deletion removes a session's folder, but two things can still leave one behind: the process
 * dying between the rows going and the folder going, and a request that passed its ownership
 * check an instant before the deletion and wrote after it. Neither can be ruled out by ordering
 * alone, so the invariant — a folder here belongs to a live session — is restored by reconciling
 * against the database.
 *
 * FAIL-CLOSED: `existing` answers which ids are live; if it throws, nothing is removed, because a
 * failed lookup is not proof a session is gone. Returns the ids whose folders were removed.
 */
export async function sweepOrphanSessionData(input: {
  existing: (sessionIds: readonly string[]) => Promise<ReadonlySet<string>>
  root?: string
}): Promise<string[]> {
  const root = input.root ?? sessionDataRoot()
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const ids = entries.flatMap((entry) => {
    if (!entry.isDirectory()) return []
    try {
      return [decodeURIComponent(entry.name)]
    } catch {
      return []
    }
  })
  if (ids.length === 0) return []
  const live = await input.existing(ids)
  const orphans = ids.filter((id) => !live.has(id))
  await discardSessionData(orphans, root)
  return orphans
}

/**
 * The folders `pluginName` already has, one per session, without creating any: what a plugin's
 * cross-chat cleanup walks (a deleted agent unassigned from every board).
 */
export async function listPluginSessionDataDirs(
  pluginName: string,
  root = sessionDataRoot(),
): Promise<{ sessionId: string; dir: string }[]> {
  if (!SAFE_PLUGIN_NAME.test(pluginName)) throw new Error('Invalid plugin name')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return []
      let sessionId: string
      try {
        sessionId = decodeURIComponent(entry.name)
      } catch {
        return []
      }
      const dir = join(root, entry.name, pluginName)
      const present = await stat(dir).then(
        (info) => info.isDirectory(),
        () => false,
      )
      return present ? [{ sessionId, dir }] : []
    }),
  )
  return found.flat()
}
