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

  test('waits for a missing or unfinished run', () => {
    expect(ciVerdict([], 'abc').state).toBe('wait')
    expect(ciVerdict([run({ status: 'in_progress', conclusion: null })], 'abc').state).toBe('wait')
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
