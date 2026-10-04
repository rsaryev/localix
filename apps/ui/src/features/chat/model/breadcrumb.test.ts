import { describe, it, expect } from 'bun:test'
import { buildBreadcrumb, forkSiblings, type BreadcrumbSegment } from './breadcrumb'
import type { UiSession } from '@/shared/api/contracts'

// Minimal UiSession factory — only the fields the breadcrumb reads matter.
function session(partial: Partial<UiSession> & { id: string }): UiSession {
  return {
    title: partial.title ?? partial.id,
    sessionKind: 'chat',
    parentSessionId: null,
    projectId: null,
    createdAt: 0,
    ...partial,
  } as UiSession
}

const projects = [{ id: 'p1', name: 'MyProject' }]

describe('buildBreadcrumb', () => {
  it('Global scope with no active session ⇒ just the scope segment', () => {
    const segs = buildBreadcrumb({
      activeSession: null,
      allSessions: [],
      projects,
      activeProjectId: null,
    })
    expect(segs).toHaveLength(1)
    expect(segs[0]).toEqual({ kind: 'scope', projectId: null, label: 'Global' })
  })

  it('project scope resolves the project name for the scope segment', () => {
    const root = session({ id: 's1', projectId: 'p1' })
    const segs = buildBreadcrumb({
      activeSession: root,
      allSessions: [root],
      projects,
      activeProjectId: 'p1',
    })
    expect(segs[0]).toEqual({ kind: 'scope', projectId: 'p1', label: 'MyProject' })
  })

  it('root chat ⇒ scope › session, no sub-session segments', () => {
    const root = session({ id: 's1', title: 'Fix auth' })
    const segs = buildBreadcrumb({
      activeSession: root,
      allSessions: [root],
      projects,
      activeProjectId: null,
    })
    expect(segs.map((s) => s.kind)).toEqual(['scope', 'session'])
    const sess = segs[1] as Extract<BreadcrumbSegment, { kind: 'session' }>
    expect(sess.session.id).toBe('s1')
  })

  it('sub-session ⇒ scope › session › subsession, last is current with no activeChild', () => {
    const root = session({ id: 's1', title: 'Fix auth' })
    const worker = session({ id: 's2', title: 'worker: tests', parentSessionId: 's1' })
    const segs = buildBreadcrumb({
      activeSession: worker,
      allSessions: [root, worker],
      projects,
      activeProjectId: null,
    })
    expect(segs.map((s) => s.kind)).toEqual(['scope', 'session', 'subsession'])
    const sub = segs[2] as Extract<BreadcrumbSegment, { kind: 'subsession' }>
    expect(sub.session.id).toBe('s2')
    expect(sub.isCurrent).toBe(true)
    expect(sub.activeChildId).toBeNull()
  })

  it('deep chain marks each ancestor subsession with its on-path activeChildId', () => {
    const root = session({ id: 's1' })
    const a = session({ id: 's2', parentSessionId: 's1' })
    const b = session({ id: 's3', parentSessionId: 's2' })
    const segs = buildBreadcrumb({
      activeSession: b,
      allSessions: [root, a, b],
      projects,
      activeProjectId: null,
    })
    const subs = segs.filter(
      (s): s is Extract<BreadcrumbSegment, { kind: 'subsession' }> => s.kind === 'subsession',
    )
    expect(subs).toHaveLength(2)
    expect(subs[0]).toMatchObject({ isCurrent: false, activeChildId: 's3' })
    expect(subs[1]).toMatchObject({ isCurrent: true, activeChildId: null })
  })
})

describe('forkSiblings', () => {
  it('returns chat children of a parent, oldest-first, excluding sub-agents/jobs', () => {
    const root = session({ id: 's1' })
    const forkB = session({ id: 's3', parentSessionId: 's1', createdAt: 20 })
    const forkA = session({ id: 's2', parentSessionId: 's1', createdAt: 10 })
    const worker = session({
      id: 's4',
      parentSessionId: 's1',
      sessionKind: 'subagent',
      createdAt: 5,
    })
    const siblings = forkSiblings([root, forkB, forkA, worker], 's1')
    expect(siblings.map((s) => s.id)).toEqual(['s2', 's3'])
  })
})
