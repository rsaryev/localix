import { useMemo } from 'react'

import { useChatStore } from '@/entities/chat/model/store'
import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { useCapabilities } from '@/shared/contrib/capabilityCache'

import { selectComposerProjectId } from './commandScope'
import { McpIcon } from './commandIcons'
import type { SlashCommand } from './SlashCommandMenu'

type McpPromptSpec = NonNullable<CapabilitySnapshot['mcpPrompts']>[number]

const NONE: McpPromptSpec[] = []

/**
 * The composer rows of the prompts connected MCP servers offer, typed as Claude Code types them:
 * `/mcp__<server>__<prompt>`, then the prompt's arguments in the order it declares them. The
 * arguments are one free-text slot whose placeholder names them (`<file> [focus]`: required ones
 * in angle brackets), which the server reads back in order.
 */
export function mcpPromptCommands(prompts: readonly McpPromptSpec[]): SlashCommand[] {
  return prompts.map((spec): SlashCommand => {
    const usage = spec.args.map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`))
    return {
      id: `mcp-prompt:${spec.fullName}`,
      trigger: spec.fullName,
      title: spec.fullName,
      description: spec.description || `From the ${spec.server} MCP server`,
      icon: <McpIcon />,
      kind: 'builtin',
      prefix: `/${spec.fullName} `,
      ...(usage.length > 0
        ? { args: [{ name: 'arguments', type: 'text', placeholder: usage.join(' ') }] }
        : {}),
    }
  })
}

/** The scope's MCP prompts as composer commands, from the same capability document as the rest. */
export function useMcpPromptCommands(sessionId: string | null, enabled = true): SlashCommand[] {
  const projectId = useChatStore((state) => selectComposerProjectId(state, sessionId))
  const { snapshot } = useCapabilities(projectId ?? '', enabled)
  const prompts = snapshot?.mcpPrompts ?? NONE
  return useMemo(() => mcpPromptCommands(prompts), [prompts])
}
