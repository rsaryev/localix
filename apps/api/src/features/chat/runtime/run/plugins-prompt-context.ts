import { TOOL } from '../../../agent-core/tool-names'
import type { LoadedPlugins } from '../../../plugins/loader'
import type { PluginLspServer } from '../../../plugins/kit'
import { summarizePluginLspServers } from '../../../lsp'

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * The enabled Claude Code plugins, as a bounded index: the skills each offers while the skill tool
 * is on, and its LSP servers. Not a second copy of manifests; what is not model-actionable in this
 * run (commands, hooks, disabled skills) is left out. Mini apps have their own index
 * (`mini-apps-prompt-context.ts`): the two share nothing.
 */
export function buildPluginsPromptContext(
  loadedPlugins: LoadedPlugins,
  lspServers: readonly PluginLspServer[],
  runtimeToolNames: readonly string[],
): string | undefined {
  const available = new Set(runtimeToolNames)
  const summaries = loadedPlugins.loaded.flatMap((plugin) =>
    plugin.skills.length && available.has(TOOL.Skill)
      ? [`- ${plugin.name} — ${countLabel(plugin.skills.length, 'skill')}`]
      : [],
  )
  // LSP contributions are not tools: their diagnostics arrive inside edit/write results.
  const lspLines = lspServers.flatMap((declared) =>
    summarizePluginLspServers([declared]).map((server) => {
      const exts = server.extensions.length ? server.extensions.join(', ') : 'none'
      const builtin = server.builtinExtensions.length
        ? `; built-in server kept for ${server.builtinExtensions.join(', ')}`
        : ''
      const missing = !server.extensions.length
        ? ''
        : server.missing
          ? `; NOT RUNNING: ${server.command} is not on PATH${server.installHint ? ` (${server.installHint})` : ''}`
          : server.installsOnFirstUse
            ? '; installs on first use'
            : ''
      return `- ${declared.pluginId} — LSP "${server.id}": ${exts}${builtin}${missing} (diagnostics via edit/write results, not a tool)`
    }),
  )
  const lines = [...summaries, ...lspLines]
  return lines.length ? lines.join('\n') : undefined
}
