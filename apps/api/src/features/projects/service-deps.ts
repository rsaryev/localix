import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { ResourceExpansionResult } from './expand-refs'

export interface ProjectsServiceDeps {
  db: Kysely<AppDatabase>
  now?: () => string
  /** Builds the compact digest for a `@session:<id>` context-ref. Injected by
   *  bootstrap (reads the chat repository) so this feature stays chat-agnostic. */
  loadSessionDigest?: (userId: string, sessionId: string) => Promise<string | null>
  /** Builds the digest for a `@terminal:<id>` context-ref (id or unique prefix).
   *  Injected by bootstrap (reads the live terminal service). */
  loadTerminalDigest?: (userId: string, terminalId: string) => Promise<string | null>
  /** Builds the digest for a `@call:<toolCallId>` context-ref, scoped to the
   *  sending session's transcript. Injected by bootstrap (chat repository). */
  loadCallDigest?: (userId: string, sessionId: string, toolCallId: string) => Promise<string | null>
  /** Builds the digest for a `@project:<id>` context-ref (name, working dir,
   *  session roster). Injected by bootstrap; introspection only, never secrets. */
  loadProjectDigest?: (userId: string, projectId: string) => Promise<string | null>
  /** Builds the digest for a `@message:<sessionId>/<messageId>` context-ref (one
   *  transcript message's role + capped text). Injected by bootstrap. */
  loadMessageDigest?: (
    userId: string,
    sessionId: string,
    messageId: string,
  ) => Promise<string | null>
  /** Resolves a `@resource:<uri>` context-ref via the resource-provider registry.
   *  Injected by bootstrap (registry.expand bound to the user); keeps this feature
   *  free of agent-core/database imports. */
  loadResource?: (
    userId: string,
    uri: string,
    scope?: { sessionId?: string },
  ) => Promise<ResourceExpansionResult>
  /**
   * The directory a session works in, for a user who owns it — REJECTS for a missing or
   * foreign session. Injected by bootstrap (chat's session-cwd seam, which owns the root
   * rule), so this feature never re-derives a sandbox path from an id.
   */
  resolveSessionCwd?: (userId: string, sessionId: string) => Promise<string>
}
