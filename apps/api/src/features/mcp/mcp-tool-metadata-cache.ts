import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { errorMessage } from '../../lib/errors'
import type { McpToolDef } from './mcp-client-contracts'

export interface ToolMetadataEntry {
  serverName: string
  toolDefs: McpToolDef[]
}

interface StoredToolMetadataCache {
  version: 1
  entries: Array<[string, ToolMetadataEntry]>
}

export const MAX_PERSISTED_TOOL_LISTS = 128

function isStoredToolDef(value: unknown): value is McpToolDef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const def = value as Record<string, unknown>
  return (
    typeof def.name === 'string' &&
    Boolean(def.name) &&
    Boolean(def.inputSchema) &&
    typeof def.inputSchema === 'object' &&
    !Array.isArray(def.inputSchema)
  )
}

export function readToolMetadataCache(file: string): Map<string, ToolMetadataEntry> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredToolMetadataCache>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return new Map()
    const entries = parsed.entries.flatMap((candidate): Array<[string, ToolMetadataEntry]> => {
      if (!Array.isArray(candidate) || candidate.length !== 2) return []
      const [key, value] = candidate
      if (typeof key !== 'string' || !value || typeof value !== 'object') return []
      const record = value as Partial<ToolMetadataEntry>
      if (
        typeof record.serverName !== 'string' ||
        !Array.isArray(record.toolDefs) ||
        !record.toolDefs.every(isStoredToolDef)
      ) {
        return []
      }
      return [[key, { serverName: record.serverName, toolDefs: record.toolDefs }]]
    })
    return new Map(entries.slice(-MAX_PERSISTED_TOOL_LISTS))
  } catch {
    return new Map()
  }
}

export function writeToolMetadataCache(
  metadataFile: string | undefined,
  toolMetadata: Map<string, ToolMetadataEntry>,
  logger?: { warn(msg: string, meta?: unknown): void },
): void {
  if (!metadataFile) return
  const stored: StoredToolMetadataCache = {
    version: 1,
    entries: [...toolMetadata.entries()],
  }
  const temporary = `${metadataFile}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(metadataFile), { recursive: true, mode: 0o700 })
    writeFileSync(temporary, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
    renameSync(temporary, metadataFile)
    chmodSync(metadataFile, 0o600)
  } catch (err) {
    logger?.warn('Failed to persist MCP tool metadata cache', { error: errorMessage(err) })
  }
}
