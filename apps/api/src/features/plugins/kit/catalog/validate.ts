import { validatePlugin } from '@rsaryev/llx-plugin'
import { HEADERS_HELPER_GUARD, rejectUserConfigInShell } from '@rsaryev/llx-plugin/loading'
import { diskFiles } from '../ports/files'

/**
 * What `claude plugin validate <dir>` reports for the folder, by the kit, as messages split by
 * severity (`file: message (path)`).
 */
export async function validatePluginFolder(
  dir: string,
): Promise<{ errors: string[]; warnings: string[] }> {
  const report = await validatePlugin({ files: diskFiles(dir) })
  const errors: string[] = []
  const warnings: string[] = []
  for (const found of report.issues) {
    const where = [found.file, found.path].filter((part) => part && part !== '.').join(' ')
    ;(found.severity === 'error' ? errors : warnings).push(
      where ? `${found.message} (${where})` : found.message,
    )
  }
  return { errors, warnings }
}

/**
 * The kit's refusals of the servers whose `headersHelper` references `${user_config.*}`: it runs
 * through a shell, so such a server does not load (mcp.md, "dynamic headers").
 */
export const mcpShellFieldRefusals = (servers: Record<string, object>): string[] =>
  Object.entries(servers).flatMap(([server, config]) => {
    const helper: unknown = Reflect.get(config, 'headersHelper')
    const refusal =
      typeof helper === 'string'
        ? rejectUserConfigInShell(HEADERS_HELPER_GUARD, helper, { server }, server)
        : undefined
    return refusal ? [refusal.message] : []
  })
