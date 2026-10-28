import { expect, test } from 'bun:test'
import { namedEventInput } from './op-events'

test('a prompt a mod submits carries its plugin as the origin, not the instance it runs as', () => {
  expect(namedEventInput('prompt.submit', ['Go on.'], 'lab~3f9a1c2b7d')).toEqual({
    text: 'Go on.',
    wait: false,
    origin: { kind: 'plugin', name: 'lab' },
  })
})
