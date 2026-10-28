import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { parseWorkflowMeta } from '@localixai/claude-plugin'

import type { WorkflowEntry } from '../agent-core/tools/workflow/workflow'
import { claudeConfigDir } from '../cc-settings/config-dir'

/** A workflow script is a small file; a larger one is not read. */
const MAX_BYTES = 512 * 1024

async function workflowsIn(dir: string): Promise<WorkflowEntry[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const found: WorkflowEntry[] = []
  for (const file of names.filter((name) => name.endsWith('.js')).sort()) {
    const path = join(dir, file)
    const stat = await fs.stat(path).catch(() => null)
    if (!stat?.isFile() || stat.size > MAX_BYTES) continue
    const source = await fs.readFile(path, 'utf8').catch(() => null)
    const parsed = source === null ? null : parseWorkflowMeta(source)
    if (parsed?.meta)
      found.push({ fullName: parsed.meta.name, description: parsed.meta.description, file: path })
  }
  return found
}

/** `.claude` folders from the working directory up to the repository root, closest first. */
async function projectDirs(cwd: string, home: string): Promise<string[]> {
  const dirs: string[] = []
  let cur = resolve(cwd)
  while (cur !== home) {
    dirs.push(join(cur, '.claude'))
    if (
      await fs.stat(join(cur, '.git')).then(
        () => true,
        () => false,
      )
    )
      return dirs
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return dirs.slice(0, 1)
}

/**
 * The workflows kept in folders, as Claude Code finds them: `.claude/workflows` of the project
 * (the closest folder first, up to the repository root), then `workflows` in the user's Claude
 * folder. A name found in a closer place wins; a plugin's workflow keeps its `<plugin>:` prefix, so
 * it never clashes with these.
 */
export async function listFolderWorkflows(opts: {
  cwd: string
  homeDir: string
}): Promise<WorkflowEntry[]> {
  const dirs = [...(await projectDirs(opts.cwd, opts.homeDir)), claudeConfigDir(opts.homeDir)]
  const seen = new Set<string>()
  const entries: WorkflowEntry[] = []
  for (const dir of dirs) {
    for (const entry of await workflowsIn(join(dir, 'workflows'))) {
      if (seen.has(entry.fullName)) continue
      seen.add(entry.fullName)
      entries.push(entry)
    }
  }
  return entries
}
