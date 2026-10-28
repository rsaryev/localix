import { useCallback } from 'react'

import { backendClient } from '@/shared/api/client'
import { scopeThemes } from '@/shared/theme/pluginTheme'
import { themeChoices } from '@/shared/theme/themeChoice'

import {
  loadMiniAppCommandArgOptions,
  loadPluginCommandArgOptions,
} from './pluginCommandArgOptions'
import { findSessionInState } from '../../model/findSession'
import { useChatStore } from '../../model/store'
import { copyOptions, helpOptions, resumeOptions, rewindOptions } from './clientCommandRows'
import type { SlashCommand } from './SlashCommandMenu'
import type { SlashArgOption } from './SlashArgSpec'

/** The default style, then every style this chat can pick (`/output-style`). */
async function outputStyleOptions(projectId: string | null, query: string) {
  const styles = await backendClient.listOutputStyles({ projectId }).catch(() => [])
  const wanted = query.trim().toLowerCase()
  const rows: SlashArgOption[] = [
    { value: 'default', label: 'default', description: 'No style instructions' },
    ...styles
      .filter((style) => !style.forced)
      .map((style) => ({
        value: style.name,
        label: style.name,
        description: style.description || undefined,
      })),
  ]
  return rows.filter((row) => !wanted || row.value.toLowerCase().includes(wanted))
}

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
    commandId: string,
  ) => Promise<SlashArgOption[]>,
) {
  return useCallback(
    async (
      command: SlashCommand,
      argName: string,
      query: string,
      committed: Readonly<Record<string, string>>,
    ) => {
      // `/effort` reads the same steps as `/model`, from its reasoning level on.
      if ((command.id === 'model' || command.id === 'effort') && loadModelOptions) {
        return loadModelOptions(argName, query, committed, command.id)
      }
      // Live chat state: the transcript's messages and replies, the roster, the command list.
      if (command.id === 'rewind' || command.id === 'copy') {
        const messages =
          findSessionInState(useChatStore.getState(), activeSessionId)?.messages ?? []
        return command.id === 'rewind'
          ? rewindOptions(messages, query)
          : copyOptions(messages, query)
      }
      if (command.id === 'resume') {
        return resumeOptions(useChatStore.getState().allSessions, activeSessionId, query)
      }
      if (command.id === 'help') return helpOptions(query)
      if (command.id === 'output-style') return outputStyleOptions(activeProjectId, query)
      if (command.id === 'plugin') {
        return loadPluginCommandArgOptions(argName, committed.action, query)
      }
      if (command.id === 'mini-app') {
        return loadMiniAppCommandArgOptions(argName, committed.action, query)
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
      const src = command.argSource
      if (!src) return []
      const rows = await backendClient
        .fetchMiniAppCommandArgOptions({
          app: src.app,
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
