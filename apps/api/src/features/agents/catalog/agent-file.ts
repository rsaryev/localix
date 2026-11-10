import { createHash } from 'node:crypto'
import type { ScopeAgent } from '../../plugins/kit'

/**
 * A subagent of a scope with what Localix keeps beside it. The definition is Claude Code's, as the
 * kit resolved it (`plugins/kit/agents.ts`); Localix adds where its binding lives, a hash of its
 * body that follows a file across a rename, and what a built-in does when delegated to. Its
 * `model` and `effort` are not read: the person chooses those in Localix's settings.
 */
export interface CatalogAgent extends ScopeAgent {
  /** '' for a user, managed, built-in or user-installed plugin's agent; else the project's id. */
  projectId: string
  bodyHash: string
  /** What the type does when delegated to: runs as the delegator (`general-purpose`). */
  self?: boolean
}

/** What a name means in a scope: the agent, the agents it could be, or none. */
export type ResolvedAgent = { agent: CatalogAgent } | { ambiguous: string[] } | null

/**
 * Claude Code's `.claude` folders of a scope, where Localix writes and watches agent files: the
 * managed one, the person's and the project's working directory's. `project` is null when the
 * scope has no project or its folder cannot be read now.
 */
export interface AgentFolders {
  managed: string
  user: string
  project: string | null
}

export const bodyHashOf = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)
