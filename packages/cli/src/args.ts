/**
 * Typed argv parsing for the CLI. Kept deliberately small — a hand-rolled parser
 * (no dependency) is enough for the launcher's flag set and mirrors the project's
 * no-extra-deps stance. `parseArgs` splits the command word from its options.
 */

import { statSync } from 'node:fs'

export interface OpenCommandOptions {
  /**
   * The path argument for the `open` command (`localix .` / `localix <path>`).
   * Carries the raw token; the command resolves it to an absolute path.
   */
  pathArg?: string
  /** Ask the desktop app for a fresh project/session for the path. */
  fresh?: boolean
  help?: boolean
  /** Print the version and exit. */
  version?: boolean
}

/**
 * A malformed invocation: an unknown flag, or a value flag with no value. The CLI
 * exits with a DIFFERENT code for it, so a script can tell "I called it wrong"
 * apart from "the handoff failed".
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Command words the CLI understands explicitly. */
const KNOWN_COMMANDS = new Set(['open', 'help'])

/**
 * A non-flag first token that isn't a known command is treated as a PATH to open
 * (`localix <path>`): `.`, `..`, `~`, `/abs`, `./rel`, `C:\…`, or a bare name
 * resolved against the cwd. This lets `localix .` / `localix src/x.ts` open in
 * the desktop app.
 */
export function looksLikePath(token: string): boolean {
  return token.length > 0 && !token.startsWith('-') && !KNOWN_COMMANDS.has(token)
}

export interface ParsedArgs {
  /** The command word (`open` is the default when omitted). */
  command: string
  options: OpenCommandOptions
}

type BoolOption = 'fresh' | 'help' | 'version'

/** A Map, so a path token like `constructor` is never mistaken for an inherited alias. */
const BOOL_ALIASES: ReadonlyMap<string, BoolOption> = new Map([
  ['--new', 'fresh'],
  ['-n', 'fresh'],
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-v', 'version'],
])

/** True when `token` names an existing directory relative to the cwd. */
function isExistingDirectory(token: string): boolean {
  try {
    return statSync(token).isDirectory()
  } catch {
    return false
  }
}

/**
 * `isDirectory` is injectable for tests. A lone command word that is also an
 * existing directory (`localix open` with `./open` on disk) opens the directory:
 * the user typed a bare name that resolves to something real, and the command
 * word alone would only open the cwd anyway. `localix open open` already routes
 * the second token to the path argument.
 */
export function parseArgs(
  argv: readonly string[],
  isDirectory: (token: string) => boolean = isExistingDirectory,
): ParsedArgs {
  const [first, ...rest] = argv
  const lonePathCommand =
    first !== undefined &&
    KNOWN_COMMANDS.has(first) &&
    !rest.some((token) => !token.startsWith('-')) &&
    isDirectory(first)

  // A path-like first token (not a flag, not a known command) → the `open` command,
  // with the token captured as its path argument.
  if (first && (looksLikePath(first) || lonePathCommand)) {
    const options = parseFlags(rest)
    options.pathArg = first
    return { command: 'open', options }
  }

  const command = first && !first.startsWith('-') ? first : 'open'
  const tokens = first && !first.startsWith('-') ? rest : argv
  return { command, options: parseFlags(tokens) }
}

function parseFlags(tokens: readonly string[]): OpenCommandOptions {
  const options: OpenCommandOptions = {}
  const positional: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const alias = BOOL_ALIASES.get(token)
    if (alias) {
      options[alias] = true
    } else if (token.startsWith('-') && token !== '-') {
      // Silently ignoring an unknown flag is the worst outcome: the user would
      // believe an option took effect. Fail before anything is opened.
      throw new UsageError(`unknown option "${token}"`)
    } else {
      positional.push(token)
    }
  }

  // First bareword positional → the path for `open <path>`.
  if (positional.length > 0 && options.pathArg === undefined) options.pathArg = positional[0]
  return options
}
