import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'
import type { SpaceDocument, SpaceIssue } from '../shared/format/document'
import { parseSpace } from '../shared/format/parse'
import { serializeSpace } from '../shared/format/serialize'
import { applyOps } from '../shared/ops/apply'
import type { OpResult, SpaceOp } from '../shared/ops/contract'
import { applyPatch, isEmptyPatch, type SpacePatch } from '../shared/ops/draft'
import { BOARD_FILE } from '../shared/resource'
import { spaceTypes } from '../shared/types'
import { spacePaths, withProjectPaths } from './paths'

/**
 * Every read and write of a project's board goes through here, one at a time per project.
 *
 * The FILE is the truth: each change re-reads it, applies its operations and writes the whole
 * board back atomically (temp file, then rename), so an edit a person or the agent made to the
 * file directly is never overwritten by a stale copy in memory. A file that cannot be read at all
 * refuses writes (see `parseSpace`), so a typo in a hand edit is reported instead of being
 * replaced by an empty board.
 *
 * Undo is kept per ACTOR: the person's ⌘Z reverses the person's last change, not the layout the
 * agent just made. A history entry is the patch of what was actually written, and undoing it
 * leaves any record changed since as it is (`applyPatch`).
 */
export type SpaceActor = 'user' | 'agent'

export interface SpaceSnapshot {
  space: SpaceDocument
  issues: SpaceIssue[]
  writable: boolean
  /** A hash of the file's bytes: equal revisions are the same board. */
  revision: string
  canUndo: boolean
  canRedo: boolean
}

export class SpaceRefusal extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const HISTORY_LIMIT = 100

interface History {
  undo: SpacePatch[]
  redo: SpacePatch[]
}

interface Project {
  queue: Promise<unknown>
  history: Record<SpaceActor, History>
  listeners: Set<(revision: string) => void>
}

// Module-level: the host calls `register` for the backend and again for each run's tools, and
// both must share one queue and one history per project.
const projects = new Map<string, Project>()

function project(root: string): Project {
  let entry = projects.get(root)
  if (!entry) {
    entry = {
      queue: Promise.resolve(),
      history: { user: { undo: [], redo: [] }, agent: { undo: [], redo: [] } },
      listeners: new Set(),
    }
    projects.set(root, entry)
  }
  return entry
}

function announce(root: string, revision: string) {
  for (const listener of project(root).listeners) {
    // The file is already saved. A closed socket must not turn a successful write into a failure.
    try {
      listener(revision)
    } catch {
      /* the connection owns its teardown */
    }
  }
}

/** Run `task` after every earlier task for this project, whatever they did. */
function serialized<T>(root: string, task: () => Promise<T>): Promise<T> {
  const entry = project(root)
  const next = entry.queue.then(task, task)
  entry.queue = next.catch(() => undefined)
  return next
}

async function load(root: string) {
  const text = await readFile(spacePaths(root).file, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    },
  )
  return { ...parseSpace(text, spaceTypes), revision: revisionOf(text ?? '') }
}

function revisionOf(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function snapshot(
  root: string,
  read: Awaited<ReturnType<typeof load>>,
  actor: SpaceActor,
): SpaceSnapshot {
  const history = project(root).history[actor]
  return {
    space: read.space,
    issues: read.issues,
    writable: read.writable,
    revision: read.revision,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
  }
}

async function write(root: string, space: SpaceDocument) {
  const text = serializeSpace(space)
  await atomicWriteFile(spacePaths(root).file, text)
  return { ...parseSpace(text, spaceTypes), revision: revisionOf(text) }
}

function writableOrRefuse(read: Awaited<ReturnType<typeof load>>) {
  if (!read.writable)
    throw new SpaceRefusal(
      409,
      'space_unreadable',
      `The board file cannot be read, so it is not changed: ${read.issues[0]?.message ?? 'unknown problem'}. Repair ${BOARD_FILE} first.`,
    )
}

export const spaceStore = {
  subscribe: (root: string, listener: (revision: string) => void) => {
    const listeners = project(root).listeners
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  read: (root: string, actor: SpaceActor = 'user') =>
    serialized(root, async () => snapshot(root, await load(root), actor)),

  apply: (root: string, ops: readonly SpaceOp[], actor: SpaceActor) =>
    serialized(root, async (): Promise<{ snapshot: SpaceSnapshot; results: OpResult[] }> => {
      const read = await load(root)
      writableOrRefuse(read)
      const applied = applyOps(read.space, withProjectPaths(root, ops), { registry: spaceTypes })
      if (isEmptyPatch(applied.patch))
        return { snapshot: snapshot(root, read, actor), results: applied.results }
      const written = await write(root, applied.space)
      const history = project(root).history[actor]
      history.undo.push(applied.patch)
      if (history.undo.length > HISTORY_LIMIT) history.undo.shift()
      history.redo = []
      announce(root, written.revision)
      return { snapshot: snapshot(root, written, actor), results: applied.results }
    }),

  /** Undo (`0`) or redo (`1`) the actor's last change. */
  step: (root: string, side: 0 | 1, actor: SpaceActor = 'user') =>
    serialized(root, async (): Promise<{ snapshot: SpaceSnapshot; conflicts: string[] }> => {
      const read = await load(root)
      writableOrRefuse(read)
      const history = project(root).history[actor]
      const patch = (side === 0 ? history.undo : history.redo).pop()
      if (!patch) return { snapshot: snapshot(root, read, actor), conflicts: [] }
      const { space, conflicts } = applyPatch(read.space, patch, side)
      ;(side === 0 ? history.redo : history.undo).push(patch)
      const written = await write(root, space)
      announce(root, written.revision)
      return { snapshot: snapshot(root, written, actor), conflicts }
    }),
}
