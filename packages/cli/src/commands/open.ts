/**
 * The `open` command — `localix .` / `localix <path>` (and the bare `localix`,
 * which opens the current directory). Resolves the path to an absolute path,
 * builds a `localix://open?path=…` deep link, and hands it to the OS scheme
 * handler so the RUNNING desktop app opens it (a directory becomes a project, a
 * file a lightweight editor tab). This is the CLI-as-continuation-of-the-IDE
 * path: it drives the desktop app, it does not boot its own server.
 */

import { homedir } from 'node:os'

import { performHandoff } from '@localixai/os-open'

import type { CliContext } from '../context'
import type { OpenCommandOptions } from '../args'
import { printHelp } from './help'
import { buildOpenUrl, openOutcomeMessage, resolveOpenPath } from '../open-url'

export async function openCommand(options: OpenCommandOptions, ctx: CliContext): Promise<void> {
  if (options.help) return printHelp()
  if (options.version) {
    process.stdout.write(`localix ${ctx.version ?? 'dev'}\n`)
    return
  }
  const absPath = resolveOpenPath(options.pathArg ?? '.', process.cwd(), homedir())
  const url = buildOpenUrl(absPath, options.fresh)

  // The scheme opener exits non-zero when NOTHING is registered for `localix://`
  // — i.e. the desktop app isn't installed. `performHandoff` waits for that exit
  // and carries the reason back, so we report the truth instead of a hopeful
  // "Opening…". (Windows `start` exit codes are unreliable and treated leniently
  // there, which the shared table already knows.)
  const result = await performHandoff({ kind: 'url', url })

  const { stream, text } = openOutcomeMessage(
    absPath,
    result.ok,
    result.ok ? undefined : result.reason,
  )
  process[stream].write(text)
}
