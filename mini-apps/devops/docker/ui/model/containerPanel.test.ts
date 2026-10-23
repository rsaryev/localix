import { expect, test } from 'bun:test'
import {
  containerPollNeeded,
  dockerContainerSection,
  normalizeDockerContainerPanel,
  sameContainer,
} from './containerPanel'

test('without the events stream every container tab keeps its three-second tick', () => {
  for (const state of ['running', 'exited', null]) {
    expect(containerPollNeeded({ live: false, panel: 'logs', logsLive: false, state })).toBe(true)
  }
})

test('while live, a tick that would only re-read the state is dropped', () => {
  // A stopped container: its logs do not grow, stats and processes are cleared; `start` re-reads.
  expect(containerPollNeeded({ live: true, panel: 'stats', logsLive: true, state: 'exited' })).toBe(
    false,
  )
  // A paused log view reads nothing but the state.
  expect(
    containerPollNeeded({ live: true, panel: 'logs', logsLive: false, state: 'running' }),
  ).toBe(false)
})

test('while live, sampled data and an unknown container keep the tick', () => {
  expect(containerPollNeeded({ live: true, panel: 'logs', logsLive: true, state: 'running' })).toBe(
    true,
  )
  expect(
    containerPollNeeded({ live: true, panel: 'top', logsLive: true, state: 'restarting' }),
  ).toBe(true)
  expect(containerPollNeeded({ live: true, panel: 'stats', logsLive: true, state: null })).toBe(
    true,
  )
})

test('a followed log tail is read when it grows, not on the tick', () => {
  expect(
    containerPollNeeded({
      live: true,
      panel: 'logs',
      logsLive: true,
      state: 'running',
      logsFollowed: true,
    }),
  ).toBe(false)
  // Stats are a gauge: following the log does not announce them.
  expect(
    containerPollNeeded({
      live: true,
      panel: 'stats',
      logsLive: true,
      state: 'running',
      logsFollowed: true,
    }),
  ).toBe(true)
})

test('an event names the tab’s container in either id form', () => {
  expect(sameContainer('abcdef123456', 'abcdef')).toBe(true)
  expect(sameContainer('abcdef', 'abcdef123456')).toBe(true)
  expect(sameContainer('other', 'abcdef')).toBe(false)
  expect(sameContainer('', 'abcdef')).toBe(false)
})

test('normalizes persisted Docker container panels without accepting future junk', () => {
  expect(normalizeDockerContainerPanel('logs')).toBe('logs')
  expect(normalizeDockerContainerPanel('stats')).toBe('stats')
  expect(normalizeDockerContainerPanel('top')).toBe('top')
  expect(normalizeDockerContainerPanel('inspect')).toBe('logs')
  expect(normalizeDockerContainerPanel(null)).toBe('logs')
})

test('maps the UI process panel to the canonical Docker resource section', () => {
  expect(dockerContainerSection('logs')).toBe('logs')
  expect(dockerContainerSection('stats')).toBe('stats')
  expect(dockerContainerSection('top')).toBe('processes')
})
