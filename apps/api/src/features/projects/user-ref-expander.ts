import type { ContextRef, ContextRefExpansion } from './contracts'
import { expandContextRefs, type ResourceExpansionResult } from './expand-refs'

/**
 * The ref expanders bound to one user — the single owner of how a `@file`, `@session`, `@call`…
 * reads. Both callers go through it: the `/expand-refs` route (after resolving its own scope) and
 * Context Fabric's host-reference resolver (with the server-minted session workspace).
 */
export interface UserRefLoaders {
  loadSessionDigest?: (userId: string, sessionId: string) => Promise<string | null>
  loadTerminalDigest?: (userId: string, terminalId: string) => Promise<string | null>
  loadCallDigest?: (userId: string, sessionId: string, toolCallId: string) => Promise<string | null>
  loadProjectDigest?: (userId: string, projectId: string) => Promise<string | null>
  loadMessageDigest?: (
    userId: string,
    sessionId: string,
    messageId: string,
  ) => Promise<string | null>
  loadResource?: (
    userId: string,
    uri: string,
    scope?: { sessionId?: string },
  ) => Promise<ResourceExpansionResult>
}

export interface UserRefExpansionInput {
  /** A directory the caller already trusts as the confinement root. */
  workingDir: string
  refs: ContextRef[]
  /** The SENDING session — scopes `@call:` lookups to its own transcript. */
  sessionId?: string
  sizeOnly?: boolean
}

export function createUserRefExpander(loaders: UserRefLoaders) {
  return (userId: string, input: UserRefExpansionInput): Promise<ContextRefExpansion[]> =>
    expandContextRefs(
      input.workingDir,
      input.refs,
      {
        loadSessionDigest: loaders.loadSessionDigest
          ? (sessionId) => loaders.loadSessionDigest!(userId, sessionId)
          : undefined,
        loadTerminalDigest: loaders.loadTerminalDigest
          ? (terminalId) => loaders.loadTerminalDigest!(userId, terminalId)
          : undefined,
        loadCallDigest:
          loaders.loadCallDigest && input.sessionId
            ? (toolCallId) => loaders.loadCallDigest!(userId, input.sessionId!, toolCallId)
            : undefined,
        loadProjectDigest: loaders.loadProjectDigest
          ? (projectId) => loaders.loadProjectDigest!(userId, projectId)
          : undefined,
        loadMessageDigest: loaders.loadMessageDigest
          ? (sessionId, messageId) => loaders.loadMessageDigest!(userId, sessionId, messageId)
          : undefined,
        loadResource: loaders.loadResource
          ? (uri) => loaders.loadResource!(userId, uri, { sessionId: input.sessionId })
          : undefined,
      },
      input.sizeOnly ?? false,
    )
}
