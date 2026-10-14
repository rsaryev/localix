/**
 * CLI entry — the top layer. It parses argv, dispatches to a command, and turns a
 * UsageError into a clean one-line message (no stack). The JS launcher
 * (`bin/localix.mjs`) calls `runCli(argv, ctx)`; `ctx` carries the host facts the
 * launcher already resolved (see CliContext).
 *
 * Layering:  main (this) → args → commands/*
 */

import type { CliContext } from './context'
import { UsageError, parseArgs } from './args'
import { openCommand } from './commands/open'
import { printHelp } from './commands/help'

/** A malformed invocation exits 2, so a script can tell it from a failed handoff. */
export const CLI_EXIT_CODES = { usage: 2 } as const

export async function runCli(argv: readonly string[], ctx: CliContext): Promise<void> {
  try {
    // Parsing is INSIDE the try so a malformed invocation is reported as a usage
    // error with its own exit code rather than silently ignored (see args.ts).
    // `parseArgs` only ever yields a command this switch handles: an unknown
    // bareword is a PATH, not a typo (args.ts: looksLikePath).
    const { command, options } = parseArgs(argv)
    if (command === 'help') {
      printHelp()
      return
    }
    await openCommand(options, ctx)
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`\n  ✗  ${error.message}\n\n`)
      process.exit(CLI_EXIT_CODES.usage)
    }
    throw error
  }
}

export type { CliContext } from './context'
