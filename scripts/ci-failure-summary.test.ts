import { describe, expect, test } from 'bun:test'

import { collectFailures, renderSummary } from './ci-failure-summary.mjs'

const log = [
  '2026-10-21T19:32:11.5576286Z @localixai/api:test: (fail) router > a stop lands mid-start [11.84ms]',
  '\u001b[31m(fail) test tiers > every workspace lists the preload [1.52ms]\u001b[0m',
  '@localixai/api:test: (fail) router > a stop lands mid-start [11.84ms]',
  '(pass) router > something else [0.1ms]',
  '##[error]src/db/migrator.ts(78,34): error TS2345: Argument of type is not assignable.',
  'Failed:    @localixai/api#test',
].join('\n')

describe('CI failure summary', () => {
  test('pulls failing tests, type errors and tasks out of a check log, once each', () => {
    expect(collectFailures(log)).toEqual({
      tests: [
        '@localixai/api: router > a stop lands mid-start',
        'test tiers > every workspace lists the preload',
      ],
      types: ['src/db/migrator.ts(78,34): error TS2345: Argument of type is not assignable.'],
      tasks: ['@localixai/api#test'],
    })
  })

  test('renders a section per kind and says so when the log names nothing', () => {
    const summary = renderSummary('App (unit tests)', collectFailures(log))
    expect(summary).toContain('### App (unit tests) failed')
    expect(summary).toContain('#### Failing tests (2)')
    expect(summary).toContain('- `@localixai/api#test`')
    expect(renderSummary('App (types)', collectFailures(''))).toContain('open the step output')
  })
})
