import { join } from 'node:path'
import { stableStringify } from '@localixai/agent'
import { localixHome } from '../../lib/env'
import type { McpToolDef } from './mcp-wire'
import {
  MAX_PERSISTED_TOOL_LISTS,
  readToolMetadataCache,
  writeToolMetadataCache,
  type ToolMetadataEntry,
} from './mcp-tool-metadata-cache'
import type { McpLogger } from './client-manager-types'

export interface ToolMetadataStore {
  get(key: string): ToolMetadataEntry | undefined
  reconcile(
    key: string,
    serverName: string,
    liveToolDefs: McpToolDef[],
    logger?: McpLogger,
    channel?: boolean,
  ): void
}

/**
 * A persisted metadata cache makes a server's tools nameable before it starts, which is
 * only sound while Cached and Live stay distinguishable. Keep metadata separate from the
 * connection cache: presence here never implies that a transport is connected.
 *
 * Injected test managers (`persist: false`) stay process-local so tests cannot read or
 * mutate the user's cache.
 */
export function createToolMetadataStore(persist: boolean): ToolMetadataStore {
  const metadataFile = persist ? join(localixHome(), 'mcp-tool-cache.json') : undefined
  const toolMetadata = metadataFile
    ? readToolMetadataCache(metadataFile)
    : new Map<string, ToolMetadataEntry>()

  /** A re-list after `tools/list_changed` keeps what the connect learned about the server. */
  const previousChannel = (key: string) => toolMetadata.get(key)?.channel === true

  function get(key: string): ToolMetadataEntry | undefined {
    const metadata = toolMetadata.get(key)
    if (!metadata) return undefined
    // Map insertion order is the LRU order. A read promotes the entry.
    toolMetadata.delete(key)
    toolMetadata.set(key, metadata)
    return metadata
  }

  function reconcile(
    key: string,
    serverName: string,
    liveToolDefs: McpToolDef[],
    logger?: McpLogger,
    channel = previousChannel(key),
  ): void {
    const previous = get(key)
    if (previous && stableStringify(previous.toolDefs) !== stableStringify(liveToolDefs)) {
      const message = `MCP server "${serverName}" live tool list differs from cached metadata`
      const meta = {
        cachedTools: previous.toolDefs.map((tool) => tool.name),
        liveTools: liveToolDefs.map((tool) => tool.name),
      }
      if (logger) logger.warn(message, meta)
      else console.warn(`[mcp] ${message}`, meta)
    }
    toolMetadata.delete(key)
    toolMetadata.set(key, {
      serverName,
      toolDefs: liveToolDefs,
      ...(channel ? { channel: true } : {}),
    })
    while (toolMetadata.size > MAX_PERSISTED_TOOL_LISTS) {
      const oldest = toolMetadata.keys().next().value
      if (oldest === undefined) break
      toolMetadata.delete(oldest)
    }
    writeToolMetadataCache(metadataFile, toolMetadata, logger)
  }

  return { get, reconcile }
}
