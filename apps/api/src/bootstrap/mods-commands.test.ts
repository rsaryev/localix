import { expect, test } from 'bun:test'
import { localixCommands } from './mods-commands'

test('$.command.list names Localix’s commands and the skills a person runs, by source', () => {
  expect(
    localixCommands({
      builtins: [
        { name: 'clear', description: 'Start over' },
        { name: 'secret', description: 'x', hidden: true },
      ],
      skills: [
        { name: 'commit', description: 'Commit the work' },
        { name: 'deploy', description: 'Ship it', pluginName: 'vercel' },
        { name: 'clear', description: 'A skill shadowed by the command' },
      ],
    }),
  ).toEqual([
    { name: 'clear', description: 'Start over', source: 'builtin' },
    { name: 'commit', description: 'Commit the work', source: 'user' },
    { name: 'vercel:deploy', description: 'Ship it', source: 'plugin', plugin: 'vercel' },
  ])
})
