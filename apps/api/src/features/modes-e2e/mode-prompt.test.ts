import { describe, expect, test } from 'bun:test'

import { DEFAULT_AGENT_HANDLE } from '../../db/participant'
import { resolveRunProfile, type AgentSessionKind } from '../agent-core/run-shape'
import { buildAgentSystemPrompt } from '../agent-core/system-prompt'
import {
  APPROVED_PLAN_HEADER,
  PLAN_MODE_HEADER,
  type ApprovedPlanPrompt,
} from '../agent-core/system-prompt-plan-sections'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import { builtinAgentPreset } from '../capabilities/builtin-agent-presets'
import { PERMISSION_MODES, type PermissionMode } from '../capabilities/permission-modes'
import { modeSurface, PLAN_DRAFT, runRegistry } from './run-surface'

/**
 * WHAT EACH MODE'S PROMPT SAYS — the plan sections where they belong, and no tool it lacks.
 *
 * A mode changes the rules, and the prompt is derived from the tools those rules leave; the
 * `# Plan mode` section is the one place the MODE itself reaches the prompt (the run passes it,
 * because `plan` is on every roster now). Rendered here through the same chain a run takes: the
 * mode's projection removes tools, the registry is built without them, the prompt gates on it.
 */
const APPROVED: ApprovedPlanPrompt = { version: 2, title: 'Cache layer', body: '## Goal\nFast' }

function render(mode: PermissionMode, kind: AgentSessionKind, approvedPlan?: ApprovedPlanPrompt) {
  const denied = modeSurface(builtinAgentPreset(DEFAULT_AGENT_HANDLE), mode, []).denied
  const registry = runRegistry(kind, mode, denied)
  const prompt = buildAgentSystemPrompt({
    sessionId: 'session-1',
    modelId: 'openrouter/anthropic/claude-sonnet-4.5',
    providerId: 'openrouter',
    now: () => '2026-06-01T12:00:00.000Z',
    agentProfile: resolveRunProfile({ sessionKind: kind }),
    toolRegistry: registry,
    workspaceRoot: '/repo',
    ...(mode === 'plan' ? { planMode: { draftPath: PLAN_DRAFT } } : {}),
    ...(approvedPlan ? { approvedPlan } : {}),
  })
  return { prompt, roster: new Set(registry.toolNames) }
}

/** The capability lint's detector (`system-prompt-capability.test.ts`), restated: a test file
 *  cannot import another's helpers without registering its tests twice. */
const names = (prose: string, tool: string) =>
  new RegExp('`' + tool + '`').test(prose) ||
  new RegExp(`\\b${tool}\\.[a-z]`).test(prose) ||
  (tool.includes('_') && new RegExp(`\\b${tool}\\b`).test(prose))

/** The prompt without its roster and its catalog of absences — the two lists that name tools. */
function prose(prompt: string): string {
  let text = prompt
  for (const header of ['# Available tools\n', '# Unavailable tools\n']) {
    const start = text.indexOf(header)
    if (start < 0) continue
    const end = text.indexOf('\n\n', start)
    text = text.slice(0, start) + (end < 0 ? '' : text.slice(end))
  }
  return text
}

const phantoms = (prompt: string, roster: ReadonlySet<string>) =>
  BUILTIN_TOOL_NAMES.filter((tool) => !roster.has(tool) && names(prose(prompt), tool))

describe('# Plan mode', () => {
  test.each([...PERMISSION_MODES])('%s: rendered only in plan mode', (mode) => {
    expect(render(mode, 'chat').prompt.includes(PLAN_MODE_HEADER)).toBe(mode === 'plan')
  })

  test('it tells the run to present with `plan` and names `ask` only beside it', () => {
    const { prompt } = render('plan', 'chat')
    expect(prompt).toContain('`plan` action `present`')
    // It names the plan file, and the edit tools the run holds to revise it.
    expect(prompt).toContain(`Write the plan to ${PLAN_DRAFT}`)
    expect(prompt).toContain('`apply_patch`')
    expect(prompt).toContain('`ask`')
  })
})

describe('# Approved plan', () => {
  test.each(['default', 'bypass', 'autonomous'] as const)(
    '%s: with an approved plan the run follows it and is told to `complete` it',
    (mode) => {
      const { prompt } = render(mode, 'chat', APPROVED)
      expect(prompt).toContain(APPROVED_PLAN_HEADER)
      expect(prompt).toContain('call `plan` with action `complete`')
    },
  )

  test.each([...PERMISSION_MODES])('%s: without one there is no section', (mode) => {
    expect(render(mode, 'chat').prompt).not.toContain(APPROVED_PLAN_HEADER)
  })

  test('a child holds no `plan`, so a section reaching it would not tell it to complete', () => {
    const { prompt, roster } = render('default', 'subagent', APPROVED)
    expect(roster.has('plan')).toBe(false)
    expect(prompt).not.toContain('action `complete`')
  })
})

describe('no prompt names a tool its run lacks', () => {
  test('the detector sees a backticked name, an action call and a bare compound name', () => {
    expect(phantoms('call `plan` now', new Set())).toContain('plan')
    expect(phantoms('use history_search', new Set())).toContain('history_search')
    expect(phantoms('# Available tools\n- plan\n\nnothing', new Set())).toEqual([])
  })

  for (const kind of ['chat', 'subagent', 'job'] as const)
    for (const mode of PERMISSION_MODES)
      for (const approved of [undefined, APPROVED])
        test(`${kind}/${mode}${approved ? ' with an approved plan' : ''}`, () => {
          const { prompt, roster } = render(mode, kind, approved)
          expect(phantoms(prompt, roster)).toEqual([])
        })
})
