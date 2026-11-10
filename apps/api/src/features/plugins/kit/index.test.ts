import { describe, expect, test } from 'bun:test'

// The boundary's own evidence that the linked kit loads under Bun (its `bun` condition, the src
// files) from the root and from a subpath. Only this folder imports the kit (rule X7).
describe('the llx-plugin kit behind the boundary', () => {
  test('the root and a subpath load', async () => {
    const root = await import('@rsaryev/llx-plugin')
    const layout = await import('@rsaryev/llx-plugin/layout')
    expect(root.HOOK_EVENTS).toContain('PreToolUse')
    expect(layout.STANDARD_LAYOUT.skills.location).toBe('skills')
  })
})
