import type {
  AutomaticContextProvider,
  AutomaticContextRequest,
  ContextContribution,
  ContextProviderContribution,
} from '@localixai/mini-app-sdk/backend'
import { createResourceContextProvider } from '@localixai/mini-app-sdk/backend'
import { fnv1aHex } from '@localixai/mini-app-sdk/backend'
import { providerSegments } from '@localixai/mini-app-sdk/backend'
import { DATABASE_RESOURCE_PROVIDER } from './resource-provider-id'
import { createDatabaseResourceProvider, type ResourceDbService } from './resource-provider'
import { extractSqlTableRefs } from '../shared/sql-context'

export { extractSqlTableRefs } from '../shared/sql-context'

/**
 * Mini-app-owned Context Fabric resolver for selected `localix://resource/db` resources. It reuses
 * the mini app's read-only resource provider as the expander, so ownership checks and the
 * no-credentials expansion contract stay in one boundary; the shared factory owns the
 * revisioning and capture-then-replay machinery. Core remains unaware of database
 * types, connection details, and schema serialization.
 *
 * The kind mapping is the one thing genuinely database-specific: a SQL expansion is a
 * schema, anything else is a plain resource. The provider id is NOT passed: the factory
 * derives it from the expander, which is this mini app's own `ResourceRefProvider` and
 * therefore the authority on the provider id it owns.
 */
export function createDatabaseContextProvider(
  service: ResourceDbService,
): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'database:context',
    namespace: 'database',
    kind: (language) => (language === 'sql' ? 'database-schema' : 'database-resource'),
    // SQL prediction links the connection root plus the tables in the focused
    // statement. Exact table/column schemas must survive the global context
    // budget before the broad root inventory; recent queries remain supporting
    // evidence rather than displacing the types/FKs the completion relies on.
    priority: (uri) => {
      const depth = providerSegments(DATABASE_RESOURCE_PROVIDER, uri)?.length ?? 0
      return depth >= 5 ? 1_400 : depth >= 4 ? 1_300 : depth >= 3 ? 1_100 : 900
    },
    expander: createDatabaseResourceProvider(service),
  })
}

const AUTO_PROVIDER_ID = 'database:auto-context'
const AUTO_PROVIDER_VERSION = '1'
/** Hard, provider-owned budget for the automatic active-schema summary. The host
 *  clips `maxTokens` again at collection time; this keeps the provider itself cheap. */
const AUTO_MAX_CONNECTIONS = 3
const AUTO_MAX_TABLES_PER_CONNECTION = 40
const AUTO_MAX_CONTENT_CHARS = 4_000

/**
 * Extract table-like identifiers referenced in a SQL document. Pure + language-neutral
 * enough for the common dialects: the identifier that follows FROM/JOIN/INTO/UPDATE/TABLE.
 * Returns a lower-cased, de-duplicated set of BARE names (schema-qualified names are
 * reduced to their last segment) so the automatic provider can match them against
 * introspected table names without any dialect-specific parsing.
 */
/**
 * Identity of the exact schema summary this provider emitted. The digest is the shared
 * FNV-1a owner (`lib/fnv1a`) — this was the third open-coding of that same loop, seed
 * and prime. Identical bytes in, identical digest out, so consolidating churns no
 * persisted revision string.
 */
function autoRevision(parts: string[]): string {
  const input = parts.join('\n')
  return `db-auto:${fnv1aHex(input)}:${input.length}`
}

/**
 * Bounded AUTOMATIC context provider for the active SQL document (Edit Prediction).
 * Given a `.sql`/SQL-console buffer, it introspects the user's LIVE connections and
 * emits a compact, introspection-only summary of the schemas/tables the buffer
 * references — never DDL bodies, never a connection URL/credential (reuses the
 * resource provider's no-credentials `list`/`schemas` path).
 *
 * PRIVACY POSTURE: registered `defaultEnabled:false`. An automatic domain source is
 * off until a user explicitly enables it (plan §13). It is validated, quota-bounded,
 * revisioned and contract-tested regardless, so it is a ready reference for the
 * explicit-vs-automatic split without changing today's chat/prediction behaviour.
 */
export function createDatabaseAutomaticContextProvider(
  service: ResourceDbService,
): ContextProviderContribution {
  const provider: AutomaticContextProvider = {
    id: AUTO_PROVIDER_ID,
    version: AUTO_PROVIDER_VERSION,
    destinations: ['edit-prediction'],
    sensitivity: 'project',
    async provide(req: AutomaticContextRequest, signal): Promise<ContextContribution[]> {
      if (signal.aborted) return []
      if (req.destination !== 'edit-prediction') return []
      const document = req.document
      if (document?.languageId.toLowerCase() !== 'sql' || !document.content.trim()) return []

      const referenced = new Set(extractSqlTableRefs(document.content))
      if (referenced.size === 0) return []

      const connections = await service.list(req.userId).catch(() => [])
      if (signal.aborted) return []
      const live = connections
        .filter((connection) => connection.connected)
        .slice(0, AUTO_MAX_CONNECTIONS)

      const contributions: ContextContribution[] = []
      let spentChars = 0
      for (const connection of live) {
        if (signal.aborted) break
        const introspection = await service.schemas(req.userId, connection.id).catch(() => null)
        if (signal.aborted) break
        if (!introspection) continue
        const matched: string[] = []
        for (const items of Object.values(introspection.schemas)) {
          for (const item of items) {
            if (referenced.has(item.name.toLowerCase())) matched.push(item.name)
            if (matched.length >= AUTO_MAX_TABLES_PER_CONNECTION) break
          }
          if (matched.length >= AUTO_MAX_TABLES_PER_CONNECTION) break
        }
        if (matched.length === 0) continue
        const content = `Connection ${connection.name} [${connection.dialect}] — referenced tables: ${matched.join(', ')}`
        if (spentChars + content.length > AUTO_MAX_CONTENT_CHARS) break
        spentChars += content.length
        contributions.push({
          id: `database-auto:${connection.id}`,
          providerId: AUTO_PROVIDER_ID,
          providerVersion: AUTO_PROVIDER_VERSION,
          scope: 'session',
          kind: 'database-active-schema',
          content,
          revision: autoRevision([connection.id, ...matched]),
          priority: 400,
          sensitivity: 'project',
          relevanceHints: { explicit: false, symbols: matched },
        })
      }
      return contributions
    },
  }
  return {
    provider,
    destinations: ['edit-prediction'],
    activation: 'automatic',
    // Off by default: an automatic domain source requires explicit user enablement.
    defaultEnabled: false,
    maxTokens: 1_500,
    timeoutMs: 1_500,
    sensitivity: 'project',
  }
}
