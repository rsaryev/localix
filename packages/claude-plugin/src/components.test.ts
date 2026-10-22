import { describe, expect, test } from 'bun:test'

import { outputStyleOf, parseTheme, parseWorkflowMeta, pluginSettingsOf, themeColor } from '.'

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

describe('pluginSettingsOf', () => {
  test('the file wins when it sets a supported key; other keys are dropped with a warning', () => {
    const { settings, issues } = pluginSettingsOf(
      { agent: 'reviewer', model: 'opus' },
      { agent: 'other' },
    )
    expect(settings).toEqual({ agent: 'reviewer' })
    expect(issues.map((found) => found.message)).toEqual(['Plugin settings ignore "model"'])
  })

  test('the manifest key applies when the file sets nothing supported', () => {
    const line = { type: 'command' as const, command: 'jq .' }
    expect(pluginSettingsOf({ theme: 'x' }, { subagentStatusLine: line }).settings).toEqual({
      subagentStatusLine: line,
    })
    expect(pluginSettingsOf(undefined, { agent: 7 }).issues[0]?.severity).toBe('error')
  })
})

describe('themes', () => {
  test('every color form Claude Code accepts becomes CSS; anything else is ignored', () => {
    expect(themeColor('#ABCDEF')).toBe('#abcdef')
    expect(themeColor('#abc')).toBe('#aabbcc')
    expect(themeColor('rgb(255, 0, 16)')).toBe('#ff0010')
    expect(themeColor('ansi256(196)')).toBe('#ff0000')
    expect(themeColor('ansi256(244)')).toBe('#808080')
    expect(themeColor('ansi:cyanBright')).toBe('#00ffff')
    for (const bad of ['red', 'rgb(300,0,0)', 'ansi256(256)', 'ansi:nope', 3]) {
      expect(themeColor(bad)).toBeNull()
    }
  })

  test('a theme defaults its name to the slug and its base to dark', () => {
    expect(
      parseTheme('dracula', { base: 'neon', overrides: { claude: '#bd93f9', x: 'y' } }),
    ).toEqual({ slug: 'dracula', name: 'dracula', base: 'dark', overrides: { claude: '#bd93f9' } })
    expect(parseTheme('x', [])).toBeNull()
  })
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
