import { useMemo } from 'react'
import { useChatStore } from '@/entities/chat/model/store'
import type { MiniAppCommandSpec } from '@/shared/api/contracts'
import { useCapabilities } from '@/shared/contrib/capabilityCache'
import { selectComposerProjectId } from './commandScope'
import { MiniAppIcon } from './commandIcons'
import type { SlashCommand } from './SlashCommandMenu'
import { mapArgs } from './usePluginCommands'

const NO_COMMANDS: MiniAppCommandSpec[] = []

/**
 * The commands enabled mini apps declare in their `mini-app.json`, as composer commands
 * (`/<app>:<command>`). A dynamic argument's options come from the app's own script, through
 * `argSource`; the backend dispatches the command like any other.
 */
export function useMiniAppCommands(sessionId: string | null, enabled = true): SlashCommand[] {
  const projectId = useChatStore((state) => selectComposerProjectId(state, sessionId))
  const { snapshot } = useCapabilities(projectId ?? '', enabled)
  const commands = snapshot?.miniAppCommands ?? NO_COMMANDS
  return useMemo(
    () =>
      commands.map((spec): SlashCommand => ({
        id: `mini-app:${spec.fullName}`,
        trigger: spec.fullName,
        title: spec.fullName,
        description: spec.description || `From ${spec.app}`,
        icon: <MiniAppIcon />,
        kind: 'builtin',
        prefix: `/${spec.fullName} `,
        args: mapArgs(spec.args),
        ...(spec.featured ? { featured: true } : {}),
        ...(spec.args.some((arg) => arg.dynamic)
          ? { argSource: { app: spec.app, command: spec.name } }
          : {}),
      })),
    [commands],
  )
}
