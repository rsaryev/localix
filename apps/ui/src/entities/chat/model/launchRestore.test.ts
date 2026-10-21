import { describe, expect, test } from 'bun:test'

import { resolveLaunchRestore, type LaunchRestoreInput } from './launchRestore'

const input = (overrides: Partial<LaunchRestoreInput> = {}): LaunchRestoreInput => ({
  remembered: null,
  projects: [],
  projectsLoaded: true,
  sessions: [],
  waitExpired: false,
  ...overrides,
})

describe('launch restore — happy paths', () => {
  test('a remembered project scope reopens as the BARE scope', () => {
    expect(
      resolveLaunchRestore(
        input({
          remembered: { projectId: 'p1', sessionId: 's1' },
          projects: [{ id: 'p1' }],
          sessions: [{ id: 's1', projectId: 'p1' }],
        }),
      ),
    ).toEqual({ kind: 'restore', projectId: 'p1', sessionId: null })
  })

  test('a project whose remembered chat is gone still reopens the project', () => {
    // The chat is resolved off the LIVE roster by selectProject, so a deleted session
    // costs the open panel nothing — the workspace is still the right one to reopen.
    expect(
      resolveLaunchRestore(
        input({
          remembered: { projectId: 'p1', sessionId: 'deleted' },
          projects: [{ id: 'p1' }],
          sessions: [{ id: 's-other', projectId: 'p1' }],
        }),
      ),
    ).toEqual({ kind: 'restore', projectId: 'p1', sessionId: null })
  })

  test('the default project reopens like any other — there is no project-less scope', () => {
    expect(
      resolveLaunchRestore(
        input({
          remembered: { projectId: 'PRJ-default', sessionId: 'g1' },
          projects: [{ id: 'PRJ-default' }],
          sessions: [{ id: 'g1', projectId: 'PRJ-default' }],
        }),
      ),
    ).toEqual({ kind: 'restore', projectId: 'PRJ-default', sessionId: null })
  })
})

describe('launch restore — waiting for the projects roster', () => {
  // The regression this whole module exists for: `_hasHydrated` is flipped by the
  // pre-render shell frame, so the first decision pass sees an EMPTY projects array that is
  // not an answer. Judging it as "the project is gone" dropped every relaunch onto a fresh
  // Global chat.
  test('an unloaded roster waits instead of declaring the project gone', () => {
    expect(
      resolveLaunchRestore(
        input({
          remembered: { projectId: 'p1', sessionId: 's1' },
          projects: [],
          projectsLoaded: false,
        }),
      ),
    ).toEqual({ kind: 'wait' })
  })

  test('the roster landing turns the same wait into the restore', () => {
    const remembered = { projectId: 'p1', sessionId: 's1' }
    expect(resolveLaunchRestore(input({ remembered, projectsLoaded: false }))).toEqual({
      kind: 'wait',
    })
    expect(
      resolveLaunchRestore(input({ remembered, projects: [{ id: 'p1' }], projectsLoaded: true })),
    ).toEqual({ kind: 'restore', projectId: 'p1', sessionId: null })
  })

  test('a roster that never arrives degrades to home rather than hanging', () => {
    expect(
      resolveLaunchRestore(
        input({
          remembered: { projectId: 'p1', sessionId: 's1' },
          projectsLoaded: false,
          waitExpired: true,
        }),
      ),
      // Not forgotten: the project was never CONFIRMED missing, only unverifiable — and
      // kept, so the landing's own draft cannot overwrite it either.
    ).toEqual({ kind: 'home', forget: false, keep: true })
  })
})

describe('launch restore — fallbacks', () => {
  test('nothing remembered (first ever launch) lands on home', () => {
    expect(resolveLaunchRestore(input())).toEqual({ kind: 'home', forget: false, keep: false })
  })

  test('a project deleted between launches lands on home and drops the record', () => {
    expect(
      resolveLaunchRestore(
        input({
          remembered: { projectId: 'gone', sessionId: 's1' },
          projects: [{ id: 'p1' }],
          projectsLoaded: true,
        }),
      ),
    ).toEqual({ kind: 'home', forget: true, keep: false })
  })

  test('a scope with no remembered chat still reopens the project', () => {
    expect(
      resolveLaunchRestore(
        input({
          remembered: { projectId: 'p1', sessionId: null },
          projects: [{ id: 'p1' }],
        }),
      ),
    ).toEqual({ kind: 'restore', projectId: 'p1', sessionId: null })
  })
})
