/**
 * Localix's core tools as a Claude Code mod sees them in `tool.call`: under Claude Code's names
 * (`Bash`, `Read`, `Edit` …) with their arguments in Claude Code's shape — `file_path`,
 * `old_string`, `content`, a Grep `pattern`, a Bash `timeout` in milliseconds. A call that edits or
 * writes one file reads as Claude Code's single-file call; a hook's rewrite of those fields is
 * carried back onto Localix's own input. Other tools pass through under their own names.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

type Fields = Record<string, unknown>

interface ToolShape {
  /** Claude Code's name for the tool. */
  name: string
  /**
   * The arguments as Claude Code's tool takes them, beside Localix's own. Given the call's
   * `cwd`, a file path is made absolute, as Claude Code's hooks always see it.
   */
  toClaude(input: Fields, cwd?: string): Fields
  /** Localix's input from what a hook passed on, Claude Code's fields folded back. */
  fromClaude(fields: Fields): Fields
}

const isRecord = (value: unknown): value is Fields =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The one entry of a list (`edits`, `files`), when there is exactly one. */
const only = (value: unknown): Fields | undefined =>
  Array.isArray(value) && value.length === 1 && isRecord(value[0]) ? value[0] : undefined

const without = (fields: Fields, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => !keys.includes(key)))

const defined = (fields: Fields) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

const EDIT_KEYS = ['file_path', 'old_string', 'new_string', 'replace_all'] as const

/**
 * hooks.md: "For the file tools Write, Edit, and Read, tool_input.file_path is always absolute
 * … Claude Code expands ~ and relative paths before hooks run".
 */
function absolutePath(path: unknown, cwd: string | undefined): unknown {
  if (typeof path !== 'string' || !path || !cwd) return path
  if (path === '~' || path.startsWith('~/')) return join(homedir(), path.slice(1))
  return resolve(cwd, path)
}

const SHAPES: Record<string, ToolShape> = {
  bash: {
    name: 'Bash',
    toClaude: (input) =>
      typeof input.timeout === 'number' ? { ...input, timeout: input.timeout * 1000 } : input,
    fromClaude: (fields) =>
      typeof fields.timeout === 'number'
        ? { ...fields, timeout: Math.max(1, Math.round(fields.timeout / 1000)) }
        : fields,
  },
  read: {
    name: 'Read',
    toClaude: (input, cwd) =>
      defined({
        ...input,
        file_path: absolutePath(input.path ?? only(input.reads)?.path ?? input.file_path, cwd),
      }),
    fromClaude(fields) {
      const rest = without(fields, ['file_path'])
      const entry = only(rest.reads)
      if (entry) return { ...rest, reads: [{ ...entry, path: fields.file_path }] }
      return defined({ ...rest, path: fields.file_path })
    },
  },
  edit: {
    name: 'Edit',
    toClaude(input, cwd) {
      const entry = only(input.edits)
      if (!entry) return input
      return defined({
        ...input,
        file_path: absolutePath(entry.path, cwd),
        old_string: entry.old_string,
        new_string: entry.new_string,
        replace_all: entry.replace_all,
      })
    },
    fromClaude(fields) {
      // Any other shape (several edits, Claude Code's own) carried its fields unchanged.
      const entry = only(fields.edits)
      if (!entry) return fields
      const rest = without(fields, EDIT_KEYS)
      const folded = defined({
        path: fields.file_path,
        old_string: fields.old_string,
        new_string: fields.new_string,
        replace_all: fields.replace_all,
      })
      return { ...rest, edits: [{ ...entry, ...folded }] }
    },
  },
  write: {
    name: 'Write',
    toClaude(input, cwd) {
      const entry = only(input.files)
      return entry
        ? { ...input, file_path: absolutePath(entry.path, cwd), content: entry.content }
        : input
    },
    fromClaude(fields) {
      const entry = only(fields.files)
      if (!entry) return fields
      const rest = without(fields, ['file_path', 'content'])
      return { ...rest, files: [{ ...entry, path: fields.file_path, content: fields.content }] }
    },
  },
  search: {
    name: 'Grep',
    toClaude: (input) =>
      defined({
        ...input,
        pattern: input.query ?? (Array.isArray(input.queries) ? input.queries[0] : undefined),
      }),
    fromClaude(fields) {
      const rest = without(fields, ['pattern'])
      return fields.pattern === undefined || Array.isArray(rest.queries)
        ? rest
        : { ...rest, query: fields.pattern }
    },
  },
  ask: { name: 'AskUserQuestion', toClaude: (input) => input, fromClaude: (fields) => fields },
  research: {
    name: 'WebSearch',
    toClaude: (input) => defined({ ...input, query: input.question }),
    fromClaude: (fields) =>
      defined({ ...without(fields, ['query']), question: fields.query ?? fields.question }),
  },
}

/** A tool's name as Claude Code's hooks match it: `Bash`, or an MCP tool's `mcp__<server>__<t>`. */
export function claudeCodeToolName(tool: { name: string; aliases?: readonly string[] }): string {
  return SHAPES[tool.name]?.name ?? tool.aliases?.[0] ?? tool.name
}

/** Localix's name for a tool a hook names as Claude Code does (`Bash` is `bash`). */
export function localToolName(name: string): string {
  return Object.entries(SHAPES).find(([, shape]) => shape.name === name)?.[0] ?? name
}

/** The `tool.call` event of a call: Claude Code's name and arguments, and the call's id. */
export function toolCallEvent(
  tool: { name: string; aliases?: readonly string[] },
  input: unknown,
  toolUseId: string,
): Fields {
  const fields = isRecord(input) ? input : {}
  const shape = SHAPES[tool.name]
  return {
    ...(shape ? shape.toClaude(fields) : fields),
    tool: claudeCodeToolName(tool),
    tool_use_id: toolUseId,
  }
}

/** The tool's own input from the event a hook passed to `next`. */
export function toolInputOf(tool: string, event: Fields): Fields {
  const { tool: _tool, tool_use_id: _id, consent: _consent, ...fields } = event
  return SHAPES[tool]?.fromClaude(fields) ?? fields
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
    tool_name: claudeCodeToolName(tool),
    tool_input: shape && isRecord(input) ? shape.toClaude(input, cwd) : input,
    // An MCP tool's server and where it was defined (hooks.md, PreToolUse input `mcp_server`).
    ...(tool.mcpServer
      ? { mcp_server: { name: tool.mcpServer.name, source: tool.mcpServer.source } }
      : {}),
  }
}

/**
 * A tool's result as a PostToolUse hook reads it (`tool_response`). Bash answers in Claude Code's
 * shape (hooks.md: "Bash returns an object with stdout, stderr, interrupted, and isImage
 * fields"), its merged output as `stdout`; other tools keep Localix's `{content, details}`.
 */
export function claudeCodeToolResponse(
  tool: { name: string },
  result: { content: string; details?: unknown },
): unknown {
  if (tool.name !== 'bash') return { content: result.content, details: result.details }
  const output = isRecord(result.details) ? result.details.output : undefined
  return {
    stdout: typeof output === 'string' ? output : result.content,
    stderr: '',
    interrupted: false,
    isImage: false,
  }
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
  const before = isRecord(seen) ? shape.toClaude(seen, cwd) : {}
  const merged = { ...before, ...updated }
  if (isRecord(seen) && before.file_path !== undefined && merged.file_path === before.file_path)
    merged.file_path = shape.toClaude(seen).file_path
  return shape.fromClaude(merged)
}
