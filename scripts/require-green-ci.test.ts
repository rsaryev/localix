import { describe, expect, test } from 'bun:test'
import { ciVerdict } from './require-green-ci.mjs'

const run = (overrides: Record<string, unknown> = {}) => ({
  head_sha: 'abc',
  event: 'push',
  run_number: 1,
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://ci/1',
  ...overrides,
})

describe('ciVerdict', () => {
  test('passes a commit whose push run succeeded', () => {
    expect(ciVerdict([run()], 'abc').state).toBe('pass')
  })

  test('fails a red run and names it', () => {
    const verdict = ciVerdict([run({ conclusion: 'failure' })], 'abc')
    expect(verdict.state).toBe('fail')
    expect(verdict.message).toContain('https://ci/1')
  })

  test('fails a timed-out run, and a cancelled one once its replacement has been asked for', () => {
    expect(ciVerdict([run({ conclusion: 'timed_out' })], 'abc').state).toBe('fail')
    for (const conclusion of ['cancelled', 'skipped'])
      expect(ciVerdict([run({ conclusion })], 'abc', true).state).toBe('fail')
  })

  test('asks for a run of its own when main skipped the commit or superseded its run', () => {
    expect(ciVerdict([], 'abc').state).toBe('dispatch')
    for (const conclusion of ['cancelled', 'skipped'])
      expect(ciVerdict([run({ conclusion })], 'abc').state).toBe('dispatch')
  })

  test('waits for a dispatched run to appear and for an unfinished run', () => {
    expect(ciVerdict([], 'abc', true).state).toBe('wait')
    expect(ciVerdict([run({ status: 'in_progress', conclusion: null })], 'abc').state).toBe('wait')
  })

  test('accepts a manual run of the commit as well as a push run', () => {
    expect(ciVerdict([run({ event: 'workflow_dispatch' })], 'abc').state).toBe('pass')
  })

  test('judges the newest push run of that commit only', () => {
    const runs = [
      run({ run_number: 1, conclusion: 'failure' }),
      run({ run_number: 2 }),
      run({ run_number: 3, event: 'pull_request', conclusion: 'failure' }),
      run({ run_number: 4, head_sha: 'other', conclusion: 'failure' }),
    ]
    expect(ciVerdict(runs, 'abc').state).toBe('pass')
  })
})
