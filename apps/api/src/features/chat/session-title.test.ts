import { expect, test } from 'bun:test'
import { compactSessionTitle, forkSessionTitle } from './session-title'

test('fork names use one unique suffix, including forks of old or numbered forks', () => {
  expect(forkSessionTitle('Greeting', 42)).toBe('Greeting (fork 42)')
  expect(forkSessionTitle('Greeting (fork) (fork)', 43)).toBe('Greeting (fork 43)')
  expect(forkSessionTitle('Greeting (fork 42)', 44)).toBe('Greeting (fork 44)')
  expect(forkSessionTitle('Discuss (fork) behavior', 45)).toBe('Discuss (fork) behavior (fork 45)')
  expect(forkSessionTitle(' ', 46)).toBe('New Chat (fork 46)')
})

test('legacy display cleanup preserves user text and already concise names', () => {
  expect(compactSessionTitle('Greeting (fork) (fork) (fork)', 17)).toBe('Greeting (fork 17)')
  expect(compactSessionTitle('Greeting (fork) (fork)')).toBe('Greeting (fork)')
  expect(compactSessionTitle('Greeting (fork 17)', 17)).toBe('Greeting (fork 17)')
  expect(compactSessionTitle('Discuss (fork) behavior', 17)).toBe('Discuss (fork) behavior')
  expect(compactSessionTitle('Greeting (fork)', 17)).toBe('Greeting (fork)')
})
