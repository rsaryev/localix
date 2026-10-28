import { CC_HOOK_EVENTS } from '../../cc-hooks/contracts'
import type { CcHookHandler, CcHookRegistry } from '../../cc-hooks/registry-types'

const SOURCE_LABEL = {
  user: 'user settings',
  project: 'project settings',
  local: 'local settings',
  skill: 'a skill',
  agent: 'an agent',
} as const

const short = (text: string, max = 80) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function describeHandler(handler: CcHookHandler): string {
  switch (handler.kind) {
    case 'prompt':
    case 'agent':
      return `${handler.kind} “${short(handler.prompt ?? '')}”`
    case 'http':
      return `http ${handler.httpUrl ?? ''}`
    case 'mcp_tool':
      return `mcp_tool ${handler.mcpTool ?? ''}`
    case 'command':
    case undefined:
      return `command \`${short([handler.command, ...(handler.args ?? [])].join(' '))}\``
  }
}

const sourceOf = (handler: CcHookHandler) =>
  handler.source === 'plugin'
    ? `plugin \`${handler.pluginName ?? '?'}\``
    : SOURCE_LABEL[handler.source]

/**
 * `/hooks`: Claude Code's read-only view of the hooks that apply. Events come in Claude Code's own
 * order; each matcher group lists its handlers and the file or plugin they came from. Editing is
 * left to the settings files, as in Claude Code, where the menu only shows them.
 */
export function formatHooks(registry: CcHookRegistry, unreadable: number): string {
  const lines: string[] = []
  let total = 0
  for (const event of CC_HOOK_EVENTS) {
    const groups = registry[event]
    if (!groups?.length) continue
    lines.push(`**${event}**`)
    for (const group of groups) {
      const matcher = group.matcher && group.matcher !== '*' ? `\`${group.matcher}\`` : 'all'
      for (const handler of group.handlers) {
        total += 1
        lines.push(`- ${matcher}: ${describeHandler(handler)} (${sourceOf(handler)})`)
      }
    }
  }
  const note = unreadable
    ? `\n\n${unreadable} handler${unreadable === 1 ? '' : 's'} could not be read and ${
        unreadable === 1 ? 'is' : 'are'
      } not listed.`
    : ''
  if (total === 0)
    return `No hooks are configured for this folder. Add a \`hooks\` block to \`.claude/settings.json\`, or enable a plugin that has them.${note}`
  return `**Hooks** — ${total} hook${total === 1 ? '' : 's'}\n\n${lines.join('\n')}${note}`
}
