import { describe, expect, test } from 'bun:test'
import { createToolOutputTool } from '../../../agent-core/tools/context-search/context-search'
import type { PermissionRule } from '../../../agent-core/permission-engine'
import { assertRunToolRequirements } from './tool-requirements'
import { createPermissionGate } from '../../../agent-core/permission-gate'

const recovery = createToolOutputTool({} as never, {} as never, 'user', 'session')
const call = {
  toolCallId: 'recover',
  toolName: recovery.name,
  input: { action: 'get', tool_call_id: 'earlier' },
}

describe('run tool requirements', () => {
  test('every turn requires recovery, independently of host requirements', () => {
    expect(() => assertRunToolRequirements([], [])).toThrow('ToolOutput')
    expect(() => assertRunToolRequirements([recovery], [])).not.toThrow()
    expect(() => assertRunToolRequirements([], [])).toThrow('ToolOutput')
    expect(() =>
      assertRunToolRequirements([recovery], [], [{ name: 'Jobs', resources: ['list'] }]),
    ).toThrow('Jobs')
  })

  test('a registered search-only tool cannot fulfill the recovery protocol', () => {
    const searchOnly = createToolOutputTool({} as never, {} as never, 'user', 'session', ['search'])
    expect(() => assertRunToolRequirements([searchOnly], [])).toThrow(
      'ToolOutput(get) is unavailable',
    )
    const getOnly = createToolOutputTool({} as never, {} as never, 'user', 'session', ['get'])
    expect(() => assertRunToolRequirements([getOnly], [])).not.toThrow()
  })

  test.each(['deny', 'ask'] as const)(
    '%s on recovery prevents preparation and live execution',
    async (action) => {
      const rules: PermissionRule[] = [
        { permission: recovery.name, pattern: '*', action: 'allow' },
        { permission: recovery.name, pattern: 'get', action },
      ]
      expect(() => assertRunToolRequirements([recovery], rules)).toThrow(
        action === 'ask' ? 'requires approval' : 'is denied by policy',
      )
      // Preparation refuses either way — a run that cannot recover its own output has no way
      // to finish. At the live gate a mode that stops asking rewrites the list's asks into
      // allows; it never ignores a denial.
      const gate = createPermissionGate({
        toolsByName: new Map([[recovery.name, recovery]]),
        rules: rules.map((rule) =>
          rule.action === 'ask' ? { ...rule, action: 'allow' as const } : rule,
        ),
      })
      if (action === 'deny') expect(await gate(call)).toMatchObject({ block: true })
      else expect((await gate(call))?.block).toBeFalsy()
    },
  )

  test('a same-scope recovery exception permits get while search remains denied', async () => {
    const rules: PermissionRule[] = [
      { permission: recovery.name, pattern: '*', action: 'deny' },
      { permission: recovery.name, pattern: 'get', action: 'allow' },
    ]
    expect(() => assertRunToolRequirements([recovery], rules)).not.toThrow()
    const gate = createPermissionGate({ toolsByName: new Map([[recovery.name, recovery]]), rules })
    // An allow that a RULE produced is attributed, so the UI can explain why nothing was
    // asked. Only the absence of any matching rule stays silent.
    expect(await gate(call)).toMatchObject({
      provenance: { decision: 'rule-allow', detail: 'ToolOutput(get)' },
    })
    expect(
      await gate({ ...call, input: { action: 'search', queries: ['something'] } }),
    ).toMatchObject({ block: true })
  })

  test('checks changed policy on the next preparation', () => {
    assertRunToolRequirements([recovery], [])
    expect(() =>
      assertRunToolRequirements(
        [recovery],
        [{ permission: recovery.name, pattern: 'get', action: 'deny' }],
      ),
    ).toThrow('ToolOutput(get)')
  })
})
