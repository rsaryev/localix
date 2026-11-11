import { expect, test } from 'bun:test'
import { settingsEnvOf } from './env'
import { settingsFixture } from './testing/settings-fixture'

/** The `env` of a person's Claude Code settings, as the processes of a run there receive it. */
const read = settingsFixture('kit-settings-env-')

test('a higher file wins; values are strings', () => {
  const settings = read({
    user: { env: { API_BASE: 'https://user', RETRIES: 3 } },
    project: { env: { API_BASE: 'https://team' } },
    managed: { env: { HTTPS_PROXY: 'http://proxy:3128' } },
    trusted: true,
  })
  expect(settingsEnvOf(settings)).toEqual({
    API_BASE: 'https://team',
    RETRIES: '3',
    HTTPS_PROXY: 'http://proxy:3128',
  })
})
