import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { run, tempDirPerTest, writeTree } from '@localixai/testing'

/**
 * A mod's worker gone wrong, in a plain Bun process as the API runs: a hook that never yields the
 * thread is stopped while the host goes on answering, and a rejection nothing handled is reported
 * without stopping the mod. Bun's test runner does not hand a worker's process-level handlers its
 * errors, so these run outside it; each waits on real time (the hang window).
 */

const scratch = tempDirPerTest('mods-worker-process', {})

/** Runs `body` against a host with `mods`, in its own Bun process; answers what it printed. */
async function scenario(mods: Record<string, string>, body: string): Promise<unknown> {
  const dir = scratch()
  const files: Record<string, string> = {}
  for (const [plugin, code] of Object.entries(mods)) files[`${plugin}/hooks/register.js`] = code
  writeTree(dir, {
    ...files,
    'scenario.ts': `
      import { join } from 'node:path'
      import { createModsHost } from ${JSON.stringify(join(import.meta.dir, '..', 'host.ts'))}
      import { INERT_MOD_PORTS } from ${JSON.stringify(join(import.meta.dir, '..', 'contracts.ts'))}
      const dir = ${JSON.stringify(dir)}
      const reports: string[] = []
      const waiters: Array<[string, (line: string) => void]> = []
      const host = createModsHost(
        {
          ...INERT_MOD_PORTS,
          dataDir: (plugin) => join(dir, 'data', plugin),
          workspaceDir: dir,
          report(plugin, message) {
            const line = plugin + ': ' + message
            reports.push(line)
            for (const waiter of waiters.filter(([match]) => line.includes(match)))
              waiters.splice(waiters.indexOf(waiter), 1)[0]![1](line)
          },
        },
        { hangMs: 300, engine: { budgetMs: 150 } },
      )
      await host.reconcile(${JSON.stringify(Object.keys(mods))}.map((plugin) => ({
        plugin,
        root: join(dir, plugin),
        module: join(dir, plugin, 'hooks/register.js'),
        options: {},
        revision: '1',
      })))
      const scene = { userId: 'u', cwd: dir }
      const command = (plugin: string, name: string) =>
        host.runCommand({ command: name }, scene, new Set([plugin]))
      const reported = (match: string) =>
        new Promise<string>((resolve) => waiters.push([match, resolve]))
      const result = await (async () => { ${body} })()
      await host.stop()
      console.log(JSON.stringify({ ...result, reports }))
      process.exit(0)
    `,
  })
  const outcome = await run(process.execPath, [join(dir, 'scenario.ts')], { timeoutMs: 20_000 })
  expect(outcome.code).toBe(0)
  return JSON.parse(outcome.stdout.trim().split('\n').at(-1)!)
}

test('a hook that holds its thread is stopped, the host answers meanwhile, and the mod starts again', async () => {
  const outcome = await scenario(
    {
      spinner: `
        let starts = 0
        export function register(on) {
          on('session.start', async ($, e, next) => {
            starts += 1
            return next(e)
          })
          on('command.run', { command: 'spin' }, async () => {
            for (;;) {}
          })
          on('command.run', { command: 'starts' }, async () => ({ text: 'starts ' + starts }))
        }
      `,
      other: `
        export function register(on) {
          on('command.run', { command: 'ping' }, async () => ({ text: 'pong' }))
        }
      `,
    },
    `
      const stopped = reported('stopped answering')
      const spinning = command('spinner', 'spin')
      const other = await command('other', 'ping')
      const spun = await spinning
      await stopped
      return { other, spun, again: await command('spinner', 'starts') }
    `,
  )
  expect(outcome).toEqual({
    other: { text: 'pong' },
    // Out of time: the hook is skipped, and the command answers as with no mod.
    spun: {},
    again: { text: 'starts 1' },
    reports: [
      'spinner: command.run: hook skipped: timeout ran out of time',
      'spinner: the hooks module stopped answering for 300 ms; it starts again on its next event',
    ],
  })
}, 30_000)

test('a rejection nothing handled is reported, and the mod goes on', async () => {
  const outcome = await scenario(
    {
      careless: `
        export function register(on) {
          on('command.run', { command: 'drop' }, async () => {
            Promise.reject(new Error('dropped'))
            return { text: 'ok' }
          })
        }
      `,
    },
    `
      const rejected = reported('unhandled rejection')
      const first = await command('careless', 'drop')
      await rejected
      const again = reported('unhandled rejection')
      const second = await command('careless', 'drop')
      await again
      return { first, second }
    `,
  )
  expect(outcome).toEqual({
    first: { text: 'ok' },
    second: { text: 'ok' },
    reports: ['careless: unhandled rejection: dropped', 'careless: unhandled rejection: dropped'],
  })
}, 30_000)
