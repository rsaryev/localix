import { useMemo } from 'react'

import type { SlashCommand } from './SlashCommandMenu'
import { mergeDynamicSlashCommands } from './slashCommands'
import { useMcpPromptCommands } from './useMcpPromptCommands'
import { useMiniAppCommands } from './useMiniAppCommands'
import { usePluginCommands } from './usePluginCommands'
import { useSkillCommands } from './useSkillCommands'

/**
 * The slash commands the session's scope brings beside the built-ins: its plugins' and mini apps'
 * commands, merged with its skills (`mergeDynamicSlashCommands` decides a clash).
 */
export function useDynamicSlashCommands(
  sessionId: string | null,
  enabled: boolean,
): SlashCommand[] {
  const skillCommands = useSkillCommands(sessionId, enabled)
  const pluginCommands = usePluginCommands(sessionId, enabled)
  const miniAppCommands = useMiniAppCommands(sessionId, enabled)
  const mcpPromptCommands = useMcpPromptCommands(sessionId, enabled)
  return useMemo(
    () =>
      mergeDynamicSlashCommands(
        [...pluginCommands, ...miniAppCommands, ...mcpPromptCommands],
        skillCommands,
      ),
    [skillCommands, pluginCommands, miniAppCommands, mcpPromptCommands],
  )
}
