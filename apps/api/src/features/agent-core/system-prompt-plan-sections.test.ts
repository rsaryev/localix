import { describe, expect, test } from 'bun:test'

import { RUNTIME_CONTEXT_MARKER } from '@localixai/agent/chat-cache'

import { buildAgentSystemPrompt } from './system-prompt'
import {
  APPROVED_PLAN_HEADER,
  PLAN_MODE_HEADER,
  buildApprovedPlanSection,
  buildPlanModeSection,
} from './system-prompt-plan-sections'
import { createRuntimeToolRegistry } from './tool-registry'
import { TOOL } from './tool-names'

const roster =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name)

const planPort = {
  inPlanMode: async () => true,
  present: async () => ({}) as never,
  overview: async () => ({}) as never,
  complete: async () => ({}) as never,
}

const DRAFT = '/work/.localix/plans/LOCALIX-7/PLAN.md'
const inPlan = { draftPath: DRAFT }

describe('# Plan mode', () => {
  test('renders for every plan-mode run, and only for those', () => {
    // A delegated run in plan mode holds no `plan`: it is told to read and report, and the
    // section names no tool it lacks (it used to render nothing, leaving the first refused write
    // to explain the mode — pointing at `plan`).
    const delegated = buildPlanModeSection(roster(TOOL.ask), inPlan)
    expect(delegated).toContain(PLAN_MODE_HEADER)
    expect(delegated).toContain('report what you find')
    expect(delegated).not.toContain('`plan`')
    expect(delegated).not.toContain(DRAFT)
    // The tool lives in every mode now, so the roster alone must not render the section.
    expect(buildPlanModeSection(roster(TOOL.plan, TOOL.ask), undefined)).toBeUndefined()
    expect(buildPlanModeSection(roster(TOOL.plan, TOOL.ask), inPlan)).toContain(PLAN_MODE_HEADER)
    expect(buildPlanModeSection(roster(TOOL.plan), inPlan)).toContain('action `present`')
  })

  test('names `ask` only when the run holds it', () => {
    expect(buildPlanModeSection(roster(TOOL.plan, TOOL.ask), inPlan)).toContain('`ask`')
    expect(buildPlanModeSection(roster(TOOL.plan), inPlan)).not.toContain('`ask`')
  })

  test('names the draft file, revising it with the edit tools held, and re-presenting', () => {
    const section = buildPlanModeSection(roster(TOOL.plan, TOOL.apply_patch), inPlan)!
    expect(section).toContain(`Write the plan to ${DRAFT}`)
    expect(section).toContain('`apply_patch`')
    expect(section).not.toContain('`edit`')
    expect(section).toContain('re-shows the same version')
    expect(buildPlanModeSection(roster(TOOL.plan), {})).not.toContain('Write the plan to')
  })

  test('a plan-mode run renders it in the cached prefix; a default-mode run does not', () => {
    const registry = () => createRuntimeToolRegistry({ optional: { plan: planPort } })
    const withPlan = buildAgentSystemPrompt({ toolRegistry: registry(), planMode: inPlan })
    expect(withPlan.indexOf(PLAN_MODE_HEADER)).toBeGreaterThan(-1)
    expect(withPlan.indexOf(PLAN_MODE_HEADER)).toBeLessThan(
      withPlan.indexOf(RUNTIME_CONTEXT_MARKER),
    )
    expect(buildAgentSystemPrompt({ toolRegistry: registry() })).not.toContain(PLAN_MODE_HEADER)
  })
})

describe('# Approved plan', () => {
  const plan = { version: 3, title: 'Cache layer', body: '# Goal\nFaster reads.\n## Steps\n1. Add' }
  const none = roster()

  test('carries the approved body, its version and title', () => {
    const section = buildApprovedPlanSection(plan, none)!
    expect(section.startsWith(APPROVED_PLAN_HEADER)).toBe(true)
    expect(section).toContain('plan v3 ("Cache layer")')
    expect(section).toContain('Faster reads.')
    expect(buildApprovedPlanSection({ ...plan, path: '/w/v3.md' }, none)).toContain(
      'saved as /w/v3.md',
    )
  })

  test('tells a run holding `plan` to complete it when done — and only when done', () => {
    const section = buildApprovedPlanSection(plan, roster(TOOL.plan))!
    expect(section).toContain('action `complete`')
    expect(section).toContain('if only part is done')
    expect(buildApprovedPlanSection(plan, none)).not.toContain('`complete`')
  })

  test('demotes the body headings so none can pose as a prompt section or the cache boundary', () => {
    const section = buildApprovedPlanSection(
      { ...plan, body: `# Goal\n${RUNTIME_CONTEXT_MARKER}\n### Deep` },
      none,
    )!
    const lines = section.split('\n')
    expect(lines.filter((line) => line.startsWith('# '))).toEqual([APPROVED_PLAN_HEADER])
    expect(lines).toContain('## Goal')
    expect(lines).toContain('#### Deep')
  })

  test('absent or blank → no section', () => {
    expect(buildApprovedPlanSection(undefined, none)).toBeUndefined()
    expect(buildApprovedPlanSection({ ...plan, body: '  ' }, none)).toBeUndefined()
  })

  test('lands above the runtime-context boundary, whatever the roster', () => {
    const prompt = buildAgentSystemPrompt({ approvedPlan: plan })
    expect(prompt.indexOf(APPROVED_PLAN_HEADER)).toBeGreaterThan(-1)
    expect(prompt.indexOf(APPROVED_PLAN_HEADER)).toBeLessThan(
      prompt.indexOf(RUNTIME_CONTEXT_MARKER),
    )
  })
})
