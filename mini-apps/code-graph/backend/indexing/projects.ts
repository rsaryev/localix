import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProjectIndex } from './project-index'

/**
 * Every project's index, shared by the routes and every run's tools.
 *
 * Module-level on purpose: the host calls `register(ctx)` for the backend and again for each run,
 * and an index per call would parse the same tree once per chat. A handful of projects stay warm;
 * the least recently used one past that closes its cache and gives its memory back.
 */
const MAX_WARM_PROJECTS = 4

const projects = new Map<string, ProjectIndex>()

/** One key per directory, however it was spelled: a symlinked checkout is the same project. */
function canonical(root: string): string {
  try {
    return realpathSync(root)
  } catch {
    return resolve(root)
  }
}

export function projectIndex(dataDir: string, root: string): ProjectIndex {
  const key = canonical(root)
  const known = projects.get(key)
  if (known) {
    // Re-inserted to mark it most recently used.
    projects.delete(key)
    projects.set(key, known)
    return known
  }
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 16)
  const index = new ProjectIndex(key, join(dataDir, 'projects', digest))
  projects.set(key, index)
  while (projects.size > MAX_WARM_PROJECTS) {
    const [oldestKey, oldest] = projects.entries().next().value as [string, ProjectIndex]
    projects.delete(oldestKey)
    oldest.close()
  }
  return index
}

/** Close every cache: the mini app is being unloaded. */
export function closeProjects(): void {
  for (const index of projects.values()) index.close()
  projects.clear()
}
