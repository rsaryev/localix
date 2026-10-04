import type { AgentRecord } from './contracts'
import { BUILTIN_TEAM } from './builtin-team'

/**
 * WHAT SHIPS: the team, and nothing beside it.
 *
 * Three more used to — an implementer, a verifier and a researcher — offered for delegation.
 * They are gone. Implementing, reviewing and investigating are not separate colleagues but
 * things each member of the team does in the course of its work, and shipping one agent per verb
 * asked the person to choose a role where they had only ever wanted to choose a person.
 */
export const BUILTIN_AGENTS: readonly AgentRecord[] = [...BUILTIN_TEAM]

const byName = new Map(BUILTIN_AGENTS.map((record) => [record.handle, record]))

export const isBuiltinAgentName = (name: string): boolean => byName.has(name)

export const builtinAgentRecord = (handle: string): AgentRecord | null => byName.get(handle) ?? null
