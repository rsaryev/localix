/**
 * What a PostToolUse hook's `updatedToolOutput` / `updatedMCPToolOutput` puts in front of the
 * model in place of a tool's output (hooks.md, PostToolUse decision control).
 *
 * Claude Code's `updatedToolOutput` "must match the tool's output shape": `Bash` returns
 * `{stdout, stderr, interrupted, isImage}`, and for a built-in tool "a value that doesn't match
 * the tool's output schema is ignored and the original output is used". Read, Grep, Glob,
 * WebFetch and WebSearch records are read the same way (`shapedText`). `updatedMCPToolOutput`
 * "replaces the output for MCP tools only", and MCP output "is passed through without schema
 * validation". A plain string is read as the text the model sees, for any tool.
 *
 * Pure module.
 */
import { isRecord } from '../../lib/record'

/** Localix registers MCP tools as `mcp_<server>_<tool>` (`mcp-names.ts`). */
const isMcpTool = (toolName: string) => toolName.startsWith('mcp_')

/** An MCP result's text: `[{type:'text', text}]` or `{content: [...]}`; else the JSON. */
function mcpText(value: unknown): string {
  if (typeof value === 'string') return value
  const blocks = isRecord(value) && Array.isArray(value.content) ? value.content : value
  if (Array.isArray(blocks)) {
    const texts = blocks.flatMap((block) =>
      isRecord(block) && typeof block.text === 'string' ? [block.text] : [],
    )
    if (texts.length > 0 || blocks.length === 0) return texts.join('\n')
  }
  return JSON.stringify(value)
}

/** Bash's output shape: `stdout`, then `stderr` when there is any. */
function bashText(value: Record<string, unknown>): string | undefined {
  if (typeof value.stdout !== 'string') return undefined
  const stderr = typeof value.stderr === 'string' ? value.stderr : ''
  return stderr ? `${value.stdout}${value.stdout ? '\n' : ''}${stderr}` : value.stdout
}

/** A string field of a record, nested by `path`. */
const textAt = (value: Record<string, unknown>, ...path: string[]): string | undefined => {
  let at: unknown = value
  for (const key of path) at = isRecord(at) ? at[key] : undefined
  return typeof at === 'string' ? at : undefined
}

/**
 * The text a record in a built-in tool's own result shape stands for (`cc-tool-responses.ts`):
 * Read's `file.content`, Grep's `content` or Glob's `filenames`, WebFetch's `result`, WebSearch's
 * string `results`. Edit and Write answer with what changed, which the model does not read.
 */
function shapedText(toolName: string, value: Record<string, unknown>): string | undefined {
  if (toolName === 'Bash') return bashText(value)
  if (toolName === 'Read') return textAt(value, 'file', 'content')
  if (toolName === 'Search')
    return (
      textAt(value, 'content') ??
      (Array.isArray(value.filenames) ? value.filenames.join('\n') : undefined)
    )
  if (toolName === 'Research') {
    const results = Array.isArray(value.results) ? value.results : undefined
    return (
      textAt(value, 'result') ??
      results?.filter((entry): entry is string => typeof entry === 'string').join('\n')
    )
  }
  return undefined
}

/**
 * The model-facing content a hook's replacement stands for, or undefined when it replaces
 * nothing (absent or not in the tool's shape). An empty replacement is one: a redaction hook
 * that answers `""` hides the output rather than letting it through.
 */
export function replacementContent(
  toolName: string,
  output: { updatedToolOutput?: unknown; updatedMCPToolOutput?: unknown },
): string | undefined {
  const { updatedToolOutput: value, updatedMCPToolOutput: mcpValue } = output
  if (isMcpTool(toolName)) {
    const chosen = value ?? mcpValue
    if (chosen === undefined || chosen === null) return undefined
    return mcpText(chosen)
  }
  if (typeof value === 'string') return value
  if (isRecord(value)) return shapedText(toolName, value)
  return undefined
}
