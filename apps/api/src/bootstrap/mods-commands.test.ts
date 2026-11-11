import { expect, test } from 'bun:test'
import { testSessionSkill } from '../features/plugins/kit/testing'
import { localixCommands } from './mods-commands'

test('$.command.list names Localix’s commands and the skills a person runs, by source', () => {
  expect(
    localixCommands({
      builtins: [
        { name: 'clear', description: 'Start over' },
        { name: 'secret', description: 'x', hidden: true },
      ],
      skills: [
        testSessionSkill('commit'),
        testSessionSkill('deploy', '', { plugin: 'vercel' }),
        // A skill shadowed by the command.
        testSessionSkill('clear'),
      ],
    }),
  ).toEqual([
    { name: 'clear', description: 'Start over', source: 'builtin' },
    { name: 'commit', description: 'About commit', source: 'user' },
    { name: 'vercel:deploy', description: 'About deploy', source: 'plugin', plugin: 'vercel' },
  ])
})
