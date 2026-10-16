import { describe, expect, test } from 'bun:test'
import { assertRequiredToolsAvailable } from './required-tools'

describe('required run tools', () => {
  test('accepts hosts without requirements', () => {
    expect(() => assertRequiredToolsAvailable(undefined, [])).not.toThrow()
    expect(() => assertRequiredToolsAvailable([], [])).not.toThrow()
  })

  test('accepts registered tools independently of their source or wire visibility', () => {
    expect(() =>
      assertRequiredToolsAvailable(
        [{ name: 'report' }, { name: 'mcp_archive' }],
        [{ name: 'read' }, { name: 'report' }, { name: 'mcp_archive' }],
      ),
    ).not.toThrow()
  })

  test('reports every missing requirement once without restoring a tool', () => {
    const tools = [{ name: 'read' }]
    expect(() =>
      assertRequiredToolsAvailable(
        ['report', 'recover', 'report', 'read'].map((name) => ({ name })),
        tools,
      ),
    ).toThrow('Required run tools are unavailable: report, recover')
    expect(tools).toEqual([{ name: 'read' }])
  })

  test('rechecks the current roster when a tool disappears between runs', () => {
    const required = [{ name: 'report' }]
    assertRequiredToolsAvailable(required, [{ name: 'report' }])
    expect(() => assertRequiredToolsAvailable(required, [])).toThrow('report')
  })
})
