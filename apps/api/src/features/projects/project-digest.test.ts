import { describe, expect, test } from 'bun:test'

import {
  buildProjectDigest,
  PROJECT_DIGEST_MAX_SESSIONS,
  type ProjectDigestInput,
} from './project-digest'

const base: ProjectDigestInput = {
  id: 'p1',
  name: 'Localix',
  workingDir: '/Users/me/localix',
  sessionCount: 2,
  sessions: [
    { title: 'Fix the parser', runtimeStatus: 'idle', updatedAt: '2026-07-01T10:00:00.000Z' },
    { title: 'Add a feature', runtimeStatus: 'running', updatedAt: '2026-06-30T09:00:00.000Z' },
  ],
}

describe('buildProjectDigest', () => {
  test('renders name, working dir, and the session roster', () => {
    const out = buildProjectDigest(base)
    expect(out).toContain('Project "Localix"')
    expect(out).toContain('Working directory: /Users/me/localix')
    expect(out).toContain('2 chat sessions')
    expect(out).toContain('Fix the parser · idle · updated 2026-07-01')
    expect(out).toContain('Add a feature · running · updated 2026-06-30')
  })

  test('carries INTROSPECTION ONLY — the input has no field for a secret to leak', () => {
    // The builder can only render what the typed input carries: name, workingDir,
    // and session title/status/date. There is no creds/secret/remote-URL channel.
    const keys = Object.keys(base).sort()
    expect(keys).toEqual(['id', 'name', 'sessionCount', 'sessions', 'workingDir'])
    const out = buildProjectDigest(base)
    expect(out.toLowerCase()).not.toContain('password')
    expect(out.toLowerCase()).not.toContain('secret')
    expect(out).not.toContain('git@')
    expect(out).not.toContain('https://')
  })

  test('caps the roster and notes the overflow', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `s${i}`,
      runtimeStatus: 'idle',
      updatedAt: '2026-07-01T00:00:00.000Z',
    }))
    const out = buildProjectDigest({ ...base, sessionCount: 30, sessions: many })
    const rows = out.split('\n').filter((l) => l.startsWith('- '))
    expect(rows).toHaveLength(PROJECT_DIGEST_MAX_SESSIONS)
    expect(out).toContain(`of 30`)
  })

  test('an empty / no-session project still renders identity', () => {
    const out = buildProjectDigest({ ...base, sessionCount: 0, sessions: [] })
    expect(out).toContain('0 chat sessions')
    expect(out).not.toContain('Recent sessions')
  })
})
