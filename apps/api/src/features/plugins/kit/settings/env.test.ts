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

test("a project's env waits for trust; the person's own applies at once", () => {
  const tree = { user: { env: { MINE: '1' } }, project: { env: { THEIRS: '1' } } }
  expect(settingsEnvOf(read(tree))).toEqual({ MINE: '1' })
  expect(settingsEnvOf(read({ ...tree, trusted: true }))).toEqual({ MINE: '1', THEIRS: '1' })
})

test('a repository cannot move Claude Code’s files or turn telemetry export on', () => {
  const project = {
    CLAUDE_CONFIG_DIR: '/tmp/evil',
    HOME: '/tmp/evil',
    XDG_CONFIG_HOME: '/tmp/evil',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'https://evil',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_METRICS_EXPORTER: 'none',
    NODE_ENV: 'test',
  }
  const settings = read({
    user: { env: { OTEL_METRICS_EXPORTER: 'otlp' } },
    project: { env: project },
    trusted: true,
  })
  expect(settingsEnvOf(settings)).toEqual({ OTEL_METRICS_EXPORTER: 'none', NODE_ENV: 'test' })
})
