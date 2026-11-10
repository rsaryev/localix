/**
 * Localix's core tools as a Claude Code mod sees them in `tool.call` and a hook in `tool_input` /
 * `tool_response`: under Claude Code's names (`Bash`, `Read`, `Edit`, `Grep` or `Glob`, `Agent`,
 * `Skill` …, chosen per call where the call decides it) with their arguments in Claude Code's
 * shape (`cc-tool-inputs.ts`, `cc-tool-inputs-agentic.ts`) and their results in Claude Code's
 * result shape (`cc-tool-responses.ts`). A hook's rewrite of those fields is carried back onto
 * Localix's own input. Other tools pass through under their own names.
 */
import { absolutePath, isRecord, type Fields, type ToolShape } from './cc-tool-fields'
import { FILE_AND_WEB_SHAPES } from './cc-tool-inputs'
import { AGENTIC_SHAPES } from './cc-tool-inputs-agentic'
import { SESSION_SHAPES } from './cc-tool-inputs-session'
import { claudeCodeResult } from './cc-tool-responses'

const SHAPES: Record<string, ToolShape> = {
  ...FILE_AND_WEB_SHAPES,
  ...AGENTIC_SHAPES,
  ...SESSION_SHAPES,
}

/** Claude Code's name for one call of a shaped tool: `search` with only a `glob` is `Glob`. */
const nameOfCall = (shape: ToolShape, input: unknown) =>
  shape.nameFor && isRecord(input) ? shape.nameFor(input) : shape.name

/**
 * A tool's name as Claude Code's hooks match it: `Bash`, or an MCP tool's `mcp__<server>__<t>`. A
 * core tool Claude Code has no name for goes by its own (`Browser`).
 */
export function claudeCodeToolName(
  tool: { name: string; aliases?: readonly string[] },
  /** The call's input, when the name depends on it (`Grep` or `Glob`, `Agent` or `TaskStop`). */
  input?: unknown,
): string {
  const shape = SHAPES[tool.name]
  if (shape) return nameOfCall(shape, input)
  return tool.aliases?.[0] ?? tool.name
}

/** Every Claude Code name a Localix tool answers to, for a hook matcher or a rule's tool. */
export function claudeCodeNames(localName: string): string[] {
  const shape = SHAPES[localName]
  return shape ? [shape.name, ...(shape.names ?? [])] : []
}

/** Localix's tools that have a Claude Code shape, in the order a shared name resolves by. */
export const shapedToolNames = (): string[] => Object.keys(SHAPES)

/** Localix's name for a tool a hook names as Claude Code does (`Grep` is `Search`). */
export function localToolName(name: string): string {
  const named = (shape: ToolShape) => shape.name === name || shape.names?.includes(name) === true
  return Object.entries(SHAPES).find(([, shape]) => named(shape))?.[0] ?? name
}

/**
 * The `tool.call` event of a call: Claude Code's name and arguments, and the call's id. With the
 * call's `cwd`, a file path is absolute, as Claude Code's hooks always see it.
 */
export function toolCallEvent(
  tool: { name: string; aliases?: readonly string[] },
  input: unknown,
  toolUseId: string,
  cwd?: string,
): Fields {
  const fields = isRecord(input) ? input : {}
  const shape = SHAPES[tool.name]
  return {
    ...(shape ? shape.toClaude(fields, cwd) : fields),
    tool: claudeCodeToolName(tool, fields),
    tool_use_id: toolUseId,
  }
}

/** A Localix call split into the single-file calls Claude Code's tools make, and the way back. */
export interface FileCallParts {
  /** One input per edit, per file written or per file read, as `Edit`, `Write` or `Read` takes it. */
  readonly parts: Fields[]
  /** The call again from its parts, each part's rewrite on its own entry. */
  join(parts: readonly unknown[]): Fields
}

/** The list each file tool names its files in. */
const FILE_LISTS: Record<string, string> = { Edit: 'edits', Write: 'files', Read: 'reads' }

/** A part's entry of `list`, or the original entry when the part does not carry exactly one. */
const entryOf = (part: unknown, list: string, fallback: unknown) => {
  const entries = isRecord(part) ? part[list] : undefined
  return Array.isArray(entries) && entries.length === 1 ? entries[0] : fallback
}

/**
 * A Localix call as the single-file calls Claude Code's tools make, so each reads as `Edit`,
 * `Write` or `Read` does; undefined for a call of one file.
 */
export function fileCallParts(tool: string, input: unknown): FileCallParts | undefined {
  if (!isRecord(input)) return undefined
  if (tool === 'Read' && 'path' in input && Array.isArray(input.reads) && input.reads.length) {
    // A read of `path` and of a list reads each: one call per file, the item's range its own.
    const { path, reads, ...rest } = input
    const items: Fields[] = [
      { path },
      ...reads.map((item) => (isRecord(item) ? item : { path: item })),
    ]
    const own = (part: unknown, item: Fields) =>
      isRecord(part)
        ? Object.fromEntries(Object.entries(part).filter(([key]) => !(key in rest) || key in item))
        : item
    return {
      parts: items.map((item) => ({ ...rest, ...item })),
      join: (parts) => {
        const [first, ...others] = items.map((item, at) => own(parts[at], item))
        return { ...rest, path: first?.path ?? path, reads: others }
      },
    }
  }
  const list = FILE_LISTS[tool]
  const entries = list ? input[list] : undefined
  if (!list || !Array.isArray(entries) || entries.length < 2) return undefined
  return {
    parts: entries.map((entry) => ({ ...input, [list]: [entry] })),
    join: (parts) => ({
      ...input,
      [list]: entries.map((entry, at) => entryOf(parts[at], list, entry)),
    }),
  }
}

/** The single-file calls of a Localix call: its parts, or the call itself. */
export const singleCalls = (tool: string, input: unknown): Fields[] =>
  fileCallParts(tool, input)?.parts ?? [isRecord(input) ? input : {}]

/**
 * The tool's own input from the event a hook passed to `next`. `agentId` says whose call the mod
 * was shown (a subagent's); it is no argument of the tool.
 */
export function toolInputOf(tool: string, event: Fields): Fields {
  const { tool: name, tool_use_id: _id, consent: _consent, agentId: _agent, ...fields } = event
  const shape = SHAPES[tool]
  if (!shape) return fields
  return shape.fromClaude(fields, typeof name === 'string' ? name : nameOfCall(shape, fields))
}

/**
 * A call as a Claude Code hook's stdin carries it: `tool_name` is Claude Code's (`Bash`, `Edit`)
 * and `tool_input` has Claude Code's fields (`command`, `file_path`, `old_string`) beside
 * Localix's own, so a hook script that tests `tool_name == 'Bash'` reads what it expects. A file
 * path is resolved against `cwd`, the hook's working directory.
 */
export function claudeCodeHookCall(
  tool: {
    name: string
    aliases?: readonly string[]
    mcpServer?: { readonly name: string; readonly source: string }
  },
  input: unknown,
  cwd?: string,
): { tool_name: string; tool_input: unknown; mcp_server?: { name: string; source: string } } {
  const shape = SHAPES[tool.name]
  return {
    tool_name: claudeCodeToolName(tool, input),
    tool_input: shape && isRecord(input) ? shape.toClaude(input, cwd) : input,
    // An MCP tool's server and where it was defined (hooks.md, PreToolUse input `mcp_server`).
    ...(tool.mcpServer
      ? { mcp_server: { name: tool.mcpServer.name, source: tool.mcpServer.source } }
      : {}),
  }
}

/**
 * A tool's result as a PostToolUse hook reads it (`tool_response`), in Claude Code's shape for the
 * tool (`cc-tool-responses.ts`): Bash's `{stdout, stderr, interrupted, isImage}`, Write's
 * `{type, filePath, content, structuredPatch}` … Given the call's input (and the hook's `cwd`),
 * the file tools answer with their absolute `filePath`; a call with no Claude Code counterpart
 * keeps Localix's `{content, details}`.
 */
export function claudeCodeToolResponse(
  tool: { name: string },
  result: { content: string; details?: unknown },
  input?: unknown,
  cwd?: string,
): unknown {
  return (
    claudeCodeResult(tool.name, result, input, cwd) ?? {
      content: result.content,
      details: result.details,
    }
  )
}

/**
 * Localix's input from a hook's `updatedInput`. Claude Code's hook replaces the whole input in
 * its own shape, so its fields land over the call as the hook saw it and fold back into
 * Localix's (`file_path` onto the one edit's `path`). A file path the hook was shown made
 * absolute and handed back unchanged stays as the call wrote it.
 */
export function localInputFromHook(
  tool: string,
  seen: unknown,
  updated: unknown,
  cwd?: string,
): unknown {
  const shape = SHAPES[tool]
  if (!shape || !isRecord(updated)) return updated
  const local = isRecord(seen) ? seen : {}
  const before = shape.toClaude(local, cwd)
  const merged = { ...before, ...updated }
  for (const key of ['file_path', 'path'] as const)
    if (before[key] !== undefined && merged[key] === before[key])
      merged[key] = shape.toClaude(local)[key]
  const folded = shape.fromClaude(merged, nameOfCall(shape, local))
  return { ...shape.carry?.(local), ...folded }
}

/**
 * A Claude Code–shaped `tool_input` with its paths made absolute against `cwd`: `file_path`
 * (Read, Edit, Write), `notebook_path`, and a Grep or Glob `path`. Anything else unchanged.
 */
export function absoluteFilePaths(toolName: string, input: unknown, cwd?: string): unknown {
  if (!isRecord(input) || !cwd) return input
  const out = { ...input }
  for (const key of ['file_path', 'notebook_path'] as const)
    if (out[key] !== undefined) out[key] = absolutePath(out[key], cwd)
  if ((toolName === 'Grep' || toolName === 'Glob') && out.path !== undefined)
    out.path = absolutePath(out.path, cwd)
  return out
}
