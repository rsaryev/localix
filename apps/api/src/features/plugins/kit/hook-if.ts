import { homedir } from 'node:os'
import { evaluateIf } from '@rsaryev/llx-plugin/rules'
import { claudeCodeHookCall, singleCalls } from '../../ext/cc-tool-shapes'

/**
 * A HOOK HANDLER'S `if` AT A LOCALIX CALL. The kit reads the rule and says whether the handler runs
 * (`evaluateIf`: permission rule syntax matched as a deny rule matches, a single-directory path
 * kept at its depth, a Monitor call answering to `Bash(...)`, "runs when it cannot tell"). This
 * file only puts each call of a Localix batch in Claude Code's shape; any one of them is enough.
 */
export function hookIfRuns(
  rule: string,
  toolName: string,
  toolInput: unknown,
  /** The tool's other names (an MCP tool's `mcp__…`). */
  aliases?: readonly string[],
  /** The hook's working directory: relative paths resolve, and rules anchor, here. */
  cwd?: string,
): boolean {
  const tool = { name: toolName, ...(aliases ? { aliases } : {}) }
  const at = cwd ?? '/'
  const paths = {
    cwd: at,
    home: homedir(),
    primaryWorkingDirectory: at,
    additionalDirectories: [],
    platform: 'posix' as const,
  }
  return singleCalls(toolName, toolInput).some((one) => {
    const { tool_name, tool_input } = claudeCodeHookCall(tool, one, cwd)
    return evaluateIf(rule, tool_name, tool_input, { paths }).runs
  })
}
