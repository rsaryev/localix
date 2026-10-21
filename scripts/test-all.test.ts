import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runConcurrently } from './test-all.mjs'

const bun = process.execPath

// Each side marks its start, then waits for the other's mark: both pass only when they run at once.
const handshake = (mine: string, theirs: string, exitCode = 0) => [
  '-e',
  `import { existsSync, writeFileSync } from 'node:fs'
   writeFileSync(${JSON.stringify(mine)}, '')
   for (let i = 0; i < 100 && !existsSync(${JSON.stringify(theirs)}); i += 1) await Bun.sleep(50)
   if (!existsSync(${JSON.stringify(theirs)})) process.exit(9)
   console.log('kept')
   process.exit(${exitCode})`,
]

test('runs every command at once and names each one that failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'localix-test-all-'))
  const [first, second] = [join(dir, 'first'), join(dir, 'second')]
  let printed = ''
  const failed = await runConcurrently(
    [
      { label: 'first', command: bun, args: handshake(first, second) },
      { label: 'second', command: bun, args: handshake(second, first, 3) },
    ],
    { write: (text) => (printed += text) },
  )
  expect(failed).toEqual(['second'])
  expect(printed).toContain('[test] second (failed)\nkept')
})

test('a command that cannot start fails instead of hanging', async () => {
  const failed = await runConcurrently(
    [
      { label: 'ok', command: bun, args: ['-e', ''] },
      { label: 'missing', command: 'localix-no-such-command', args: [] },
    ],
    { write: () => {} },
  )
  expect(failed).toEqual(['missing'])
})

test('the unit and system slices together run exactly what the whole suite runs', async () => {
  const { suiteCommands } = await import('./test-all.mjs')
  const tasks = (slice: 'all' | 'unit' | 'system') =>
    suiteCommands(slice).flatMap((command) => command.args.filter((arg) => !arg.startsWith('--')))
  expect([...tasks('unit'), ...tasks('system')].sort()).toEqual([...tasks('all'), 'turbo'].sort())
  expect(suiteCommands('unit').map((command) => command.label)).toEqual(['packages'])
  expect(suiteCommands('system', { filter: ['--affected'] })[0]?.args).toContain('--affected')
  expect(() => suiteCommands('everything' as never)).toThrow('Unknown test slice')
})

test('a sharded run gives every shard the same arguments and its own slice', async () => {
  const { shardCommands } = await import('./test-shards.mjs')
  expect(shardCommands(3, ['--no-orphans', 'src']).map((command) => command.args)).toEqual([
    ['test', '--shard=1/3', '--no-orphans', 'src'],
    ['test', '--shard=2/3', '--no-orphans', 'src'],
    ['test', '--shard=3/3', '--no-orphans', 'src'],
  ])
  expect(() => shardCommands(0, [])).toThrow('Invalid shard count')
})
