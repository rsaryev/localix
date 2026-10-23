import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import { scopeThemes } from '@/shared/theme/pluginTheme'
import { themeChoices } from '@/shared/theme/themeChoice'

import { loadPluginCommandArgOptions } from './pluginCommandArgOptions'
import { loadAgentCommandArgOptions } from './agentCommandArgOptions'
import type { SlashCommand } from './SlashCommandMenu'
import type { SlashArgOption } from './SlashArgSpec'

/**
 * Dynamic arg options, from one of two sources depending on who owns the command: a plugin
 * command's `optionsScript` (the server runs it), or a BUILT-IN whose values are live client
 * state — `/plugin enable` should offer the installed set, not an empty menu under a placeholder
 * telling the user to pick one.
 */
export function useSlashArgOptions(
  activeSessionId: string | null,
  activeProjectId: string | null,
  /** `/model`'s steps: the picker's own data (`useModelCommand`). */
  loadModelOptions?: (
    argName: string,
    query: string,
    committed: Readonly<Record<string, string>>,
  ) => Promise<SlashArgOption[]>,
) {
  return useCallback(
    async (
      command: SlashCommand,
      argName: string,
      query: string,
      committed: Readonly<Record<string, string>>,
    ) => {
      if (command.id === 'model' && loadModelOptions) {
        return loadModelOptions(argName, query, committed)
      }
      if (command.id === 'plugin') {
        return loadPluginCommandArgOptions(argName, committed.action, query)
      }
      if (command.id === 'theme') {
        // The open scope's looks, as Settings → Appearance lists them (`/theme`).
        const wanted = query.trim().toLowerCase()
        return themeChoices(scopeThemes()).filter(
          (choice) =>
            !wanted ||
            choice.label.toLowerCase().includes(wanted) ||
            choice.value.toLowerCase().includes(wanted),
        )
      }
      if (command.id === 'agents' && argName === 'agent') {
        return loadAgentCommandArgOptions(committed.action, query, activeSessionId, activeProjectId)
      }
      const src = command.argSource
      if (!src) return []
      const rows = await backendClient
        .fetchMiniAppCommandArgOptions({
          plugin: src.plugin,
          command: src.command,
          arg: argName,
          query,
          sessionId: activeSessionId ?? undefined,
          projectId: activeProjectId,
        })
        .catch(() => [])
      return rows.map((r) => ({ value: r.value, label: r.label, description: r.description }))
    },
    [activeSessionId, activeProjectId, loadModelOptions],
  )
}
