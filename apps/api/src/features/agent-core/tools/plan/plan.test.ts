import { describe, expect, test } from 'bun:test'
import { classifyToolCall } from '@localixai/agent/agents'

import type {
  PlanOverview,
  PlanPresentation,
  PresentInput,
  SessionPlan,
} from '../../../plans/contracts'
import { createPlanTool, type PlanToolOptions } from './plan'

const DIR = '/w/.localix/plans/LOCALIX-1'

const plan = (overrides: Partial<SessionPlan> = {}): SessionPlan => ({
  id: 'plan-1',
  sessionId: 'root',
  version: 2,
  status: 'presented',
  title: 'Cache layer',
  body: '## Goal\nFast',
  approvedMode: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: null,
  completedAt: null,
  completionSummary: null,
  dismissedBy: null,
  filePath: `${DIR}/v2.md`,
  ...overrides,
})

function harness(
  state: {
    mode?: boolean
    plans?: SessionPlan[]
    draft?: Partial<PlanOverview['draft']>
    present?: (input: PresentInput) => Promise<PlanPresentation>
  } = {},
) {
  const inputs: PresentInput[] = []
  const summaries: string[] = []
  const options: PlanToolOptions = {
    inPlanMode: async () => state.mode ?? true,
    present: async (input) => {
      inputs.push(input)
      return state.present
        ? state.present(input)
        : { outcome: 'presented', plan: plan({ title: input.title ?? 'Cache layer' }) }
    },
    overview: async () => ({
      plans: state.plans ?? [],
      draft: { path: `${DIR}/PLAN.md`, exists: true, changed: false, ...state.draft },
    }),
    complete: async (summary) => {
      summaries.push(summary)
      return plan({ status: 'completed', completionSummary: summary })
    },
  }
  return { tool: createPlanTool(options), inputs, summaries }
}

describe('plan tool — classification', () => {
  test('present/complete are session state, read is a read, anything else fails closed', () => {
    const { tool } = harness()
    expect(classifyToolCall(tool, { action: 'present' })).toEqual({ effect: 'session' })
    expect(classifyToolCall(tool, { action: 'complete', summary: 'done' })).toEqual({
      effect: 'session',
    })
    expect(classifyToolCall(tool, { action: 'read' })).toEqual({ effect: 'read' })
    expect(classifyToolCall(tool, { action: 'toString' })).toEqual({ effect: 'external' })
    expect(classifyToolCall(tool, {})).toEqual({ effect: 'external' })
  })
})

describe('the schema', () => {
  test('an object root whose per-action fields are checked', () => {
    const { tool } = harness()
    const schema = tool.inputSchema
    expect(schema.safeParse({ action: 'present' }).success).toBe(true)
    expect(schema.safeParse({ action: 'present', title: 'x', body: '   ' }).success).toBe(false)
    expect(schema.safeParse({ action: 'present', body: 'y'.repeat(50_001) }).success).toBe(false)
    expect(schema.safeParse({ action: 'complete' }).success).toBe(false)
    expect(schema.safeParse({ action: 'read', body: 'x' }).success).toBe(false)
    expect(schema.safeParse({ action: 'present', summary: 'x' }).success).toBe(false)
    expect(schema.safeParse({ action: 'nope' }).success).toBe(false)
  })
})

describe('present', () => {
  test('presents the file without a body, and ENDS the turn', async () => {
    const { tool, inputs } = harness()
    const result = await tool.execute('c1', { action: 'present' })
    expect(inputs).toEqual([{}])
    expect(result.terminate).toBe(true)
    expect(result.content).toContain('v2 is with the user')
    expect(result.details).toMatchObject({ outcome: 'presented', plan: { version: 2 } })
  })

  test('passes a first-draft body and a title through to the host', async () => {
    const { tool, inputs } = harness()
    await tool.execute('c1', { action: 'present', title: 'Cache', body: '## Goal' })
    expect(inputs).toEqual([{ title: 'Cache', body: '## Goal' }])
  })

  test('a restored or unchanged version says so, and still ends the turn', async () => {
    for (const outcome of ['restored', 'unchanged'] as const) {
      const { tool } = harness({ present: async () => ({ outcome, plan: plan() }) })
      const result = await tool.execute('c1', { action: 'present' })
      expect(result.terminate).toBe(true)
      expect(result.content).toContain(outcome === 'restored' ? 'back with the user' : 'already')
    }
  })

  test("the host's refusal (no draft, already approved) is the tool's error", async () => {
    const { tool } = harness({
      present: async () => {
        throw new Error(`There is no plan to present: write it to ${DIR}/PLAN.md first.`)
      },
    })
    const result = await tool.execute('c1', { action: 'present' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain(`${DIR}/PLAN.md`)
  })

  test('outside plan mode it is a clear tool error and stores nothing', async () => {
    const { tool, inputs } = harness({ mode: false })
    const result = await tool.execute('c1', { action: 'present', title: 'x', body: 'y' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('not in Plan mode')
    expect(inputs).toEqual([])
  })
})

describe('read', () => {
  test('answers paths and states, not the whole body', async () => {
    const { tool } = harness({
      plans: [
        plan({ status: 'approved' }),
        plan({ version: 1, status: 'superseded', filePath: `${DIR}/v1.md` }),
      ],
      draft: { changed: true },
    })
    const result = await tool.execute('c1', { action: 'read' })
    expect(result.content).toContain(`Plan file: ${DIR}/PLAN.md (changed since v2`)
    expect(result.content).toContain(`In play: v2 (approved) — ${DIR}/v2.md`)
    expect(result.content).toContain(`- v1 superseded: Cache layer — ${DIR}/v1.md`)
    expect(result.content).not.toContain('Fast')
    expect(result.details?.plan?.status).toBe('approved')
    expect(result.terminate).toBeUndefined()
  })

  test('says so when nothing was presented and the file is unwritten', async () => {
    const { tool } = harness({ draft: { exists: false } })
    const result = await tool.execute('c1', { action: 'read' })
    expect(result.content).toContain('not written yet')
    expect(result.content).toContain('No version has been presented yet')
  })
})

describe('complete', () => {
  test('closes an approved plan with the summary and does not end the turn', async () => {
    const { tool, summaries } = harness({ mode: false, plans: [plan({ status: 'approved' })] })
    const result = await tool.execute('c1', { action: 'complete', summary: 'Shipped the cache' })
    expect(summaries).toEqual(['Shipped the cache'])
    expect(result.isError).toBeUndefined()
    expect(result.terminate).toBeUndefined()
    expect(result.details?.plan?.status).toBe('completed')
  })

  test('without an approved plan it is a tool error and completes nothing', async () => {
    for (const plans of [[], [plan({ status: 'presented' })]]) {
      const { tool, summaries } = harness({ plans })
      const result = await tool.execute('c1', { action: 'complete', summary: 'done' })
      expect(result.isError).toBe(true)
      expect(summaries).toEqual([])
    }
  })
})
