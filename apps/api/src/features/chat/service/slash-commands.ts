// Pure parsing of the composer's slash-command grammar. Kept dependency-free so
// it can be unit-tested and reused without constructing the chat service.

import { BUILTIN_COMMAND_NAMES, SLASH_COMMANDS } from '../slash-catalog'

/**
 * The handlers `handleControlCommand` dispatches to. The VALUE is the declaration and
 * the type is derived from it, so the two can never disagree — the map below has to
 * check membership at runtime, and a hand-written union it could only cast to would
 * make that check a lie.
 */
const CONTROL_COMMANDS = [
  'help',
  'usage',
  'model',
  'memory',
  'skills',
  'mcp',
  'plugins',
  'loop',
  'agents',
] as const

/** Built-in slash commands handled by the service. */
export type ControlCommand = (typeof CONTROL_COMMANDS)[number]

// Names reserved by built-in commands — derived from the single shared catalog
// (`../slash-catalog`) so the skill-shadow guard never drifts from the menus.
// Re-exported here for the existing importers.
export { BUILTIN_COMMAND_NAMES }

/**
 * The two commands whose HANDLER name is not their user-facing name. They are the only
 * reason {@link CONTROL_COMMAND_BY_WORD} is not the identity over the catalog, and
 * stating them here is what lets the rest be DERIVED rather than re-typed.
 */
const HANDLER_NAME = new Map<string, ControlCommand>([['plugin', 'plugins']])

/**
 * Typed word (`/help`, `/cost`) → the handler that runs it, DERIVED from the catalog.
 *
 * It used to be twenty hand-typed literals under a catalog comment reading "Keep it in
 * sync with `parseControlCommand` (same names + aliases)". That sentence is the tell: you
 * write it exactly when there is nothing to import. And the drift it invited was silent in
 * the worst direction — the catalog is what RENDERS the menus (web composer, `/help`) and
 * what reserves the name against a user skill, so a command added there but
 * missed here would be offered to the user, refused by `parseSkillCommand` (the name is
 * reserved), and then fall through to the model as a plain chat message. A broken command
 * that looks like a working one, and nothing red anywhere.
 *
 * `scope: 'client'` commands are skipped, which is how `/fork` keeps having no parse case
 * (the composer intercepts it → forkSession RPC) without anyone having to remember to omit
 * it. Aliases come along for free (`/cost`→usage, `/models`→model, `/skill`→skills).
 *
 * A Map (not a plain object) so a pathological lookup like `__proto__` resolves to
 * undefined, not the prototype.
 */
const CONTROL_COMMAND_BY_WORD: ReadonlyMap<string, ControlCommand> = buildControlCommandMap()

/**
 * RUNTIME, not a test assertion: `tsconfig.json` excludes `*.test.ts` and `bun test` does
 * not type-check, so a compile-time guard living in a test file is checked by nothing. This
 * runs on import — in the server and in every test — and a catalog/handler
 * disagreement is a developer edit, never user input, so failing loudly is the honest
 * reaction: the alternative is shipping a menu entry that silently does nothing.
 */
function buildControlCommandMap(): ReadonlyMap<string, ControlCommand> {
  const known: ReadonlySet<string> = new Set(CONTROL_COMMANDS)
  const isControlCommand = (n: string): n is ControlCommand => known.has(n)
  const map = new Map<string, ControlCommand>()
  for (const c of SLASH_COMMANDS) {
    if (c.scope !== 'server') continue
    const handler = HANDLER_NAME.get(c.name) ?? c.name
    if (!isControlCommand(handler)) {
      throw new Error(
        `slash catalog declares server command "/${c.name}", but no ControlCommand handles it. ` +
          `Add "${handler}" to CONTROL_COMMANDS (and a branch in handleControlCommand), or map ` +
          `it in HANDLER_NAME.`,
      )
    }
    for (const word of [c.name, ...(c.aliases ?? [])]) map.set(`/${word}`, handler)
  }
  const unreachable = CONTROL_COMMANDS.filter((h) => ![...map.values()].includes(h))
  if (unreachable.length > 0) {
    throw new Error(
      `ControlCommand(s) no catalog entry can ever produce — a dead handler: ${unreachable.join(', ')}. ` +
        `Add them to SLASH_COMMANDS (scope: 'server') or remove them from CONTROL_COMMANDS.`,
    )
  }
  return map
}

export function parseControlCommand(raw: string): ControlCommand | null {
  const word = raw.trim().toLowerCase().split(/\s/)[0]
  return CONTROL_COMMAND_BY_WORD.get(word) ?? null
}

/** Parse a syntactically valid slash invocation without deciding who owns it.
 * Deliberately excludes path-like text (`/tmp/file`, `//host`) so those remain
 * ordinary prompts; command namespaces use `:` rather than `/`. */
export function parseSlashInvocation(raw: string): { name: string; arg: string } | null {
  const trimmed = raw.trim()
  const match = trimmed.match(
    /^\/([a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)*)(?:\s+([\s\S]*))?$/i,
  )
  if (!match) return null
  return { name: match[1].toLowerCase(), arg: (match[2] ?? '').trim() }
}

/**
 * Split a `/command <value> [rest…]` prompt into its first positional argument
 * (lower-cased) and any trailing free text (e.g. a task to run after switching).
 */
export function splitCommandArg(raw: string): { value: string | undefined; rest: string } {
  const afterCommand = raw.trim().replace(/^\/\S+\s*/, '')
  const match = afterCommand.match(/^(\S+)\s*([\s\S]*)$/)
  if (!match) return { value: undefined, rest: '' }
  return { value: match[1].toLowerCase(), rest: match[2].trim() }
}

/**
 * Everything after the leading `/command` token, whitespace-collapsed and with the
 * ORIGINAL case preserved — for commands whose whole remainder is a single free-form
 * argument (/memory <fact>, /model <name>). Distinct from
 * splitCommandArg, which lowercases the first token and separates value-vs-rest.
 * Keep the `\s+` split so internal whitespace/newlines collapse identically.
 */
export function commandRemainder(raw: string): string {
  return raw.trim().split(/\s+/).slice(1).join(' ').trim()
}

/**
 * Extracts a `/skill-name` style command and its argument from raw input. The name
 * may be colon-namespaced (`/git:commit`) so filesystem `.claude/commands/git/commit.md`
 * subdir commands dispatch as skills — a bare-name skill still matches unchanged.
 */
export function parseSkillCommand(raw: string): { name: string; arg: string } | null {
  const invocation = parseSlashInvocation(raw)
  if (!invocation || BUILTIN_COMMAND_NAMES.has(invocation.name)) return null
  return invocation
}

/** Shell-style token split for `$ARGUMENTS[N]` / `$N` substitutions in skill templates. */
export function splitSkillArgs(raw: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

/**
 * Substitutes argument tokens into a skill template — mirrors Claude Code behaviour.
 * Handles: `$ARGUMENTS` (full string), `$ARGUMENTS[N]` (Nth token), `$N` (Nth token),
 * `$name` (named from `argumentNames`), `${CLAUDE_SKILL_DIR}`, `${CLAUDE_SESSION_ID}`,
 * `${CLAUDE_EFFORT}`, `\$` escape.
 * Falls back to appending `Arguments: <arg>` when no token appears in the template.
 */
export function applySkillArguments(
  template: string,
  arg: string,
  opts?: {
    argumentNames?: string[]
    skillDir?: string
    sessionId?: string
    effort?: string
    projectDir?: string
  },
): string {
  const trimmed = arg.trim()
  const tokens = splitSkillArgs(trimmed)
  // Build name→value map from declared positional argument names.
  const namedValues: Record<string, string> = {}
  for (const [i, name] of (opts?.argumentNames ?? []).entries()) {
    namedValues[name] = tokens[i] ?? ''
  }
  // Check for ANY argument token (escaped or not) — the replacement loop handles
  // the \$ escape itself; removing the lookbehind here ensures a template that
  // contains ONLY escaped tokens (e.g. "\$ARGUMENTS") still enters the replacement
  // path and emits the literal "$ARGUMENTS" instead of appending arguments.
  const hasToken =
    /\$(?:ARGUMENTS(?:\[\d+\])?|\d+|[a-zA-Z_][a-zA-Z0-9_]*)/.test(template) ||
    template.includes('${CLAUDE_SKILL_DIR}') ||
    template.includes('${CLAUDE_PROJECT_DIR}') ||
    template.includes('${CLAUDE_SESSION_ID}') ||
    template.includes('${CLAUDE_EFFORT}')
  if (!hasToken) return trimmed ? `${template}\n\nArguments: ${trimmed}` : template

  let out = template
  // CC environment substitutions.
  if (opts?.skillDir) out = out.split('${CLAUDE_SKILL_DIR}').join(opts.skillDir)
  if (opts?.sessionId) out = out.split('${CLAUDE_SESSION_ID}').join(opts.sessionId)
  if (opts?.effort) out = out.split('${CLAUDE_EFFORT}').join(opts.effort)
  if (opts?.projectDir) out = out.split('${CLAUDE_PROJECT_DIR}').join(opts.projectDir)
  // Argument tokens (ordered: named first, then positional + $ARGUMENTS).
  out = out.replace(
    /(\\?)\$(ARGUMENTS(?:\[(\d+)\])?|(\d+)|([a-zA-Z_][a-zA-Z0-9_]*))/g,
    (
      full: string,
      esc: string,
      token: string,
      bracketIdx?: string,
      bareIdx?: string,
      name?: string,
    ) => {
      if (esc) return full.slice(1) // \$… → literal $…
      if (token === 'ARGUMENTS') return trimmed // bare $ARGUMENTS
      if (bracketIdx !== undefined) return tokens[Number(bracketIdx)] ?? '' // $ARGUMENTS[N]
      if (bareIdx !== undefined) return tokens[Number(bareIdx)] ?? '' // $N
      if (name && name in namedValues) return namedValues[name] // $name
      return full // unknown $name — leave as-is
    },
  )
  return out
}
