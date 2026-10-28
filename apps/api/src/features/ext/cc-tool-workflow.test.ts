import { describe, expect, test } from 'bun:test'

import { claudeCodeHookCall, claudeCodeToolName, localInputFromHook } from './cc-tool-shapes'

// claude-code-tools d.ts `Workflow`: `name`, `args`, `resumeFromRunId` — Localix's fields.
describe('the workflow tool in Claude Code’s shape', () => {
  test('reaches a hook as Workflow, its input unchanged', () => {
    const input = { name: 'ops:audit', args: { system: 'billing' } }
    expect(claudeCodeToolName({ name: 'Workflow' }, input)).toBe('Workflow')
    expect(claudeCodeHookCall({ name: 'Workflow' }, input)).toMatchObject({
      tool_name: 'Workflow',
      tool_input: input,
    })
  })

  test('a hook’s rewrite folds back', () => {
    const rewritten = localInputFromHook('workflow', { name: 'ops:audit' }, { name: 'ops:scan' })
    expect(rewritten).toMatchObject({ name: 'ops:scan' })
  })
})
