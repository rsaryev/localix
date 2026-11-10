import { HOOK_EVENTS, type HookHandler, type RegisteredHandler } from '@rsaryev/llx-plugin/hooks'

const KIND_LABEL = {
  skill: 'a skill',
  agent: 'an agent',
  session: 'this session',
} as const

const short = (text: string, max = 80) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function describeHandler(handler: HookHandler): string {
  switch (handler.type) {
    case 'prompt':
    case 'agent':
      return `${handler.type} “${short(handler.prompt)}”`
    case 'http':
      return `http ${handler.url}`
    case 'mcp_tool':
      return `mcp_tool ${handler.server}/${handler.tool}`
    case 'command':
      return `command \`${short([handler.command, ...(handler.args ?? [])].join(' '))}\``
  }
}

function sourceOf({ source }: RegisteredHandler): string {
  if (source.kind === 'plugin') return `plugin \`${source.pluginName ?? source.label}\``
  if (source.kind === 'settings')
    return source.managed ? 'managed settings' : `${source.scope ?? 'other'} settings`
  return KIND_LABEL[source.kind]
}

/** `/hooks`: the hooks the chat's session runs, by event, each with the place it came from. */
export function formatHookEntries(entries: readonly RegisteredHandler[]): string {
  const lines: string[] = []
  for (const event of HOOK_EVENTS) {
    const ofEvent = entries.filter((entry) => entry.event === event)
    if (ofEvent.length === 0) continue
    lines.push(`**${event}**`)
    for (const entry of ofEvent) {
      const matcher = entry.matcher && entry.matcher !== '*' ? `\`${entry.matcher}\`` : 'all'
      lines.push(`- ${matcher}: ${describeHandler(entry.handler)} (${sourceOf(entry)})`)
    }
  }
  if (entries.length === 0)
    return 'No hooks are configured for this folder. Add a `hooks` block to `.claude/settings.json`, or enable a plugin that has them.'
  const total = `${entries.length} hook${entries.length === 1 ? '' : 's'}`
  return `**Hooks** — ${total}\n\n${lines.join('\n')}`
}
