import {
  claudeCodeInput,
  localInputFromHook as foldHookInput,
  localInputOf,
} from '../../ext/cc-tool-shapes'
import { claudeCodeToolName, type NamedTool } from './tool-names'

/**
 * A LOCALIX CALL AS CLAUDE CODE'S HOOKS AND MODS SEE IT: the Claude Code name the boundary gives
 * it (`tool-names.ts`) with its input in that tool's shape (`ext/cc-tool-shapes.ts`), and back.
 */

type Fields = Record<string, unknown>

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The `tool.call` event of a call: Claude Code's name and arguments, and the call's id. With the
 * call's `cwd`, a file path is absolute, as Claude Code's hooks always see it.
 */
export function toolCallEvent(
  tool: NamedTool,
  input: unknown,
  toolUseId: string,
  cwd?: string,
): Fields {
  const name = claudeCodeToolName(tool, input)
  return { ...claudeCodeInput(tool.name, name, input, cwd), tool: name, tool_use_id: toolUseId }
}

/**
 * The tool's own input from the event a mod passed to `next`. `agentId` says whose call the mod
 * was shown (a subagent's); it is no argument of the tool.
 */
export function toolInputOf(tool: string, event: Fields): Fields {
  const { tool: name, tool_use_id: _id, consent: _consent, agentId: _agent, ...fields } = event
  const called = typeof name === 'string' ? name : claudeCodeToolName({ name: tool }, fields)
  return localInputOf(tool, called, fields)
}

/** An MCP tool's server and where it was defined (hooks.md, PreToolUse input `mcp_server`). */
interface McpServerRef {
  readonly name: string
  readonly source: string
}

/**
 * A call as a Claude Code hook's stdin carries it: `tool_name` is Claude Code's (`Bash`, `Edit`)
 * and `tool_input` has Claude Code's fields (`command`, `file_path`, `old_string`) beside
 * Localix's own. A file path is resolved against `cwd`, the hook's working directory.
 */
export function claudeCodeHookCall(
  tool: NamedTool & { readonly mcpServer?: McpServerRef },
  input: unknown,
  cwd?: string,
): { tool_name: string; tool_input: unknown; mcp_server?: { name: string; source: string } } {
  const name = claudeCodeToolName(tool, input)
  return {
    tool_name: name,
    tool_input: isFields(input) ? claudeCodeInput(tool.name, name, input, cwd) : input,
    ...(tool.mcpServer
      ? { mcp_server: { name: tool.mcpServer.name, source: tool.mcpServer.source } }
      : {}),
  }
}

/**
 * Localix's input from a hook's `updatedInput`, the call as the hook saw it (`seen`) with the
 * hook's fields folded back into Localix's (`ext/cc-tool-shapes.ts`).
 */
export function localInputFromHook(
  tool: string,
  seen: unknown,
  updated: unknown,
  cwd?: string,
): unknown {
  return foldHookInput(tool, claudeCodeToolName({ name: tool }, seen), seen, updated, cwd)
}
