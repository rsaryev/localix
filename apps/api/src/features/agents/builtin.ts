import type { AgentRecord } from './contracts'
import { BUILTIN_TEAM } from './builtin-team'

/** Localix is the sole shipped definition; specialists are authored when needed. */
export const BUILTIN_AGENTS: readonly AgentRecord[] = [...BUILTIN_TEAM]

const byName = new Map(BUILTIN_AGENTS.map((record) => [record.handle, record]))

export const isBuiltinAgentName = (name: string): boolean => byName.has(name)

export const builtinAgentRecord = (handle: string): AgentRecord | null => byName.get(handle) ?? null
