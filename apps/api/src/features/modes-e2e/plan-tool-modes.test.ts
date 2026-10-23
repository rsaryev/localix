import { describe, expect, test } from 'bun:test'

import { builtinAgentPreset } from '../capabilities/builtin-agent-presets'
import { PERMISSION_MODES } from '../../contracts/permission-modes'
import { modeSurface, planPortFor, runRegistry } from './testing/run-surface'

/**
 * THE `plan` TOOL ACROSS MODES — on every chat roster, `present` only in plan mode, never a child's.
 *
 * Two failures this pins. The old tool existed only in plan mode, so the approval that switched
 * the mode took it off the roster and the implementing run could not `complete` the plan. And a
 * `present` that trusted the gate alone would put a review card in front of a person who had just
 * switched to bypass: the gate ALLOWS `present` in every mode (it is `session` state), so the
 * refusal outside plan mode is the tool's, and has to be.
 */
describe('on the roster', () => {
  test.each([...PERMISSION_MODES])(
    '%s: a chat run holds `plan`, for every shipped preset',
    (mode) => {
      for (const handle of ['localix', 'lead', 'qa']) {
        const surface = modeSurface(builtinAgentPreset(handle), mode, [])
        expect(surface.denied).not.toContain('plan')
        expect(runRegistry('chat', mode, surface.denied).toolNames).toContain('plan')
      }
    },
  )

  test.each(['subagent', 'job'] as const)(
    'a %s never holds it: the plan is the root conversation’s, reviewed by its person',
    (kind) => {
      const registry = runRegistry(kind, 'plan', [])
      expect(registry.toolNames).not.toContain('plan')
      expect(registry.ledger.get('plan')).toMatchObject({
        state: 'withheld',
        reason: { layer: 'shape', kind: 'never' },
      })
    },
  )
})

describe('present', () => {
  const presentCall = { action: 'present', title: 'Cache layer', body: '## Goal\nFast reads' }

  test.each([...PERMISSION_MODES])(
    '%s: the gate lets it through — the class is session',
    async (mode) => {
      const plan = runRegistry('chat', mode, []).tools.find((tool) => tool.name === 'plan')!
      expect(
        await modeSurface(builtinAgentPreset('localix'), mode, []).decide(plan, presentCall),
      ).toBe('allow')
    },
  )

  test.each([...PERMISSION_MODES])('%s: the tool presents only in plan mode', async (mode) => {
    const presented: string[] = []
    const registry = runRegistry('chat', mode, [], [], planPortFor(mode, presented))
    const plan = registry.tools.find((tool) => tool.name === 'plan')!
    const result = await plan.execute('call-1', presentCall)
    if (mode === 'plan') {
      expect(result.isError).toBeUndefined()
      expect(result.terminate).toBe(true)
      expect(presented).toEqual(['Cache layer'])
    } else {
      expect(result.isError).toBe(true)
      expect(String(result.content)).toContain('not in Plan mode')
      expect(presented).toEqual([])
    }
  })

  test.each([...PERMISSION_MODES])(
    '%s: read and complete stay callable through the gate',
    async (mode) => {
      const plan = runRegistry('chat', mode, []).tools.find((tool) => tool.name === 'plan')!
      const surface = modeSurface(builtinAgentPreset('localix'), mode, [])
      expect(await surface.decide(plan, { action: 'read' })).toBe('allow')
      expect(await surface.decide(plan, { action: 'complete', summary: 'done' })).toBe('allow')
    },
  )
})
