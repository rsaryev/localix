import { describe, expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'
import { getStateOf } from './getState'

const puzzle = (over: Parameters<typeof makeListing>[0]) => makeListing({ ...over })

describe('what the Get button shows', () => {
  test('Get before anything is installed', () => {
    expect(getStateOf(puzzle({ id: 'puzzle' }))).toEqual({ kind: 'get' })
  })

  test('how far a download is, and that it waits before it starts', () => {
    const downloading = puzzle({
      id: 'puzzle',
      job: { action: 'install', phase: 'downloading', received: 30, total: 120 },
    })
    expect(getStateOf(downloading)).toEqual({ kind: 'progress', percent: 25, label: 'Installing' })
    const queued = puzzle({ id: 'puzzle', job: { action: 'install', phase: 'queued' } })
    expect(getStateOf(queued)).toEqual({
      kind: 'progress',
      percent: null,
      label: 'Waiting to install',
    })
  })

  test('Retry after a failure, Update when offered, Open or Installed once here', () => {
    expect(
      getStateOf(puzzle({ id: 'puzzle', job: { action: 'install', phase: 'failed', error: 'x' } })),
    ).toEqual({ kind: 'retry' })
    const installed = { scope: 'user' as const, version: '1.0.0', enabled: true }
    expect(
      getStateOf(puzzle({ id: 'puzzle', installs: [{ ...installed, updateTo: '1.1.0' }] })),
    ).toEqual({ kind: 'update' })
    expect(getStateOf(puzzle({ id: 'puzzle', installs: [installed] }))).toEqual({
      kind: 'installed',
    })
    expect(getStateOf(puzzle({ id: 'puzzle', installs: [installed] }), true)).toEqual({
      kind: 'open',
    })
  })

  // Turned off is not gone: the page says what pressing it would do.
  test('Enable while every install of it is turned off', () => {
    const off = { scope: 'user' as const, version: '1.0.0', enabled: false }
    expect(getStateOf(puzzle({ id: 'puzzle', installs: [off] }), true)).toEqual({ kind: 'enable' })
    const onInProject = { ...off, scope: 'project' as const, enabled: true }
    expect(getStateOf(puzzle({ id: 'puzzle', installs: [off, onInProject] }), true)).toEqual({
      kind: 'open',
    })
  })
})
