/**
 * The command line: a command, its positional arguments, and `--name value` or `--flag` options.
 * Small on purpose — every command takes a folder and a handful of options.
 */

export interface ParsedArgs {
  command: string | null
  positional: string[]
  options: Record<string, string | true>
}

/** Options that never take a value, so `--json dir` keeps `dir` positional. */
const FLAGS = new Set(['json', 'help', 'no-tests', 'force'])

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = []
  const options: Record<string, string | true> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === '--') {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/su, 2) as [string, string | undefined]
    if (inline !== undefined) options[name] = inline
    else if (
      FLAGS.has(name) ||
      argv[index + 1] === undefined ||
      argv[index + 1]!.startsWith('--')
    ) {
      options[name] = true
    } else {
      options[name] = argv[index + 1]!
      index += 1
    }
  }
  const [command = null, ...rest] = positional
  return { command, positional: rest, options }
}

/** A string option, or undefined; a bare `--name` without a value counts as missing. */
export function stringOption(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name]
  return typeof value === 'string' && value.trim() ? value : undefined
}
