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
