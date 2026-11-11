import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'

import { confineToDir } from '../ext/fs-discovery'
import { rmrf } from '../ext/install-tree'
import { assertSafeZip } from './kit'
import { fetchChecked, httpsPublicHop, readCapped } from './marketplace-download'
import { extractZipMembers } from './marketplace-zip-extract'
import { scanZip } from './marketplace-zip-scan'

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

/** Unpack a bundle into the cache once per content: within the limits, every path and link inside it. */
async function extracted(pluginDir: string, file: string, cacheDir: string): Promise<string> {
  const bytes = await fs.readFile(file)
  const stem = basename(file, extname(file))
  const out = join(pluginDir, cacheDir, `${stem}-${hash(bytes)}`)
  if (await fs.stat(join(out, 'manifest.json')).catch(() => null)) return out
  await assertSafeZip(bytes, file)
  await rmrf(out)
  // A bundle half written is never taken for a whole one on the next read.
  await extractZipMembers(bytes, scanZip(bytes).members, '', out).catch(async (err: unknown) => {
    await rmrf(out)
    throw err
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
