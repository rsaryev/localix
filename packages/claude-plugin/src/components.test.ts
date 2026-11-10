import { describe, expect, test } from 'bun:test'

import { outputStyleOf, parseWorkflowMeta } from '.'

describe('outputStyleOf', () => {
  test('the file name stands in for a missing name; the flags read as booleans', () => {
    expect(outputStyleOf('terse', {}, '  Short.  ')).toEqual({
      name: 'terse',
      description: '',
      keepCodingInstructions: false,
      forceForPlugin: false,
      prompt: 'Short.',
    })
    const named = outputStyleOf(
      'file',
      { name: 'Diagrams first', 'keep-coding-instructions': 'true', 'force-for-plugin': true },
      'Draw.',
    )
    expect(named).toMatchObject({
      name: 'Diagrams first',
      keepCodingInstructions: true,
      forceForPlugin: true,
    })
  })
})

// Claude Code reads its frontmatter booleans as yes/no, on/off and 1/0 too, in any case.
test('an output style flag reads yes, on and 1 as true', () => {
  for (const yes of ['yes', 'On', '1', 'TRUE']) {
    expect(
      outputStyleOf('s', { 'keep-coding-instructions': yes }, 'x').keepCodingInstructions,
    ).toBe(true)
  }
  expect(outputStyleOf('s', { 'force-for-plugin': 'off' }, 'x').forceForPlugin).toBe(false)
})

describe('parseWorkflowMeta', () => {
  test('reads a plain literal meta and the body after it', () => {
    const source = `// audit
export const meta = {
  name: 'audit-routes',
  "description": \`Audit every route\`,
  phases: [{ title: 'Find' }, { title: 'Verify', detail: 'adversarial' },],
};
const found = await agent('List routes')
return found`
    const parsed = parseWorkflowMeta(source)
    expect(parsed.meta).toEqual({
      name: 'audit-routes',
      description: 'Audit every route',
      phases: [{ title: 'Find' }, { title: 'Verify', detail: 'adversarial' }],
    })
    expect(parsed.meta && parsed.body).toBe(
      "const found = await agent('List routes')\nreturn found",
    )
  })

  test('a meta that is not a plain literal, or not first, is refused', () => {
    expect(parseWorkflowMeta("export const meta = { name: NAME, description: '' }").meta).toBe(
      undefined,
    )
    expect(
      parseWorkflowMeta("export const meta = { name: `a${b}`, description: '' }").meta,
    ).toBeUndefined()
    expect(parseWorkflowMeta("const x = 1\nexport const meta = { name: 'a' }").meta).toBeUndefined()
    expect(parseWorkflowMeta("export const meta = { description: 'no name' }")).toEqual({
      error: 'meta has no "name"',
    })
  })
})
