import { readJsonFile } from '../../lib/json'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_LOCATIONS, type MergedSource } from '@localixai/claude-plugin'
import { resolveWithin } from '@localixai/path-containment'

import { pathExists } from '../ext/fs-discovery'
import { toAbsList } from './discovery-paths'

/**
 * The files behind a plugin's merged components (hooks, MCP and LSP servers) and its hooks
 * module, read for `resolveEntrypoints`. A file that cannot be read or parsed contributes nothing.
 */

/** Read + JSON-parse a file, returning `undefined` on any read/parse error (contributes nothing). */
/** Read an `.mcp.json`-style file: accepts `{ mcpServers: {…} }` or a bare `{ name: {…} }`. */
export async function readMcpJson(file: string): Promise<Record<string, Record<string, unknown>>> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const servers = (parsed.mcpServers ?? parsed) as Record<string, unknown>
    const out: Record<string, Record<string, unknown>> = {}
    for (const [k, v] of Object.entries(servers)) {
      if (v && typeof v === 'object') out[k] = v as Record<string, unknown>
    }
    return out
  } catch {
    return {}
  }
}

/**
 * A merged component's configs in Claude Code's order: the default file when it exists, then
 * each listed file (read with `read`) and inline map as the manifest lists them.
 */
export async function mergedConfigs<T>(
  dir: string,
  defaultFile: string,
  source: MergedSource,
  read: (file: string) => Promise<T | undefined>,
): Promise<Array<T | Record<string, unknown>>> {
  const fallback = join(dir, defaultFile)
  const files = toAbsList(dir, source.files).filter((file) => file !== fallback)
  const [first, ...listed] = await Promise.all([
    pathExists(fallback).then((exists) => (exists ? read(fallback) : undefined)),
    ...files.map(read),
  ])
  return [
    ...[first, ...listed].filter((config): config is Awaited<T> => config !== undefined),
    ...source.inline,
  ]
}

/**
 * The first `modules` entry of the plugin's hooks files (the default one first), resolved against
 * the file that names it and kept only inside the plugin.
 */
export async function findHookModule(
  dir: string,
  listed: readonly string[],
): Promise<string | undefined> {
  const files = [join(dir, DEFAULT_LOCATIONS.hooks), ...toAbsList(dir, [...listed])]
  for (const file of files) {
    const config = await readJsonFile(file)
    const modules = (config as { modules?: unknown } | undefined)?.modules
    if (!Array.isArray(modules) || typeof modules[0] !== 'string') continue
    const module = resolveWithin(dir, resolve(dirname(file), modules[0]))
    if (module) return module
  }
  return undefined
}
