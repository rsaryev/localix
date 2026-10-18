/**
 * A semantic source over a small catalog listed whole — capabilities (skills, plugins, MCP
 * servers, agents) number in the tens, not thousands — across the scopes it lives in: the
 * global items, then each project's own (an item a project merely inherits from global is not
 * listed twice). Items are keyed `<scope>:<name>`. The list is read on each scan and read;
 * unchanged items cost a hash compare in the indexer, not an embed.
 */
import {
  SEMANTIC_GLOBAL_SCOPE,
  type SemanticSource,
  type SemanticSourceItem,
} from '@localixai/plugin-sdk/backend'

/** One catalog row, as its owner lists it for a scope. */
export interface CatalogRow {
  /** Unique within its scope. */
  name: string
  /** The name a person knows it by. */
  title: string
  /** What it is for. */
  description: string
}

/** A catalog item's key in its collection, and the name back from one. */
export const catalogKey = (scope: string, name: string) => `${scope}:${name}`
export const catalogNameOf = (key: string) => key.slice(key.indexOf(':') + 1)

export function createScopedCatalogSource(options: {
  collection: string
  label: string
  /** Bump when what an item's text holds changes: every item is embedded again. */
  version: number
  /** Whose catalog it is (the workspace owner). */
  owner: string
  /** The projects whose own items are listed beside the global ones. */
  projects: () => Promise<readonly string[]>
  /** The rows visible in a scope: global (`null`), or a project's (with the global ones). */
  list: (projectId: string | null) => Promise<readonly CatalogRow[]>
}): SemanticSource {
  const same = (row: CatalogRow) => `${row.name}\n${row.title}\n${row.description}`
  const item = (row: CatalogRow, scope: string): SemanticSourceItem => ({
    key: catalogKey(scope, row.name),
    userId: options.owner,
    title: row.title,
    text: row.description.trim() || row.title,
    scope,
  })

  /** A failing list costs only its own scope. */
  async function all(): Promise<SemanticSourceItem[]> {
    const global = await options.list(null).catch(() => [])
    const inherited = new Set(global.map(same))
    const out = global.map((row) => item(row, SEMANTIC_GLOBAL_SCOPE))
    for (const projectId of await options.projects().catch(() => [])) {
      for (const row of await options.list(projectId).catch(() => [])) {
        if (!inherited.has(same(row))) out.push(item(row, projectId))
      }
    }
    return out
  }

  return {
    collection: options.collection,
    label: options.label,
    version: options.version,
    async scan(cursor, limit) {
      const items = await all()
      const from = cursor ? Number(cursor) : 0
      return {
        items: items.slice(from, from + limit),
        next: from + limit < items.length ? String(from + limit) : null,
      }
    },
    async read(keys) {
      const wanted = new Set(keys)
      return (await all()).filter((i) => wanted.has(i.key))
    },
    async count() {
      return (await all()).length
    },
  }
}
