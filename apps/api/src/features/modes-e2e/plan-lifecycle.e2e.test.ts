import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { builtinAgentPreset } from '../capabilities/builtin-agent-presets'
import { approvedPlanForRun } from '../chat/runtime/plan-view'
import { planCommentScope } from '../comments/contracts'
import { WORKSPACE } from './core-call-cases'
import { CHILD, createPlanLifecycle, ROOT, type PlanLifecycle } from './plan-lifecycle-test-harness'
import { modeSurface, runRegistry } from './run-surface'

/**
 * A PLAN FROM PLAN MODE TO DONE, through every seam the server wires (`plan-lifecycle-harness.ts`).
 *
 * At each step three surfaces must agree, and the test reads all three: the conversation (the
 * notice lines, in order, with the mode line before the plan line it causes), the person's
 * attention set (what is waiting on them right now), and the Event Center journal (the row each
 * attention item mirrors, and how it settled). A plan step that moved one of them and not the
 * others is the class of bug this exists to catch — the attention item left open after an
 * approval, the version auto-dismissed by the mode switch its own approval made.
 */
let life: PlanLifecycle
beforeEach(async () => {
  life = await createPlanLifecycle()
})
afterEach(() => life.dispose())

const draft = (n: number) => ({ title: `Cache v${n}`, body: `## Goal\nStep ${n}` })
const row = async (key: string) => {
  const entry = (await life.journal()).get(key)
  return entry && { state: entry.state, reason: entry.settleReason ?? null, title: entry.title }
}

describe('the happy path', () => {
  test('plan → present → review → revise → approve with bypass → complete', async () => {
    // 1. The person enters plan mode: one mode line, and the whole tree follows.
    await life.setMode('plan')
    expect(life.drain()).toEqual([`notice@${ROOT} permission_mode_change`, 'mode default->plan'])
    expect([await life.modeOf(ROOT), await life.modeOf(CHILD)]).toEqual(['plan', 'plan'])

    // 2. The agent presents v1: one line, one attention item, one open journal row.
    const v1 = await life.plans.present(life.owner, 'agent-lead', draft(1))
    expect(life.drain()).toEqual([`notice@${ROOT} plan_presented`])
    expect(life.attention()).toEqual(['plan Plan v1: Cache v1'])
    expect(await row(`plan:${ROOT}:${v1.id}`)).toEqual({
      state: 'open',
      reason: null,
      title: '@lead presented a plan',
    })

    // 3. Two comments and a note go back: the agent is woken, THEN the line; nothing waits on the
    //    person any more, and the version is still the one under revision.
    await life.comment(planCommentScope(v1.id), 'cache keys?')
    await life.comment(planCommentScope(v1.id), 'eviction?')
    const review = await life.plans.requestChanges(life.owner, v1.id, 'tighten it')
    expect(review).toMatchObject({ wake: 'delivered', comments: 2 })
    expect(life.drain()).toEqual(['wake plan-review', `notice@${ROOT} plan_changes_requested`])
    expect(life.wakes.at(-1)).toMatchObject({ source: 'plan-review', sessionId: ROOT })
    expect(life.attention()).toEqual([])
    expect(await row(`plan:${ROOT}:${v1.id}`)).toMatchObject({
      state: 'settled',
      reason: 'answered',
    })

    // 4. v2 supersedes v1. v1's journal row keeps the reason it settled with — "answered", not
    //    rewritten to "superseded" by the prefix settle v2's raise sends.
    const v2 = await life.plans.present(life.owner, 'agent-lead', draft(2))
    expect(life.drain()).toEqual([`notice@${ROOT} plan_presented`])
    expect((await life.plans.list(life.owner)).map((p) => [p.version, p.status])).toEqual([
      [2, 'presented'],
      [1, 'superseded'],
    ])
    expect(life.attention()).toEqual(['plan Plan v2: Cache v2'])
    expect(await row(`plan:${ROOT}:${v1.id}`)).toMatchObject({ reason: 'answered' })
    expect(await row(`plan:${ROOT}:${v2.id}`)).toMatchObject({ state: 'open' })

    // 5. Approve in bypass: the mode moves (tree included) BEFORE the approval line and the wake,
    //    and the mode hook finds nothing presented — the version being approved is not set aside.
    const decision = await life.plans.approve(life.owner, v2.id, 'bypass')
    expect(decision).toMatchObject({ wake: 'delivered', plan: { status: 'approved' } })
    expect(life.drain()).toEqual([
      `notice@${ROOT} permission_mode_change`,
      'mode plan->bypass',
      `notice@${ROOT} plan_approved`,
      'wake plan-approved',
    ])
    expect([await life.modeOf(ROOT), await life.modeOf(CHILD)]).toEqual(['bypass', 'bypass'])
    expect(life.attention()).toEqual([])
    expect(await row(`plan:${ROOT}:${v2.id}`)).toMatchObject({
      state: 'settled',
      reason: 'answered',
    })
    expect(
      await approvedPlanForRun(life.plans, life.owner.userId, await life.session(ROOT)),
    ).toEqual({
      version: 2,
      title: 'Cache v2',
      body: '## Goal\nStep 2',
      path: `${life.planFiles.dir}/v2.md`,
    })
    // The snapshot the prompt names holds the approved text.
    expect(life.planFiles.disk.get(`${life.planFiles.dir}/v2.md`)).toBe('## Goal\nStep 2\n')
    // A delegated child never carries the root's approved plan in its prompt.
    expect(await approvedPlanForRun(life.plans, life.owner.userId, await life.session(CHILD))).toBe(
      undefined,
    )

    // 6. The implementing agent completes it: one line, an informational journal row, and the
    //    approved-plan prompt section is gone for every later run.
    const done = await life.plans.complete(life.owner, 'Shipped the cache\nand its docs')
    expect(done).toMatchObject({
      status: 'completed',
      completionSummary: 'Shipped the cache\nand its docs',
    })
    expect(life.drain()).toEqual([`notice@${ROOT} plan_completed`])
    expect(await row(`plan-completed:${ROOT}:${v2.id}`)).toEqual({
      state: 'open',
      reason: null,
      title: 'Plan v2 completed',
    })
    expect(await approvedPlanForRun(life.plans, life.owner.userId, await life.session(ROOT))).toBe(
      undefined,
    )

    // The conversation, read back from storage: one line per step, in the order they happened.
    expect(await life.noticeKinds()).toEqual([
      'permission_mode_change',
      'plan_presented',
      'plan_changes_requested',
      'plan_presented',
      'permission_mode_change',
      'plan_approved',
      'plan_completed',
    ])
    expect(life.wakes.map((wake) => wake.source)).toEqual(['plan-review', 'plan-approved'])
  })
})

describe('who an approval reaches — the conversation’s addressing, not a plan rule', () => {
  const approveWith = async (target: PlanLifecycle, to?: string) => {
    await target.setMode('plan')
    const v1 = await target.plans.present(target.owner, 'agent-lead', draft(1))
    await target.plans.approve(target.owner, v1.id, 'default', to)
    const wake = target.wakes.at(-1)!
    return { wake, reached: await target.addressees(wake), lines: await target.noticeLines() }
  }

  test('a one-agent chat: that agent is reached, and the line names only the mode', async () => {
    for (const to of [undefined, 'localix']) {
      const solo = await createPlanLifecycle()
      try {
        const { wake, reached, lines } = await approveWith(solo, to)
        expect(wake.to).toBeUndefined()
        expect(reached).toEqual(['localix'])
        expect(lines.at(-1)).toBe('plan_approved: Plan v1 approved — Default mode.')
      } finally {
        await solo.dispose()
      }
    }
  })

  describe('a room of three', () => {
    let room: PlanLifecycle
    beforeEach(async () => {
      room = await createPlanLifecycle(['lead', 'backend', 'qa'])
    })
    afterEach(() => room.dispose())

    test('no addressee: the strategy’s default answerer (the fresh room’s lead)', async () => {
      const { reached, lines } = await approveWith(room)
      expect(reached).toEqual(['lead'])
      expect(lines.at(-1)).toBe('plan_approved: Plan v1 approved — Default mode.')
    })

    test('to @backend reaches @backend, and the line says who starts', async () => {
      const { wake, reached, lines } = await approveWith(room, 'backend')
      expect(reached).toEqual(['backend'])
      expect(wake.to).toBeUndefined()
      expect(lines.at(-1)).toBe('plan_approved: Plan v1 approved — Default mode. backend starts.')
    })

    test('to all reaches every participant, as @all does for a message', async () => {
      const { reached, lines } = await approveWith(room, 'all')
      expect(reached).toEqual(['lead', 'backend', 'qa'])
      expect(lines.at(-1)).toBe('plan_approved: Plan v1 approved — Default mode. Everyone starts.')
    })

    test('a handle not in the room is refused before anything is decided', async () => {
      await room.setMode('plan')
      const v1 = await room.plans.present(room.owner, 'agent-lead', draft(1))
      await expect(room.plans.approve(room.owner, v1.id, 'bypass', 'ghost')).rejects.toMatchObject({
        status: 400,
      })
      expect(await room.modeOf(ROOT)).toBe('plan')
      expect(room.wakes.map((wake) => wake.source)).toEqual([])
    })
  })
})

describe('setting a plan aside', () => {
  test('leaving plan mode while a version waits dismisses it, after the mode line', async () => {
    await life.setMode('plan')
    const v1 = await life.plans.present(life.owner, 'agent-lead', draft(1))
    life.drain()
    await life.setMode('default')
    expect(life.drain()).toEqual([
      `notice@${ROOT} permission_mode_change`,
      'mode plan->default',
      `notice@${ROOT} plan_dismissed`,
    ])
    expect((await life.plans.list(life.owner))[0]?.status).toBe('dismissed')
    expect(life.attention()).toEqual([])
    expect(await row(`plan:${ROOT}:${v1.id}`)).toMatchObject({
      state: 'settled',
      reason: 'dismissed',
    })
    expect(life.wakes).toEqual([])
  })

  test('the person dismisses a presented version: one line, no wake, the mode untouched', async () => {
    await life.setMode('plan')
    const v1 = await life.plans.present(life.owner, 'agent-lead', draft(1))
    life.drain()
    await life.plans.dismiss(life.owner, v1.id)
    expect(life.drain()).toEqual([`notice@${ROOT} plan_dismissed`])
    expect(await life.modeOf(ROOT)).toBe('plan')
    expect(life.attention()).toEqual([])
    expect(await row(`plan:${ROOT}:${v1.id}`)).toMatchObject({ reason: 'dismissed' })
  })
})

describe('the plan as a file, through a mode round-trip', () => {
  test('v1, v2, leave Plan → v2 set aside; return → v2 back with Approve, and no v3', async () => {
    await life.setMode('plan')
    life.planFiles.writeDraft('# Cache layer\n\n## Goal\nStep 1')
    const v1 = await life.service.present(life.owner, 'agent-lead', {})
    expect(v1).toMatchObject({ outcome: 'presented', plan: { version: 1, title: 'Cache layer' } })
    life.planFiles.writeDraft('# Cache layer\n\n## Goal\nStep 1\nStep 2')
    const v2 = await life.service.present(life.owner, 'agent-lead', {})
    expect(v2).toMatchObject({ outcome: 'presented', plan: { version: 2 } })
    life.drain()

    // Leaving Plan mode sets v2 aside — on the mode's behalf, not the person's.
    await life.setMode('default')
    expect((await life.plans.list(life.owner))[0]).toMatchObject({
      version: 2,
      status: 'dismissed',
      dismissedBy: 'mode',
    })
    expect(life.attention()).toEqual([])
    life.drain()

    // Returning brings v2 back under its own number: one line, the item waiting again.
    await life.setMode('plan')
    expect(life.drain()).toEqual([
      `notice@${ROOT} permission_mode_change`,
      'mode default->plan',
      `notice@${ROOT} plan_presented`,
    ])
    expect((await life.plans.list(life.owner)).map((p) => [p.version, p.status])).toEqual([
      [2, 'presented'],
      [1, 'superseded'],
    ])
    expect(life.attention()).toEqual(['plan Plan v2: Cache layer'])

    // The agent presenting the unchanged file again stores nothing new.
    const again = await life.service.present(life.owner, 'agent-lead', {})
    expect(again).toMatchObject({ outcome: 'unchanged', plan: { version: 2 } })
    expect(await life.plans.list(life.owner)).toHaveLength(2)

    // And v2 is approvable, as it was before the round-trip.
    const decision = await life.plans.approve(life.owner, v2.plan.id, 'default')
    expect(decision.plan).toMatchObject({ version: 2, status: 'approved' })
    expect(life.wakes.map((wake) => wake.source)).toEqual(['plan-approved'])
  })

  test("the person's own dismissal is not undone by a mode round-trip", async () => {
    await life.setMode('plan')
    const v1 = await life.plans.present(life.owner, 'agent-lead', draft(1))
    await life.plans.dismiss(life.owner, v1.id)
    await life.setMode('default')
    await life.setMode('plan')
    expect((await life.plans.list(life.owner))[0]).toMatchObject({
      status: 'dismissed',
      dismissedBy: 'person',
    })
    expect(life.attention()).toEqual([])
  })
})

describe('a delegated child in a plan conversation', () => {
  test('is born in plan mode, cannot leave it alone, and cannot present', async () => {
    await life.setMode('plan')
    const born = await life.delegate()
    expect(await life.modeOf(born)).toBe('plan')
    // The mode is the root's: a child's own patch is refused before anything is written.
    await expect(life.patchMode(born, 'bypass')).rejects.toMatchObject({
      code: 'permission_mode_owned_by_root',
    })
    expect(await life.modeOf(born)).toBe('plan')

    // Its run shape never carries `plan` — exposure, not the mode, is what keeps it from
    // presenting — and the mode's rules refuse its writes like the root's.
    const kind = (await life.session(born)).sessionKind
    expect(kind).toBe('subagent')
    const registry = runRegistry(kind, 'plan', [])
    expect(registry.toolNames).not.toContain('plan')
    const write = registry.tools.find((tool) => tool.name === 'write')!
    const surface = modeSurface(builtinAgentPreset('localix'), 'plan', [])
    expect(await surface.decide(write, { path: `${WORKSPACE}/a.ts`, content: 'x' })).toBe('deny')
  })
})
