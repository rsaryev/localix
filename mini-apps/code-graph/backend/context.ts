import {
  createResourceContextProvider,
  type MiniAppHostServices,
  type ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import { location } from '../shared/format'
import { nodeOfUri, nodeUri } from '../shared/resource'
import { describeDetail, statusLine } from './describe'
import { searchNodes } from './graph/search'
import { projectStructure } from './graph/structure'
import { nodeDetail } from './graph/view'
import { projectIndex } from './indexing/projects'

/**
 * Nodes as attachable resources: `@` in the composer finds a class or a file on the map and links
 * it, and the message carries that node's relations — who uses it and what it uses — rather than
 * its source, which the file tools already read.
 *
 * The project is resolved from the chat the attachment is made in; a provider that used the
 * backend's load-time directory would describe the wrong project in every chat but the first.
 */
const EXPAND_WAIT_MS = 10_000
const EXPAND_BUDGET = 4000

export function createGraphResourceProvider(
  dataDir: string,
  fallbackRoot: string,
  host: MiniAppHostServices | undefined,
): ResourceRefProvider {
  const rootFor = async (userId: string, sessionId?: string) =>
    (sessionId
      ? await host?.workspaceScope?.resolveSessionRoot(userId, sessionId).catch(() => null)
      : null) ?? fallbackRoot

  return {
    provider: 'code-graph',
    title: 'Code graph',
    async listChildren(userId, parentUri, query, scope) {
      if (parentUri !== null) return []
      const published = projectIndex(dataDir, await rootFor(userId, scope?.sessionId)).current
      if (!published) return []
      const nodes = query
        ? searchNodes(published.graph, query, { limit: 20 }).map((hit) => hit.node)
        : projectStructure(published.graph).hubFiles
      return nodes.map((node) => ({
        uri: nodeUri(node.id),
        label: node.name,
        detail: `${node.kind} · ${location(node)} · ${node.dependents} dependents`,
        hasChildren: false,
        icon: node.kind,
      }))
    },
    async expand(userId, uri, scope) {
      const id = nodeOfUri(uri)
      if (!id) return { ok: false }
      const index = projectIndex(dataDir, await rootFor(userId, scope?.sessionId))
      const published = await index.ready(EXPAND_WAIT_MS)
      const detail = published ? nodeDetail(published.graph, id) : null
      if (!detail) return { ok: false }
      return {
        ok: true,
        content: `${statusLine(index.snapshot(), published)}\n\n${describeDetail(detail, EXPAND_BUDGET)}`,
        language: 'text',
      }
    },
  }
}

export function createGraphContextProvider(resourceProvider: ResourceRefProvider) {
  return createResourceContextProvider({
    id: 'code-graph:node-context',
    namespace: 'code-graph',
    expander: resourceProvider,
    accepts: (uri) => nodeOfUri(uri) !== null,
    destinations: ['chat', 'subagent'],
    sensitivity: 'project',
    maxTokens: 1200,
  })
}
