import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import type { SessionPlan } from '@localixai/api/client'
import { backendClient } from '@/shared/api/client'
import type { UiSession } from '@/shared/api/contracts'
import type { PlanDraftInfo } from '@/shared/api/plans-client'
import { inspector } from '@/shared/lib/inspectorBus'

import { buildPlanDiff } from '../ui/plan/planDiff'
import {
  applyPlanList,
  ensurePlansLoaded,
  latestPresentedPlan,
  presentedPlan,
  previousVersion,
  refreshPlanDraft,
  registerPlanTabHost,
  reopenablePlan,
  routePlanPresented,
  usePlanDraftStore,
} from './plans'
import { useChatStore } from './store'

const plan = (id: string, version: number, status: SessionPlan['status']): SessionPlan => ({
  id,
  sessionId: 'root',
  version,
  status,
  title: `Plan ${version}`,
  body: `Body ${version}`,
  authorAgentId: 'lead',
  approvedMode: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: null,
  completedAt: null,
  completionSummary: null,
  filePath: `/work/.localix/plans/ROOT/v${version}.md`,
  dismissedBy: null,
})

const v1 = plan('p1', 1, 'presented')
const v1superseded = plan('p1', 1, 'superseded')
const v2 = plan('p2', 2, 'presented')

describe('opening the plan tab by itself — only on the `plan.presented` cue', () => {
  const opened: Array<{ id: string; scope?: string; payload?: unknown }> = []
  const spy = spyOn(inspector, 'openWorkItem').mockImplementation((item) => {
    opened.push(item as never)
  })
  const withdraw: Array<() => void> = []
  afterEach(() => {
    opened.length = 0
    for (const off of withdraw.splice(0)) off()
  })
  afterAll(() => spy.mockRestore())
  const host = (sessionId: string, ownerId: string, focused: boolean) =>
    withdraw.push(registerPlanTabHost({ sessionId, ownerId, focused }))

  test('opens in the focused composer, else the root one — once per version', () => {
    host('root-a', 'root-a', false)
    host('child-a', 'root-a', true)
    routePlanPresented({ sessionId: 'root-a', planId: 'cue-1' })
    expect(opened.map((item) => [item.scope, (item.payload as { planId: string }).planId])).toEqual(
      [['child-a', 'cue-1']],
    )
    // The same version cued again (a restore, a second socket): the person may have closed it.
    routePlanPresented({ sessionId: 'root-a', planId: 'cue-1' })
    expect(opened).toHaveLength(1)
  })

  test('without a focused composer, the conversation’s own one opens it', () => {
    host('child-b', 'root-b', false)
    host('root-b', 'root-b', false)
    routePlanPresented({ sessionId: 'root-b', planId: 'cue-2' })
    expect(opened.map((item) => item.scope)).toEqual(['root-b'])
  })

  test('loading a conversation whose version waits opens nothing — no cue, no tab', () => {
    // The old rule opened a presented version younger than two minutes on first sight, so a
    // reload stole the tab. Now a list landing (detail, frame, fetch) never opens anything.
    host('root-c', 'root-c', true)
    useChatStore.setState({
      allSessions: [{ id: 'root-c', agents: [], rootSessionId: null } as unknown as UiSession],
    })
    applyPlanList('root-c', [plan('fresh', 1, 'presented')])
    expect(opened).toEqual([])
    // A cue for another conversation, or with no composer of it mounted, opens nothing either.
    routePlanPresented({ sessionId: 'elsewhere', planId: 'cue-3' })
    expect(opened).toEqual([])
  })
})

describe('reading the versions', () => {
  test('the presented version and the one before a given version', () => {
    const plans = [v2, v1superseded]
    expect(presentedPlan(plans)).toBe(v2)
    expect(previousVersion(plans, v2)).toBe(v1superseded)
    expect(previousVersion(plans, v1superseded)).toBeUndefined()
  })

  test('changes are offered only when there is an earlier, different version', () => {
    expect(buildPlanDiff(undefined, v2)).toBeNull()
    expect(buildPlanDiff({ version: 1, body: 'Same\n' }, { version: 2, body: 'Same' })).toBeNull()
    const diff = buildPlanDiff({ version: 1, body: 'Step one' }, { version: 2, body: 'Step two' })
    expect(diff?.files.length).toBe(1)
  })

  test('only the NEWEST version is asked about on leaving Plan mode, or offered back', () => {
    const dismissed = plan('p2', 2, 'dismissed')
    expect(latestPresentedPlan([v2, v1superseded])).toBe(v2)
    expect(latestPresentedPlan([dismissed, v1])).toBeUndefined()
    expect(reopenablePlan([dismissed, v1superseded])).toBe(dismissed)
    // Something newer exists: the set-aside version is history.
    expect(reopenablePlan([plan('p3', 3, 'superseded'), dismissed])).toBeUndefined()
    expect(reopenablePlan([])).toBeUndefined()
  })
})

describe('the draft file, kept beside the versions', () => {
  const target = backendClient as unknown as Record<string, unknown>
  const original = target.listPlans
  afterEach(() => {
    target.listPlans = original
  })

  const draft = (changed: boolean): PlanDraftInfo => ({
    path: '/work/.localix/plans/ROOT/PLAN.md',
    exists: true,
    changed,
  })
  const withSession = (id: string, plans?: SessionPlan[]) =>
    useChatStore.setState({
      allSessions: [{ id, agents: [], rootSessionId: null, plans } as unknown as UiSession],
    })

  test('the first load stores the draft along with the versions', async () => {
    withSession('d1')
    target.listPlans = mock(async () => ({ plans: [v2], draft: draft(true) }))
    await ensurePlansLoaded('d1')
    expect(usePlanDraftStore.getState().byOwner.d1).toEqual(draft(true))
  })

  test('a refresh takes only the draft — the pushed versions are newer than any fetch', async () => {
    // The versions arrive live through `plan.updated`; a fetched list landing here would
    // overwrite one pushed while the request was in flight.
    withSession('d2', [v2])
    target.listPlans = mock(async () => ({ plans: [v1], draft: draft(false) }))
    await refreshPlanDraft('d2')
    expect(usePlanDraftStore.getState().byOwner.d2).toEqual(draft(false))
    const session = useChatStore.getState().allSessions.find((s) => s.id === 'd2')
    expect(session?.plans).toEqual([v2])
  })

  test('a failed refresh keeps the last answer and says nothing', async () => {
    withSession('d3', [v2])
    target.listPlans = mock(async () => ({ plans: [v2], draft: draft(true) }))
    await refreshPlanDraft('d3')
    target.listPlans = mock(async () => {
      throw new Error('offline')
    })
    await refreshPlanDraft('d3')
    expect(usePlanDraftStore.getState().byOwner.d3).toEqual(draft(true))
  })
})
