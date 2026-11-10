import { promises as fs } from 'node:fs'
import type { PortFailure } from '@rsaryev/llx-plugin'
import type { McpBundle, McpBundleReader } from '@rsaryev/llx-plugin/loading'
import { errorMessage } from '../../../../lib/errors'
import { confineToDir } from '../../../ext/fs-discovery'
import { openMcpBundle } from '../../mcpb-bundle'

/**
 * The MCP bundles of one plugin (`McpBundleReader`), opened by Localix's MCPB reader: extracted (a
 * URL downloaded first) into `.mcpb-cache/` under the plugin root, the one cache folder the kit
 * names (`MCPB_CACHE_DIR`), so its `cacheDir` is not read. `${user_config.KEY}` stays as the
 * bundle wrote it. A setting is required when the bundle requires it and gives no default.
 */
export function mcpBundleReader(pluginRoot: string): McpBundleReader {
  return {
    async open(source): Promise<McpBundle | PortFailure | undefined> {
      if (source.kind === 'path') {
        const file = confineToDir(pluginRoot, source.path)
        if (!file || !(await fs.stat(file).catch(() => undefined))?.isFile()) return undefined
      }
      try {
        const opened = await openMcpBundle(
          pluginRoot,
          source.kind === 'path' ? source.path : source.url,
        )
        const userConfig = Object.fromEntries(
          Object.entries(opened.userConfig).map(([key, setting]) => [
            key,
            { required: setting.required === true && setting.default === undefined },
          ]),
        )
        return { name: opened.name, server: opened.server, userConfig }
      } catch (error) {
        return { failure: 'bundle', message: errorMessage(error) }
      }
    },
  }
}
