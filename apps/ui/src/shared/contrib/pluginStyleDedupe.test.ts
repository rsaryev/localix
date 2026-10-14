import { describe, expect, test } from 'bun:test'
import { canonicalRuleText, dropHostDuplicates, hostRuleTexts } from './pluginStyleDedupe'

type FakeRule = { cssText: string; cssRules?: FakeRule[] }
const sheet = (rules: FakeRule[]) => ({
  cssRules: rules as unknown as CSSRuleList,
  deleteRule: (index: number) => void rules.splice(index, 1),
})

const HOST_FLEX_COL_REVERSE = '.flex-col-reverse { flex-direction: column-reverse; }'
const HOST_SM_ROW = '.sm\\:flex-row { @media (width >= 40rem) { flex-direction: row; } }'

describe('plugin utilities minus the host', () => {
  test('a plugin copy of a host utility is dropped, so it cannot out-rank the host variant', () => {
    // The observed defect: a plugin's unlayered `.flex-col-reverse` beat the host's
    // layered `sm:flex-row`, and every dialog footer stacked its buttons at desktop widths.
    const host = hostRuleTexts([
      sheet([
        {
          cssText: '@layer utilities { … }',
          cssRules: [{ cssText: HOST_FLEX_COL_REVERSE }, { cssText: HOST_SM_ROW }],
        },
      ]),
    ])
    const rules: FakeRule[] = [
      { cssText: HOST_FLEX_COL_REVERSE },
      { cssText: '.grid-cols-\\[1fr_2fr\\] { grid-template-columns: 1fr 2fr; }' },
    ]
    expect(dropHostDuplicates(sheet(rules), host)).toBe(1)
    expect(rules.map((rule) => rule.cssText)).toEqual([
      '.grid-cols-\\[1fr_2fr\\] { grid-template-columns: 1fr 2fr; }',
    ])
  })

  test('a rule the host does not emit stays, including a plugin-only variant', () => {
    const host = hostRuleTexts([sheet([{ cssText: HOST_FLEX_COL_REVERSE }])])
    const rules: FakeRule[] = [{ cssText: HOST_SM_ROW }]
    expect(dropHostDuplicates(sheet(rules), host)).toBe(0)
    expect(rules).toHaveLength(1)
  })

  test('a token utility matches although the plugin wrote its fallback', () => {
    // The observed defect: Database's `.px-2` carried `var(--spacing, 0.25rem)`, never matched the
    // host's `var(--spacing)`, stayed unlayered and beat the host's `pl-8` on every gutter menu
    // row — each icon sat on its label.
    const host = hostRuleTexts([
      sheet([
        {
          cssText: '@layer utilities { … }',
          cssRules: [
            { cssText: '.px-2 { padding-inline: calc(var(--spacing) * 2); }' },
            { cssText: '.bg-x { background: color-mix(in oklab, var(--a) 50%, var(--b)); }' },
          ],
        },
      ]),
    ])
    const rules: FakeRule[] = [
      { cssText: '.px-2 { padding-inline: calc(var(--spacing, 0.25rem) * 2); }' },
      {
        cssText:
          '.bg-x { background: color-mix(in oklab, var(--a, oklch(0.2 0 0 / 50%)) 50%, var(--b, red)); }',
      },
      // A different value is a different rule, fallback or not.
      { cssText: '.px-3 { padding-inline: calc(var(--spacing, 0.25rem) * 3); }' },
    ]
    expect(dropHostDuplicates(sheet(rules), host)).toBe(2)
    expect(rules.map((rule) => rule.cssText)).toEqual([
      '.px-3 { padding-inline: calc(var(--spacing, 0.25rem) * 3); }',
    ])
  })

  test('canonicalRuleText strips only fallbacks, nested ones included', () => {
    expect(canonicalRuleText('a: var(--x, var(--y, calc(1px + 2px))) var(--z)')).toBe(
      'a: var(--x) var(--z)',
    )
    expect(canonicalRuleText('.a { color: red; }')).toBe('.a { color: red; }')
  })

  test('an unreadable (cross-origin) host sheet is skipped rather than failing the mount', () => {
    const unreadable = {
      get cssRules(): CSSRuleList {
        throw new DOMException('cross-origin', 'SecurityError')
      },
    }
    expect(hostRuleTexts([unreadable, sheet([{ cssText: HOST_SM_ROW }])])).toEqual(
      new Set([HOST_SM_ROW]),
    )
  })

  // Every plugin mount asked, and every ask re-read the whole host stylesheet.
  test('a host sheet is read once however many plugins mount against it', () => {
    let reads = 0
    const rules = [{ cssText: HOST_FLEX_COL_REVERSE }]
    const counted = {
      get cssRules(): CSSRuleList {
        reads += 1
        return rules as unknown as CSSRuleList
      },
    }
    for (let mount = 0; mount < 20; mount++) {
      expect(hostRuleTexts([counted])).toEqual(new Set([HOST_FLEX_COL_REVERSE]))
    }
    expect(reads).toBe(1)
    // A replaced sheet (a dev HMR update) is a new object, and is read afresh.
    const replaced = sheet([{ cssText: HOST_SM_ROW }])
    expect(hostRuleTexts([replaced])).toEqual(new Set([HOST_SM_ROW]))
  })
})
