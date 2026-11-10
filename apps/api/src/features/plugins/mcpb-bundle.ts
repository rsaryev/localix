import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { promisify } from 'node:util'

import { childEnv } from '../../lib/login-shell-env'
import { confineToDir } from '../ext/fs-discovery'
import { fetchChecked, httpsPublicHop, readCapped } from './marketplace-download'
import { verifyZipMembers } from './marketplace-zip-inflate'
import { scanZip } from './marketplace-zip-scan'

const execFileAsync = promisify(execFile)

/**
 * The effects of a packaged MCP server — an MCPB bundle (`.mcpb`, or the older `.dxt`) — a plugin's
 * `mcpServers` names: the file, downloaded once when it is an `https://` URL, unpacked into the
 * plugin's bundle cache, and its `manifest.json` read. What the manifest means (the server, its
 * variables, its settings) is the kit's (`kit/ports/mcp-bundle.ts`).
 */

const MAX_BUNDLE_BYTES = 256 * 1024 * 1024

const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** The bundle file a ref names: inside the plugin, or downloaded once into the cache. */
async function bundleFile(pluginDir: string, ref: string, cacheDir: string): Promise<string> {
  if (!/^https:\/\//i.test(ref)) {
    const file = confineToDir(pluginDir, ref)
    if (!file) throw new Error(`mcpServers path escapes plugin directory: ${ref}`)
    return file
  }
  const cached = join(pluginDir, cacheDir, `${hash(ref)}${extname(new URL(ref).pathname)}`)
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
  await fs.mkdir(join(pluginDir, cacheDir), { recursive: true })
  await fs.writeFile(cached, bytes)
  return cached
}

/** Unpack a bundle into the cache once per content, refusing a zip bomb first. */
async function extracted(pluginDir: string, file: string, cacheDir: string): Promise<string> {
  const bytes = await fs.readFile(file)
  const stem = basename(file, extname(file))
  const out = join(pluginDir, cacheDir, `${stem}-${hash(bytes)}`)
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

/** One bundle, unpacked: the folder it went to (`${__dirname}`) and its manifest as written. */
export interface ExtractedMcpBundle {
  readonly root: string
  readonly manifest: unknown
}

/**
 * Unpack one bundle a plugin names (a path inside it or an `https://` URL) into `cacheDir` under the
 * plugin, throwing why it cannot.
 */
export async function extractMcpBundle(
  pluginDir: string,
  ref: string,
  cacheDir: string,
): Promise<ExtractedMcpBundle> {
  const root = await extracted(pluginDir, await bundleFile(pluginDir, ref, cacheDir), cacheDir)
  const manifest = JSON.parse(await fs.readFile(join(root, 'manifest.json'), 'utf8')) as unknown
  return { root, manifest }
}
