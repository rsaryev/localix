import { describe, expect, test } from 'bun:test'

import { runtimeLogFile } from './lib/runtime-log-destination'

describe('runtimeLogFile', () => {
  test('keeps embedded API diagnostics beside a custom database', () => {
    expect(runtimeLogFile({ LOCALIX_DB_FILE: '/tmp/localix/custom.db' })).toBe(
      '/tmp/localix/logs/api.log',
    )
  })

  test('honors the one explicit daemon-log override', () => {
    expect(
      runtimeLogFile({
        LOCALIX_DB_FILE: '/tmp/localix/custom.db',
        LOCALIX_DAEMON_LOG: ' /var/log/localix-api.log ',
      }),
    ).toBe('/var/log/localix-api.log')
  })
})
