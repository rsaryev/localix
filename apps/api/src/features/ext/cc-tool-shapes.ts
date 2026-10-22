/**
 * Localix's core tools as a Claude Code mod sees them in `tool.call`: under Claude Code's names
 * (`Bash`, `Read`, `Edit` …) with their arguments in Claude Code's shape — `file_path`,
 * `old_string`, `content`, a Grep `pattern`, a Bash `timeout` in milliseconds. A call that edits or
 * writes one file reads as Claude Code's single-file call; a hook's rewrite of those fields is
 * carried back onto Localix's own input. Other tools pass through under their own names.
 */

type Fields = Record<string, unknown>

interface ToolShape {
  /** Claude Code's name for the tool. */
  name: string
  /** The arguments as Claude Code's tool takes them, beside Localix's own. */
  toClaude(input: Fields): Fields
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
    toClaude: (input) =>
      defined({ ...input, file_path: input.path ?? only(input.reads)?.path ?? input.file_path }),
    fromClaude(fields) {
      const rest = without(fields, ['file_path'])
      const entry = only(rest.reads)
      if (entry) return { ...rest, reads: [{ ...entry, path: fields.file_path }] }
      return defined({ ...rest, path: fields.file_path })
    },
  },
  edit: {
    name: 'Edit',
    toClaude(input) {
      const entry = only(input.edits)
      if (!entry) return input
      return defined({
        ...input,
        file_path: entry.path,
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
    toClaude(input) {
      const entry = only(input.files)
      return entry ? { ...input, file_path: entry.path, content: entry.content } : input
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
 * Localix's own, so a hook script that tests `tool_name == 'Bash'` reads what it expects.
 */
export function claudeCodeHookCall(
  tool: { name: string; aliases?: readonly string[] },
  input: unknown,
): { tool_name: string; tool_input: unknown } {
  const shape = SHAPES[tool.name]
  return {
    tool_name: claudeCodeToolName(tool),
    tool_input: shape && isRecord(input) ? shape.toClaude(input) : input,
  }
}

/**
 * Localix's input from a hook's `updatedInput`. Claude Code's hook replaces the whole input in
 * its own shape, so its fields land over the call as the hook saw it and fold back into
 * Localix's (`file_path` onto the one edit's `path`).
 */
export function localInputFromHook(tool: string, seen: unknown, updated: unknown): unknown {
  const shape = SHAPES[tool]
  if (!shape || !isRecord(updated)) return updated
  const before = isRecord(seen) ? shape.toClaude(seen) : {}
  return shape.fromClaude({ ...before, ...updated })
}
