import { describe, expect, test } from 'bun:test'

import { describeStartedTask } from './task-delegation'

const child = { label: 'fork of @qa (id: c1)', title: 'Check login', sessionId: 'c1' }

describe('what became of a started fork', () => {
  test('a fork still running after the settle window reads as started, with its source', () => {
    const line = describeStartedTask(undefined, child)
    expect(line.failed).toBe(false)
    expect(line.line).toContain('started "Check login"')
    expect(line.details).toEqual({ sessionId: 'c1', title: 'Check login', status: 'running' })
    expect(line.sources?.length).toBe(1)
  })

  test('a fork over the concurrency cap is QUEUED, not refused', () => {
    const line = describeStartedTask({ queued: 2 }, child)
    expect(line.failed).toBe(false)
    expect(line.line).toContain('position 2')
    expect(line.details?.status).toBe('idle')
  })

  test('a fork that dies during startup is reported as failed', () => {
    const line = describeStartedTask({ status: 'failed', hasReport: false }, child)
    expect(line.failed).toBe(true)
    expect(line.details?.status).toBe('failed')
    const stopped = describeStartedTask({ status: 'stopped', hasReport: false }, child)
    expect(stopped.details?.status).toBe('stopped')
  })

  test('a fork that completes inside the window points at its report', () => {
    const line = describeStartedTask({ status: 'completed', hasReport: true }, child)
    expect(line.failed).toBe(false)
    expect(line.line).toContain('Review its report')
  })
})

test('a fork stopped at its turn limit reads as partial output, not as failed', () => {
  const line = describeStartedTask({ status: 'completed', hasReport: false, partial: true }, child)
  expect(line.failed).toBe(false)
  expect(line.details?.status).toBe('completed')
  expect(line.line).toContain('reached its turn limit')
  expect(line.line).toContain('partial')
})
