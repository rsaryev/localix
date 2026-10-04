import { describe, expect, test } from 'bun:test'

import { runRule } from '../testing/run-rule.ts'

const RULE = 'no-hardcoded-colors'

describe(RULE, () => {
  test('reports a literal colour in a style prop', async () => {
    const findings = await runRule(RULE, `const El = <div style={{ color: '#ffffff' }} />`)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('cannot follow the theme')
  })

  test.each(['rgb(0 0 0)', 'rgba(0,0,0,.5)', 'hsl(0 0% 0%)', 'oklch(0.2 0 0)'])(
    'reports %s in a style prop',
    async (color) => {
      const findings = await runRule(RULE, `const El = <div style={{ background: '${color}' }} />`)
      expect(findings).toHaveLength(1)
    },
  )

  test('allows a token in a style prop', async () => {
    const findings = await runRule(
      RULE,
      `const El = <div style={{ color: 'var(--foreground)' }} />`,
    )
    expect(findings).toEqual([])
  })

  test('allows a computed style value', async () => {
    const findings = await runRule(RULE, `const El = <div style={{ color: theme.accent }} />`)
    expect(findings).toEqual([])
  })

  test('reports a Tailwind arbitrary colour', async () => {
    const findings = await runRule(RULE, `const El = <div className="text-[#abcdef]" />`)
    expect(findings).toHaveLength(1)
  })

  test('allows a token-backed utility class', async () => {
    const findings = await runRule(RULE, `const El = <div className="text-foreground bg-card" />`)
    expect(findings).toEqual([])
  })

  test('leaves a colour used as DATA alone', async () => {
    // A colour picker offers hex values to the user; a canvas keeps a hex fallback because it
    // cannot resolve a CSS variable. Neither paints through a style prop, and neither is a defect.
    const findings = await runRule(
      RULE,
      `const SWATCHES = [{ label: 'Violet', value: '#7567e8' }]
       const colors = { up: readVar('--status-success', '#26a69a') }`,
    )
    expect(findings).toEqual([])
  })
})
