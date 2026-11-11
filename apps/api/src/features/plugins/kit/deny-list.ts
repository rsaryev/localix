import { parseToolEntry } from '@rsaryev/llx-plugin/agents'
import { normalizeMcpToolAlias } from '../../agent-core/mcp-tool-alias'
import { localixToolNames } from './tool-names'

/** The Localix tools a whole-tool entry names: its MCP tool, the tools a Claude Code name stands for, else itself. */
function localToolsOf(name: string): readonly string[] {
  const mcp = normalizeMcpToolAlias(name)
  if (mcp) return [mcp]
  const host = localixToolNames.hostNames(name)
  return host.length > 0 ? host : [name]
}

/**
 * Split a denylist (a skill's or command's `disallowedTools`, the settings' entries): `tools` are
 * the whole tools it switches off (a bare name, or `name(*)`), by Localix's names; `patterned` are
 * the entries that deny only the calls they match (`Bash(rm *)`, `Agent(worker)`), as written:
 * the kit reads them as session rules (`permissions.ts`), never as a removed tool.
 */
export function splitDenyList(list: readonly string[]): { tools: string[]; patterned: string[] } {
  const tools: string[] = []
  const patterned: string[] = []
  for (const raw of list) {
    const token = raw.replace(/^["']|["']$/g, '').trim()
    const entry = parseToolEntry(token)
    const whole =
      (entry.specifier === undefined || entry.specifier.trim() === '*') &&
      !Array.isArray(entry.spawn)
    if (!whole) {
      if (!patterned.includes(token)) patterned.push(token)
      continue
    }
    for (const name of localToolsOf(entry.name)) if (!tools.includes(name)) tools.push(name)
  }
  return { tools, patterned }
}
