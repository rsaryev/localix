import type { McpClientLike } from './mcp-client-contracts'

/**
 * MCP PROMPTS AS SLASH COMMANDS. A server that advertises the `prompts` capability offers named
 * prompts with declared arguments; Claude Code types each as `/mcp__<server>__<prompt>`, takes
 * the arguments after it in the order they are declared, and sends the messages the server
 * returns as the turn. The listing is captured when a server connects (and when it announces a
 * change), so a menu reads it without starting a server.
 */

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPromptDef {
  name: string
  title?: string
  description?: string
  arguments?: McpPromptArgument[]
}

/** The reply of `prompts/get`: the messages that become the turn. */
export interface McpPromptResult {
  description?: string
  messages: Array<{ role: string; content: unknown }>
}

/** A server's prompts as a menu reads them. */
export interface McpServerPrompt {
  server: string
  serverId: string
  prompt: McpPromptDef
}

/** Ceiling on `prompts/list` pages: a misbehaving server cannot loop us forever. */
const MAX_PAGES = 20

/** Anything but a letter, digit, `_` or `-` becomes `_`: how Claude Code names a server or prompt. */
const normalized = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_')

/** The slash command of a prompt: `mcp__<server>__<prompt>`. */
export const mcpPromptCommandName = (server: string, prompt: string): string =>
  `mcp__${normalized(server)}__${normalized(prompt)}`

/** The prompts a connected client offers; none when it does not advertise the capability. */
export async function listPromptDefs(client: McpClientLike): Promise<McpPromptDef[]> {
  if (!client.getServerCapabilities?.()?.prompts || !client.listPrompts) return []
  const prompts: McpPromptDef[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await client.listPrompts(cursor ? { cursor } : undefined)
    prompts.push(...(result.prompts ?? []))
    cursor = result.nextCursor
    if (!cursor) break
  }
  return prompts
}

/** `a "b c" d` → `['a', 'b c', 'd']`: quotes keep a phrase together. */
function words(text: string): string[] {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')
}

/** The usage line of a prompt: required arguments in `<>`, optional ones in `[]`. */
function usageOf(command: string, prompt: McpPromptDef): string {
  const args = (prompt.arguments ?? []).map((arg) =>
    arg.required ? `<${arg.name}>` : `[${arg.name}]`,
  )
  return `Usage: \`/${command}${args.length ? ` ${args.join(' ')}` : ''}\``
}

/**
 * The typed arguments, matched in order to the declared ones. Either the values, or the usage line
 * when a required argument is missing or more were typed than declared.
 */
export function parsePromptArguments(
  prompt: McpPromptDef,
  typed: string,
  command = prompt.name,
): { values: Record<string, string> } | { usage: string } {
  const declared = prompt.arguments ?? []
  const given = words(typed)
  if (given.length > declared.length) return { usage: usageOf(command, prompt) }
  const values: Record<string, string> = {}
  for (const [index, arg] of declared.entries()) {
    const value = given[index]
    if (value === undefined || value === '') {
      if (arg.required) return { usage: usageOf(command, prompt) }
      continue
    }
    values[arg.name] = value
  }
  return { values }
}

/** The turn a prompt result makes: its text in order, other kinds named, a reply marked. */
export function promptInstruction(result: McpPromptResult): string {
  return result.messages
    .map((message) => {
      const content = message.content as { type?: string; text?: string; mimeType?: string }
      const text =
        content?.type === 'text'
          ? (content.text ?? '')
          : content?.type === 'image' || content?.type === 'audio'
            ? `[${content.type}: ${content.mimeType ?? 'unknown'}]`
            : content?.type === 'resource'
              ? `[resource: ${(content as { resource?: { uri?: string } }).resource?.uri ?? ''}]`
              : ''
      return message.role === 'assistant' ? `Assistant: ${text}` : text
    })
    .filter((part) => part.length > 0)
    .join('\n\n')
}
