import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import type { PortFailure } from '@rsaryev/llx-plugin'
import { bundleServerOf, readMcpbManifest } from '@rsaryev/llx-plugin/format'
import type { McpBundle, McpBundleReader } from '@rsaryev/llx-plugin/loading'
import { errorMessage } from '../../../../lib/errors'
import { confineToDir } from '../../../ext/fs-discovery'
import { extractMcpBundle } from '../../mcpb-bundle'

/**
 * The MCP bundles of one plugin (`McpBundleReader`): Localix unpacks each (a URL downloaded first)
 * into the kit's cache folder under the plugin root; the kit reads its manifest (`readMcpbManifest`,
 * `bundleServerOf`), and its `user_config` block goes back as written, for the kit to read.
 */
export function mcpBundleReader(pluginRoot: string): McpBundleReader {
  return {
    async open(source, cacheDir): Promise<McpBundle | PortFailure | undefined> {
      if (source.kind === 'path') {
        const file = confineToDir(pluginRoot, source.path)
        if (!file || !(await fs.stat(file).catch(() => undefined))?.isFile()) return undefined
      }
      try {
        const ref = source.kind === 'path' ? source.path : source.url
        const { root, manifest } = await extractMcpBundle(pluginRoot, ref, cacheDir)
        const read = readMcpbManifest(manifest, process.platform)
        if ('problem' in read) return { failure: 'bundle', message: read.problem }
        const variables = { directory: root, home: homedir(), separator: sep }
        const raw = (manifest as { user_config?: Record<string, unknown> }).user_config
        return {
          name: read.manifest.name,
          server: bundleServerOf(read.manifest, variables),
          ...(raw === undefined ? {} : { userConfig: raw }),
        }
      } catch (error) {
        return { failure: 'bundle', message: errorMessage(error) }
      }
    },
  }
}
