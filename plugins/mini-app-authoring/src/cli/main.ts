import { loadKit } from '../kit/kit'
import { resolveKit } from '../kit/resolve'
import { errorMessage, UserError } from '../lib/errors'
import { postEdit } from '../hook/post-edit'
import { parseArgs } from './args'
import { type CliContext, COMMANDS, HELP } from './commands'

/** `mini-app <command>`: the exit code; output goes to `context.out`. */
export async function runCli(argv: readonly string[], context: CliContext): Promise<number> {
  const args = parseArgs(argv)
  if (!args.command || args.command === 'help' || args.options.help === true) {
    context.out(HELP)
    return args.command && args.command !== 'help' ? 2 : 0
  }
  const command = COMMANDS[args.command]
  if (!command) {
    context.out(`Unknown command "${args.command}".\n\n${HELP}`)
    return 2
  }
  try {
    return await command(args, context)
  } catch (error) {
    if (!(error instanceof UserError)) throw error
    context.out(error.message)
    return 1
  }
}

function memo<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | null = null
  return () => (value ??= load())
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  if (argv[0] === 'hook' && argv[1] === 'post-edit') {
    // A hook must never fail the edit it follows: any error means nothing to say.
    const output = await postEdit(await Bun.stdin.text(), async () =>
      loadKit((await resolveKit({ offline: true })).dir),
    ).catch(() => null)
    if (output) process.stdout.write(`${output}\n`)
    process.exit(0)
  }
  const kit = memo(async () => {
    const source = await resolveKit()
    return { source, kit: await loadKit(source.dir) }
  })
  try {
    process.exitCode = await runCli(argv, {
      cwd: process.cwd(),
      out: (text) => process.stdout.write(`${text}\n`),
      kit,
    })
  } catch (error) {
    process.stderr.write(`mini-app: ${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}
