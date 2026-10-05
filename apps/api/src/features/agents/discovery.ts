import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentRecord } from './contracts'
import { decodeNativeAgent } from './native-format'
import { BUILTIN_AGENTS, isBuiltinAgentName } from './builtin'
import { belongsToNativeScope } from './registry-identity'
import { builtinOverrideHash } from './builtin-override'

export const globalAgentsDir = (home = homedir()): string => join(home, '.localix', 'agents')
export const projectAgentsDir = (cwd: string): string => join(cwd, '.localix', 'agents')

export interface DiscoveredAgent {
  projectId: string
  manifest: { name: string }
  record: AgentRecord
  scope: 'global' | 'project'
  path: string
  builtin: boolean
}

export interface AgentFile {
  record: AgentRecord
  path: string
}

/** Native storage has one strict format. External formats enter through import adapters. */
export async function parseAgentRecordJson(file: string): Promise<AgentRecord | null> {
  try {
    const stat = await fs.lstat(file)
    if (!stat.isFile() || stat.size > 1024 * 1024) return null
    const parsed = decodeNativeAgent(await fs.readFile(file, 'utf8'), file)
    return parsed.status === 'accepted' ? parsed.value : null
  } catch {
    return null
  }
}

export async function listAgentFiles(dir: string): Promise<AgentFile[]> {
  let names: string[]
  try {
    names = (await fs.readdir(dir, { withFileTypes: true }))
      .flatMap((entry) => (entry.isFile() && entry.name.endsWith('.json') ? [entry.name] : []))
      .sort()
  } catch {
    return []
  }
  const files = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name)
      const record = await parseAgentRecordJson(path)
      return record ? { record, path } : null
    }),
  )
  return files.filter((file): file is AgentFile => file !== null)
}

/** Definitions are isolated by installation/project; shipped definitions join every catalog. */
export async function discoverAgents(opts: {
  cwd: string | null
  projectId: string
  globalDir?: string
  approvedBuiltinOverrides?: ReadonlyMap<string, string>
}): Promise<DiscoveredAgent[]> {
  // A missing project directory must not silently select the installation's definitions.
  if (opts.projectId && !opts.cwd) return []
  const project = Boolean(opts.projectId)
  const projectId = project ? opts.projectId : ''
  const scope = project ? ('project' as const) : ('global' as const)
  const dir = project ? projectAgentsDir(opts.cwd!) : (opts.globalDir ?? globalAgentsDir())
  const byHandle = new Map<string, DiscoveredAgent>()
  const ids = new Set<string>()
  for (const { record, path } of await listAgentFiles(dir)) {
    if (byHandle.has(record.handle) || ids.has(record.id)) continue
    const shipped = BUILTIN_AGENTS.find((agent) => agent.id === record.id)
    // A scoped override retains the shipped identity and handle. Other identities remain
    // isolated, and a mismatched handle cannot impersonate a shipped agent.
    if (shipped && shipped.handle !== record.handle) continue
    if (
      shipped &&
      project &&
      opts.approvedBuiltinOverrides?.get(record.id) !== builtinOverrideHash(record)
    )
      continue
    if (!shipped && !belongsToNativeScope(record.id, projectId)) continue
    ids.add(record.id)
    byHandle.set(record.handle, {
      projectId,
      manifest: { name: record.id },
      record,
      scope,
      path,
      builtin: isBuiltinAgentName(record.handle) && Boolean(shipped),
    })
  }
  for (const record of BUILTIN_AGENTS) {
    if (!byHandle.has(record.handle)) {
      byHandle.set(record.handle, {
        projectId,
        manifest: { name: record.id },
        record,
        scope,
        path: '',
        builtin: true,
      })
    }
  }
  return [...byHandle.values()]
}
