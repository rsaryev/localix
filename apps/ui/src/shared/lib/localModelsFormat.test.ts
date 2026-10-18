import { describe, expect, test } from 'bun:test'
import { etaLabel, isActiveJob, jobLine, jobPercent, localModelState } from './localModelsFormat'

const job = (over: object = {}) => ({
  modelId: 'm',
  label: 'Model',
  background: false,
  phase: 'downloading' as const,
  received: 512 * 1024 * 1024,
  total: 2048 * 1024 * 1024,
  rate: 32 * 1024 * 1024,
  error: null,
  ...over,
})

describe('local model formatting', () => {
  test('percent and remaining time of a download', () => {
    expect(jobPercent(job())).toBe(25)
    expect(jobPercent(job({ total: 0 }))).toBeNull()
    expect(etaLabel(30, 1)).toBe('30 s left')
    expect(etaLabel(600, 1)).toBe('10 min left')
    expect(etaLabel(10, null)).toBeNull()
  })

  test('one line says what the download is doing', () => {
    expect(jobLine(job())).toBe('512 MB of 2.0 GB · 32.0 MB/s · 48 s left')
    expect(jobLine(job({ phase: 'failed', error: 'checksum mismatch' }))).toBe('checksum mismatch')
    expect(jobLine(job({ phase: 'verifying' }))).toBe('Verifying…')
  })

  test('only queued, downloading and verifying count as active', () => {
    expect(isActiveJob(job())).toBe(true)
    expect(isActiveJob(job({ phase: 'failed' }))).toBe(false)
    expect(isActiveJob(undefined)).toBe(false)
  })
})

describe('local model state', () => {
  const base = { installed: false, running: false, job: undefined, paused: undefined }
  test('a download in flight wins, then installed, then failed, paused, and available', () => {
    expect(localModelState({ ...base, job: job() })).toMatchObject({
      kind: 'downloading',
      percent: 25,
    })
    expect(localModelState({ ...base, installed: true, running: true })).toEqual({
      kind: 'installed',
      running: true,
    })
    expect(localModelState({ ...base, job: job({ phase: 'failed', error: 'offline' }) })).toEqual({
      kind: 'failed',
      error: 'offline',
    })
    expect(localModelState({ ...base, paused: { received: 1, total: 4 } })).toEqual({
      kind: 'paused',
      percent: 25,
    })
    expect(localModelState(base)).toEqual({ kind: 'available' })
  })
})
