import { describe, expect, test } from 'bun:test'

import { runRule } from '../testing/run-rule.ts'

const RULE = 'no-global-key-listener'
const IN_UI = 'apps/ui/src/features/demo/'

describe(RULE, () => {
  test('reports a global keydown listener', async () => {
    const findings = await runRule(
      RULE,
      `export function Panel() {
         window.addEventListener('keydown', () => {})
       }`,
      { filename: `${IN_UI}Panel.tsx` },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('registerActionHandler')
  })

  test.each(['keyup', 'keypress'])('reports a global %s listener', async (event) => {
    const findings = await runRule(RULE, `document.addEventListener('${event}', handler)`, {
      filename: `${IN_UI}Surface.tsx`,
    })
    expect(findings).toHaveLength(1)
  })

  test('allows a listener bounded to one element', async () => {
    const findings = await runRule(
      RULE,
      `export function Field({ input }: { input: HTMLInputElement }) {
         input.addEventListener('keydown', () => {})
       }`,
      { filename: `${IN_UI}Field.tsx` },
    )
    expect(findings).toEqual([])
  })

  test('allows a non-key global listener', async () => {
    const findings = await runRule(RULE, `window.addEventListener('resize', () => {})`, {
      filename: `${IN_UI}Surface.tsx`,
    })
    expect(findings).toEqual([])
  })

  test('exempts the dispatcher itself', async () => {
    const findings = await runRule(RULE, `window.addEventListener('keydown', onKeyDown, true)`, {
      filename: 'apps/ui/src/shared/lib/actions/ActionRegistryProvider.tsx',
    })
    expect(findings).toEqual([])
  })

  test('exempts the chord recorder, which must see the raw key', async () => {
    const findings = await runRule(RULE, `window.addEventListener('keydown', onKey, true)`, {
      filename: 'apps/ui/src/features/settings/ui/keyboard/ChordRecorder.tsx',
    })
    expect(findings).toEqual([])
  })

  test('does not exempt a file that merely shares a name fragment', async () => {
    const findings = await runRule(RULE, `window.addEventListener('keydown', onKey)`, {
      filename: 'apps/ui/src/features/settings/ui/keyboard/ChordRecorderPreview.tsx',
    })
    expect(findings).toHaveLength(1)
  })

  test('reports a global listener in a kit primitive, which every surface mounts', async () => {
    const findings = await runRule(RULE, `window.addEventListener('keydown', onKey)`, {
      filename: 'packages/kit/src/overlays/find-widget.tsx',
    })
    expect(findings).toHaveLength(1)
  })

  test('is silent outside the workspace UI, where there is no registry to use', async () => {
    // The landing site and the visual-feedback probe have no action registry; for them a global
    // listener is the only listener there is.
    const findings = await runRule(RULE, `window.addEventListener('keydown', onKey)`, {
      filename: 'apps/landing/src/pages/HomePage.tsx',
    })
    expect(findings).toEqual([])
  })

  test('is silent in a test file', async () => {
    const findings = await runRule(RULE, `window.addEventListener('keydown', onKey)`, {
      filename: 'apps/ui/src/features/demo/Panel.test.ts',
    })
    expect(findings).toEqual([])
  })
})
