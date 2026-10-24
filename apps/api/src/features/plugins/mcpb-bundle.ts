import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'

import { errorMessage } from '../../lib/errors'
import { childEnv } from '../../lib/login-shell-env'
import { isRecord } from '../../lib/record'
import { confineToDir } from '../ext/fs-discovery'
import { fetchChecked, httpsPublicHop, readCapped } from './marketplace-download'
import { verifyZipMembers } from './marketplace-zip-inflate'
import { scanZip } from './marketplace-zip-scan'
import type { PluginConfigOption } from './contracts-base'

const execFileAsync = promisify(execFile)

/**
 * A packaged MCP server — an MCPB bundle (`.mcpb`, or the older `.dxt`) — named by a plugin's
 * `mcpServers`, as Claude Code reads one (plugins/components, "Include a packaged MCPB server"): a
 * path inside the plugin or an `https://` URL, extracted (a URL downloaded first) into
 * `.mcpb-cache/` under the plugin root, the server named after the bundle manifest's `name` and
 * started with its `server.mcp_config`. The bundle's own `user_config` options join the plugin's
 * settings as `<server>.<key>`; a required one with no saved value keeps the server from starting.
 */

export const MCPB_CACHE_DIR = '.mcpb-cache'
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024

/** A settings option a bundle declares, in the plugin's own config shape. */
export type BundleOption = PluginConfigOption

const OPTION_TYPES: readonly string[] = ['string', 'number', 'boolean', 'directory', 'file']

export interface McpBundles {
  servers: Record<string, Record<string, unknown>>
  /** `<server>.<key>` → option. */
  options: Record<string, BundleOption>
  /** Server name → its required option keys (`<server>.<key>`). */
  required: Record<string, string[]>
  errors: string[]
}

export const isMcpBundle = (ref: string) => /\.(mcpb|dxt)$/i.test(ref.split(/[?#]/)[0] ?? ref)

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** The bundle file a ref names: inside the plugin, or downloaded once into the cache. */
async function bundleFile(pluginDir: string, ref: string): Promise<string> {
  if (!/^https:\/\//i.test(ref)) {
    const file = confineToDir(pluginDir, ref)
    if (!file) throw new Error(`mcpServers path escapes plugin directory: ${ref}`)
    return file
  }
  const cached = join(pluginDir, MCPB_CACHE_DIR, `${hash(ref)}${extname(new URL(ref).pathname)}`)
  if (await fs.stat(cached).catch(() => null)) return cached
  const download = {
    what: `Downloading ${ref}`,
    timeoutMs: 120_000,
    checkHop: httpsPublicHop,
    code: 'mcpb_download_failed',
  }
  const { response } = await fetchChecked(ref, download)
  const bytes = await readCapped(response, MAX_BUNDLE_BYTES, {
    ...download,
    tooLargeCode: 'mcpb_download_too_large',
  })
  await fs.mkdir(join(pluginDir, MCPB_CACHE_DIR), { recursive: true })
  await fs.writeFile(cached, bytes)
  return cached
}

/** Unpack a bundle into the cache once per content, refusing a zip bomb first. */
async function extracted(pluginDir: string, file: string): Promise<string> {
  const bytes = await fs.readFile(file)
  const stem = basename(file, extname(file))
  const out = join(pluginDir, MCPB_CACHE_DIR, `${stem}-${hash(bytes)}`)
  if (await fs.stat(join(out, 'manifest.json')).catch(() => null)) return out
  await verifyZipMembers(bytes, scanZip(bytes).members)
  await fs.mkdir(out, { recursive: true })
  // `unzip` skips entries with `..` or absolute paths, so nothing lands outside `out`.
  await execFileAsync('unzip', ['-q', '-o', file, '-d', out], {
    timeout: 60_000,
    env: childEnv(),
    windowsHide: true,
  })
  return out
}

/** Replace an MCPB manifest's variables in every string of `value`. */
function substitute(value: unknown, vars: (name: string) => string | undefined): unknown {
  if (typeof value === 'string')
    return value.replace(/\$\{([^}]+)\}/g, (match, name: string) => vars(name) ?? match)
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, vars))
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]))
  return value
}

/** The server config a bundle manifest declares, for this platform. */
function serverConfig(manifest: Record<string, unknown>): Record<string, unknown> | undefined {
  const server = isRecord(manifest.server) ? manifest.server : undefined
  if (!server) return undefined
  const base = isRecord(server.mcp_config) ? server.mcp_config : undefined
  const entry = typeof server.entry_point === 'string' ? server.entry_point : undefined
  const fallback = !entry
    ? undefined
    : server.type === 'node'
      ? { command: 'node', args: [`\${__dirname}/${entry}`] }
      : server.type === 'python'
        ? { command: 'python3', args: [`\${__dirname}/${entry}`] }
        : { command: `\${__dirname}/${entry}` }
  const config: Record<string, unknown> | undefined = base ?? fallback
  const overrides = isRecord(config?.platform_overrides) ? config.platform_overrides : undefined
  const own = overrides && isRecord(overrides[process.platform]) ? overrides[process.platform] : {}
  if (!config) return undefined
  const { platform_overrides: _overrides, ...rest } = { ...config, ...(own as object) }
  return rest
}

/** Read every bundle a plugin names, in order; one that cannot load says why. */
export async function loadMcpBundles(
  pluginDir: string,
  refs: readonly string[],
): Promise<McpBundles> {
  const out: McpBundles = { servers: {}, options: {}, required: {}, errors: [] }
  for (const ref of refs) {
    try {
      const root = await extracted(pluginDir, await bundleFile(pluginDir, ref))
      const manifest = JSON.parse(await fs.readFile(join(root, 'manifest.json'), 'utf8')) as unknown
      if (!isRecord(manifest) || typeof manifest.name !== 'string')
        throw new Error('the bundle manifest has no name')
      const name = manifest.name
      const config = serverConfig(manifest)
      if (!config) throw new Error('the bundle manifest declares no server')
      const declared = isRecord(manifest.user_config) ? manifest.user_config : {}
      for (const [key, raw] of Object.entries(declared)) {
        if (!isRecord(raw)) continue
        out.options[`${name}.${key}`] = {
          type: (typeof raw.type === 'string' && OPTION_TYPES.includes(raw.type)
            ? raw.type
            : 'string') as BundleOption['type'],
          ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
          description: typeof raw.description === 'string' ? raw.description : '',
          required: raw.required === true,
          secret: raw.sensitive === true,
          ...(['string', 'number', 'boolean'].includes(typeof raw.default)
            ? { default: raw.default as string | number | boolean }
            : {}),
        }
      }
      out.required[name] = Object.keys(declared)
        .filter((key) => isRecord(declared[key]) && declared[key].required === true)
        .map((key) => `${name}.${key}`)
      out.servers[name] = substitute(config, (variable) => {
        if (variable === '__dirname') return root
        if (variable === 'HOME') return homedir()
        if (variable === '/' || variable === 'pathSeparator') return '/'
        // The plugin's settings resolve the bundle's options (`<server>.<key>`) at connect time.
        if (variable.startsWith('user_config.'))
          return `\${user_config.${name}.${variable.slice(12)}}`
        return undefined
      }) as Record<string, unknown>
    } catch (error) {
      out.errors.push(`Failed to load MCP bundle ${ref}: ${errorMessage(error)}`)
    }
  }
  return out
}
