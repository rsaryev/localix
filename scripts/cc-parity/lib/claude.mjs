import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { sleep, waitFor } from '../../lib/wait.mjs'

/**
 * Running the installed `claude` the way a mod author does — nothing else. This file never reads,
 * unpacks or inspects Claude Code's program; it starts `claude` with documented flags and reads
 * only the files a mod is documented to get: the type declarations Claude Code writes into a mod
 * loaded with `--plugin-dir` (create.md, "Get type definitions for your version"), and what the
 * probe mod itself writes with `$.fs.write`.
 */

/** Where Claude Code writes a loaded mod's declarations of its events and mods API. */
export const typesFile = (probe) =>
  join(probe, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null)

/**
 * Start an interactive session with the probe loaded — in a pseudo-terminal, as a person would in
 * their terminal — until Claude Code has written the probe's type declarations, then end it. No
 * prompt is sent, so no model is asked. While it runs, the probe records the events an idle
 * interactive session fires (`session.start`, the `ui.render` sites it draws) into `record`, and,
 * once its `/probe` command is registered, the runner types `/probe`, which the mod answers
 * without a model, so its no-model `$` calls are seen in a real terminal session too.
 */
export async function interactiveSession({ probe, cwd, record, timeoutMs, settleMs = 4000 }) {
  const env = { ...process.env, CC_PARITY_OUT: record }
  delete env.CC_PARITY_ALLOW_MODEL
  let screen = ''
  // Bun's own pseudo-terminal: `script -q /dev/null` refuses a stdin that is not a terminal.
  const child = Bun.spawn(['claude', '--plugin-dir', probe], {
    cwd,
    env,
    terminal: {
      cols: 160,
      rows: 48,
      data: (_terminal, chunk) => void (screen = (screen + chunk.toString()).slice(-20_000)),
    },
  })
  const type = (text) => {
    if (child.exitCode === null) child.terminal.write(text)
  }
  try {
    await waitFor(
      'the type declarations',
      () => existsSync(typesFile(probe)),
      timeoutMs,
      250,
    ).catch(() => {
      throw new Error(
        `Claude Code did not write ${typesFile(probe)} within ${timeoutMs / 1000} s. ` +
          `The usual cause is the workspace trust prompt for ${cwd}: start \`claude\` there once ` +
          'and accept it, or pass --cwd <a folder you trust>. The last screen was:\n' +
          plainScreen(screen).slice(-1200),
      )
    })
    // Let the idle session draw, then run `/probe` once the probe registered it.
    await sleep(settleMs)
    const registered = readJson(record)?.entries?.some((entry) => entry.name === 'command.register')
    if (registered) {
      type('/probe')
      await sleep(600)
      type('\r')
      await sleep(settleMs)
    }
  } finally {
    await stop(child, type)
  }
  return { record: readJson(record) }
}

/** End the session as a person would (two Ctrl-C), then make sure it is gone. */
async function stop(child, type) {
  type('\x03')
  await sleep(300)
  type('\x03')
  const gone = () => Promise.race([child.exited.then(() => true), sleep(3000).then(() => false)])
  if (await gone()) return
  child.kill('SIGTERM')
  if (await gone()) return
  child.kill('SIGKILL')
  await child.exited
}

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const CONTROL = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g')
const TITLE = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'g')

/** A pseudo-terminal's output without its escape sequences, for an error message. */
const plainScreen = (text) =>
  text
    .replace(CONTROL, '')
    .replace(TITLE, '')
    .replace(/[\r\t ]+/g, ' ')

/**
 * One non-interactive run (`claude -p`) with the probe loaded, in `cwd`. This asks a model and
 * spends the person's own Claude Code usage: callers run it only behind `--allow-model`.
 * `acceptEdits` lets the Write tool write inside `cwd` without asking (permission-modes.md);
 * `--allowedTools Write` names the one tool the prompt needs.
 */
export function printRun({ probe, cwd, record, prompt, model = 'haiku', allowModelCalls }) {
  const env = { ...process.env, CC_PARITY_OUT: record }
  if (allowModelCalls) env.CC_PARITY_ALLOW_MODEL = '1'
  else delete env.CC_PARITY_ALLOW_MODEL
  const args = ['-p', prompt, '--plugin-dir', probe, '--model', model]
  args.push('--permission-mode', 'acceptEdits', '--allowedTools', 'Write', '--max-turns', '4')
  const result = spawnSync('claude', args, { cwd, env, encoding: 'utf8', timeout: 180_000 })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}
