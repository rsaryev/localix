import { describe, expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'
import { getStateOf } from './getState'

const chess = (over: Parameters<typeof makeListing>[0]) => makeListing({ ...over })

describe('what the Get button shows', () => {
  test('Get before anything is installed', () => {
    expect(getStateOf(chess({ id: 'chess' }))).toEqual({ kind: 'get' })
  })

  test('how far a download is, and that it waits before it starts', () => {
    const downloading = chess({
      id: 'chess',
      job: { action: 'install', phase: 'downloading', received: 30, total: 120 },
    })
    expect(getStateOf(downloading)).toEqual({ kind: 'progress', percent: 25, label: 'Installing' })
    const queued = chess({ id: 'chess', job: { action: 'install', phase: 'queued' } })
    expect(getStateOf(queued)).toEqual({
      kind: 'progress',
      percent: null,
      label: 'Waiting to install',
    })
  })

  test('Retry after a failure, Update when offered, Open or Installed once here', () => {
    expect(
      getStateOf(chess({ id: 'chess', job: { action: 'install', phase: 'failed', error: 'x' } })),
    ).toEqual({ kind: 'retry' })
    const installed = { scope: 'user' as const, version: '1.0.0', enabled: true }
    expect(
      getStateOf(chess({ id: 'chess', installs: [{ ...installed, updateTo: '1.1.0' }] })),
    ).toEqual({ kind: 'update' })
    expect(getStateOf(chess({ id: 'chess', installs: [installed] }))).toEqual({ kind: 'installed' })
    expect(getStateOf(chess({ id: 'chess', installs: [installed] }), true)).toEqual({
      kind: 'open',
    })
  })
})
