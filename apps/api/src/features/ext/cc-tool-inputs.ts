/**
 * Localix's file, shell, search and web tools in Claude Code's input shapes (hooks.md, PreToolUse
 * input; the mod types' `BuiltinToolInputs`): `Bash` `command` / `timeout` in milliseconds /
 * `run_in_background`, `Read` `file_path` / line `offset` / `limit`, `Edit`, `Write`, `Grep`
 * and `Glob` `pattern` / `path`, `WebFetch` `url` / `prompt`, `WebSearch` `query`. Each shape
 * keeps Localix's own fields beside Claude Code's and folds a hook's rewrite back onto them.
 */
import {
  absolutePath,
  baseOf,
  defined,
  num,
  only,
  str,
  without,
  type Fields,
  type ToolShape,
} from './cc-tool-fields'

const EDIT_KEYS = ['file_path', 'old_string', 'new_string', 'replace_all'] as const
/** NotebookEdit's own fields, which the `edit` tool never takes. */
const NOTEBOOK_KEYS = ['notebook_path', 'new_source', 'edit_mode', 'cell_id', 'cell_type'] as const

/** A batch of commands as the one line Claude Code's Bash would run (each stops the next). */
export function batchCommand(input: Fields): string | undefined {
  const list = input.commands
  if (!Array.isArray(list) || list.length === 0 || !list.every((c) => typeof c === 'string'))
    return undefined
  return list.join(input.keep_going === true ? '; ' : ' && ')
}

/** A `bash` call with `until` is the wait Claude Code's Monitor tool starts. */
const isWait = (input: Fields) => input.until !== undefined

const bash: ToolShape = {
  name: 'Bash',
  names: ['Monitor'],
  nameFor: (input) => (isWait(input) ? 'Monitor' : 'Bash'),
  toClaude(input) {
    const command = input.command ?? batchCommand(input)
    const timeout = num(input.timeout)
    if (isWait(input))
      // Monitor's deadline is `timeout_ms`; `timeout` (seconds) is Bash's field, not its own.
      return defined({
        ...without(input, ['timeout']),
        command,
        timeout_ms: timeout !== undefined ? timeout * 1000 : undefined,
      })
    return defined({
      ...input,
      command,
      timeout: timeout !== undefined ? timeout * 1000 : undefined,
      run_in_background: typeof input.background === 'boolean' ? input.background : undefined,
    })
  },
  fromClaude(fields, name) {
    const out = without(fields, ['run_in_background', 'description', 'dangerouslyDisableSandbox'])
    if (name === 'Monitor') {
      const ms = num(fields.timeout_ms)
      const rest = without(out, ['timeout_ms', 'ws'])
      return ms !== undefined ? { ...rest, timeout: Math.max(1, Math.round(ms / 1000)) } : rest
    }
    const timeout = num(fields.timeout)
    if (timeout !== undefined) out.timeout = Math.max(1, Math.round(timeout / 1000))
    if (typeof fields.run_in_background === 'boolean') out.background = fields.run_in_background
    const batch = batchCommand(out)
    if (batch === undefined) return out
    // The line the hook was shown, handed back: the batch runs. Rewritten: the line runs.
    if (out.command === undefined || out.command === batch) return without(out, ['command'])
    return without(out, ['commands', 'keep_going'])
  },
}

const read: ToolShape = {
  name: 'Read',
  toClaude(input, cwd) {
    const entry = only(input.reads)
    const start = num(input.start_line) ?? num(entry?.start_line)
    const end = num(input.end_line) ?? num(entry?.end_line)
    const first = start ?? (end !== undefined ? 1 : undefined)
    // Localix's `byte_offset` counts bytes; Claude Code's `offset` counts lines, so only a line
    // range shows as it.
    return defined({
      ...without(input, ['byte_offset']),
      file_path: absolutePath(input.path ?? entry?.path ?? input.file_path, baseOf(input, cwd)),
      offset: first,
      limit:
        num(input.limit) ??
        (first !== undefined && end !== undefined ? end - first + 1 : undefined),
    })
  },
  fromClaude(fields) {
    const rest = without(fields, ['file_path', 'offset', 'limit', 'allow_large'])
    const start = num(fields.offset)
    const limit = num(fields.limit)
    const range = defined({
      start_line: start ?? (limit !== undefined ? num(rest.start_line) : undefined),
      end_line:
        limit !== undefined ? (start ?? num(rest.start_line) ?? 1) + limit - 1 : rest.end_line,
    })
    const entry = only(rest.reads)
    if (entry) {
      const path = fields.file_path ?? entry.path
      return { ...without(rest, ['start_line', 'end_line']), reads: [{ ...entry, path, ...range }] }
    }
    return defined({ ...rest, ...range, path: fields.file_path ?? rest.path })
  },
  carry: (seen) =>
    num(seen.byte_offset) !== undefined && seen.start_line === undefined
      ? { byte_offset: seen.byte_offset }
      : {},
}

// One edit, or one file written, reads as Claude Code's single-file call with no list beside it;
// several stay Localix's list (a mods host fires one `tool.call` per entry: `singleCalls`).
const edit: ToolShape = {
  name: 'Edit',
  toClaude(input, cwd) {
    const entry = only(input.edits)
    if (!entry) return input
    const filePath = absolutePath(entry.path, baseOf(input, cwd))
    // A notebook's cell source is a string edit of its JSON here: `notebook_path`, the new source
    // and the (replace) mode are what a NotebookEdit hook reads; the cell id cannot be derived.
    const notebook = typeof entry.path === 'string' && entry.path.endsWith('.ipynb')
    return defined({
      ...without(input, ['edits']),
      ...without(entry, ['path', ...EDIT_KEYS]),
      file_path: filePath,
      old_string: entry.old_string,
      new_string: entry.new_string,
      replace_all: entry.replace_all,
      notebook_path: notebook ? filePath : undefined,
      new_source: notebook ? entry.new_string : undefined,
      edit_mode: notebook ? 'replace' : undefined,
    })
  },
  fromClaude(fields) {
    // Several edits, or a list a hook passed, carry their fields unchanged.
    if (fields.edits !== undefined || fields.file_path === undefined)
      return without(fields, NOTEBOOK_KEYS)
    const rest = without(fields, [...EDIT_KEYS, ...NOTEBOOK_KEYS])
    const entry = defined({
      path: fields.file_path,
      old_string: fields.old_string,
      new_string: fields.new_string,
      replace_all: fields.replace_all,
    })
    return { ...rest, edits: [entry] }
  },
}

const write: ToolShape = {
  name: 'Write',
  toClaude(input, cwd) {
    const entry = only(input.files)
    if (!entry) return input
    return {
      ...without(input, ['files']),
      ...without(entry, ['path', 'content']),
      file_path: absolutePath(entry.path, baseOf(input, cwd)),
      content: entry.content,
    }
  },
  fromClaude(fields) {
    if (fields.files !== undefined || fields.file_path === undefined) return fields
    const rest = without(fields, ['file_path', 'content'])
    return { ...rest, files: [{ path: fields.file_path, content: fields.content }] }
  },
}

/**
 * Grep's and Glob's own fields that Localix's `search` does not take under that name; its
 * `output_mode`, `head_limit`, `type` and `multiline` are Grep's, and `-i` is `ignore_case`.
 */
const SEARCH_KEYS = ['pattern', '-i', '-n', '-A', '-B', '-C', 'offset', 'context_lines']

/** Several regexes as one: Grep's `pattern` matches a line any of them matches. */
const queriesPattern = (input: Fields) =>
  Array.isArray(input.queries) ? input.queries.join('|') : undefined

const search: ToolShape = {
  name: 'Grep',
  names: ['Glob'],
  nameFor: (input) =>
    input.query === undefined && input.queries === undefined && typeof input.glob === 'string'
      ? 'Glob'
      : 'Grep',
  toClaude(input, cwd) {
    const base = baseOf(input, cwd)
    const path =
      input.path !== undefined
        ? absolutePath(input.path, base)
        : input.cwd !== undefined
          ? base
          : undefined
    if (search.nameFor!(input) === 'Glob') return defined({ ...input, pattern: input.glob, path })
    return defined({
      ...input,
      pattern: input.query ?? queriesPattern(input),
      path,
      output_mode: input.output_mode ?? 'content',
      '-i': input.ignore_case === true ? true : undefined,
      '-C': num(input.context),
    })
  },
  fromClaude(fields, name) {
    const rest = without(fields, SEARCH_KEYS)
    // `-i` is the one Grep flag with a field of its own here; a rewrite to false turns it off.
    if (typeof fields['-i'] === 'boolean') {
      if (fields['-i']) rest.ignore_case = true
      else delete rest.ignore_case
    }
    const pattern = str(fields.pattern)
    if (name === 'Glob')
      return pattern === undefined ? rest : without({ ...rest, glob: pattern }, ['query'])
    const context = num(fields['-C']) ?? num(fields.context_lines)
    const out = context !== undefined ? { ...rest, context } : rest
    if (pattern === undefined || pattern === queriesPattern(rest)) return out
    // A rewritten pattern replaces the batch.
    return { ...without(out, ['queries']), query: pattern }
  },
}

const WEB_KEYS = ['query', 'url', 'prompt', 'allowed_domains', 'blocked_domains', 'mode', 'offset']

const research: ToolShape = {
  name: 'WebSearch',
  names: ['WebFetch'],
  nameFor: (input) =>
    Array.isArray(input.urls) && input.urls.length > 0 && input.queries === undefined
      ? 'WebFetch'
      : 'WebSearch',
  toClaude(input) {
    if (research.nameFor!(input) === 'WebFetch')
      return defined({ ...input, url: (input.urls as unknown[])[0], prompt: input.question })
    return defined({
      ...input,
      query: input.question,
      allowed_domains: input.include_domains,
      blocked_domains: input.exclude_domains,
    })
  },
  fromClaude(fields, name) {
    const rest = without(fields, WEB_KEYS)
    if (name === 'WebFetch') {
      const urls = Array.isArray(rest.urls) ? (rest.urls as unknown[]) : []
      const url = str(fields.url)
      return defined({
        ...rest,
        question: fields.prompt ?? rest.question ?? url,
        urls: url === undefined || url === urls[0] ? rest.urls : [url, ...urls.slice(1)],
      })
    }
    return defined({
      ...rest,
      question: fields.query ?? rest.question,
      include_domains: fields.allowed_domains ?? rest.include_domains,
      exclude_domains: fields.blocked_domains ?? rest.exclude_domains,
    })
  },
}

export const FILE_AND_WEB_SHAPES: Record<string, ToolShape> = {
  bash,
  read,
  edit,
  write,
  search,
  research,
}
