/**
 * The text the model sees in place of a tool's output once a PostToolUse hook replaced it
 * (hooks.md, "PostToolUse decision control"). The kit decides the replacement: `updatedToolOutput`,
 * or an MCP tool's `updatedMCPToolOutput`, and a built-in tool's value that does not match the
 * tool's output shape is dropped (`effects.updatedToolOutput`). Localix reads the accepted value in
 * its own tool's shape: a string is the text, a record of a built-in tool the field its result
 * shows (`shapedText`), an MCP result its text blocks.
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
 * The model-facing content of the replacement the kit accepted, or undefined when there is none or
 * Localix's tool shows nothing of it. An empty replacement is one: a redaction hook that answers
 * `""` hides the output rather than letting it through.
 */
export function replacementContent(toolName: string, value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (isMcpTool(toolName)) return value === null ? undefined : mcpText(value)
  if (typeof value === 'string') return value
  if (isRecord(value)) return shapedText(toolName, value)
  return undefined
}
