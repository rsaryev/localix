import { expect, test } from 'bun:test'
import { judgeJoin } from './joining'

test('plugin.register’s core admits the plugin as { allow: true }, as Claude Code’s does', async () => {
  let core: ((event: unknown) => unknown) | undefined
  const refusal = await judgeJoin(
    async (_event, _input, run) => {
      core = run
      return run({})
    },
    { userId: '', cwd: '/p' },
    new Set(['judge~1']),
    { plugin: 'lab', root: '/r', events: ['turn.start'] },
  )
  expect(refusal).toBeUndefined()
  expect(core!({})).toEqual({ allow: true })
})
