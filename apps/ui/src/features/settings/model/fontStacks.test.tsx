import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

/**
 * THE FONT PREVIEW MUST NOT LIE.
 *
 * The settings typography card renders its live sample with `codeFontCss(value)`; the
 * editor is dressed by `useFontFamily`, which writes `--font-mono` on <html>. Those were
 * two hand-kept copies of one fact — the CSS stack for a code font — and they had drifted
 * on 3 of the 4 fonts:
 *
 *   fragment-mono   preview: 'Fragment Mono', ui-monospace, monospace
 *                   LIVE:    'Fragment Mono', ui-monospace, 'Cascadia Code', monospace
 *   jetbrains-mono  preview: 'JetBrains Mono Variable', monospace
 *                   LIVE:    'JetBrains Mono Variable', ui-monospace, monospace
 *   fira-code       preview: 'Fira Code Variable', monospace
 *                   LIVE:    'Fira Code Variable', ui-monospace, monospace
 *
 * The primary family is the same in each pair, so the divergence is INVISIBLE while the
 * webfont loads — and decides the typeface the moment it does not. Different fallback
 * chains mean the preview and the editor resolve to different fonts: the user picks what
 * they saw and gets something else.
 *
 * This test is deliberately NOT `expect(CODE_FONT_STACKS[v]).toBe(CODE_FONT_STACKS[v])`.
 * It observes the two SURFACES independently — the string the preview renders, and the
 * custom property the hook actually installs on the document — and asserts they agree.
 * Re-introduce a second stack table anywhere between them and this goes red.
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 0))
  await teardown()
})

/** Imported AFTER happy-dom registers: the settings store seeds from `localStorage` at module load. */
async function surfaces() {
  const [
    { CODE_FONT_OPTIONS, UI_FONT_OPTIONS, codeFontCss },
    { useFontFamily },
    { useSettingsStore },
  ] = await Promise.all([
    import('./fontOptions'),
    import('./useFontFamily'),
    import('@/shared/lib/user-settings/settingsStore'),
  ])
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')

  /** Mount the REAL hook with a stored preference and read back what it installed on <html>. */
  const liveStack = async (patch: Record<string, string>, prop: string) => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, uiSettings: { ...patch } } }))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    function Probe() {
      useFontFamily()
      return null
    }
    await act(async () => {
      root.render(React.createElement(Probe))
    })
    const applied = document.documentElement.style.getPropertyValue(prop)
    await act(async () => {
      root.unmount()
    })
    host.remove()
    return applied
  }

  return { CODE_FONT_OPTIONS, UI_FONT_OPTIONS, codeFontCss, liveStack }
}

describe('the font picker previews the stack the editor actually installs', () => {
  test('every code font: preview stack === the live --font-mono the hook writes', async () => {
    const { CODE_FONT_OPTIONS, codeFontCss, liveStack } = await surfaces()

    // Guard the guard: if the catalog were empty, the loop below would pass vacuously.
    expect(CODE_FONT_OPTIONS.length).toBeGreaterThan(0)

    for (const option of CODE_FONT_OPTIONS) {
      const previewed = codeFontCss(option.value) // what the settings card shows you
      const live = await liveStack({ codeFont: option.value }, '--font-mono') // what you get

      expect(live, `${option.value}: the hook installed no --font-mono`).not.toBe('')
      expect(
        previewed,
        `${option.value}: the settings preview advertises a different font stack than the editor installs`,
      ).toBe(live)
    }
  })

  test('the unset default previews and applies the same stack', async () => {
    const { codeFontCss, liveStack } = await surfaces()
    // No stored codeFont: the preview falls back to the default, and so must the hook.
    // (The hook writes NOTHING when unset — index.css owns the default — so assert against
    //  the explicit default instead of an empty property.)
    expect(await liveStack({}, '--font-mono')).toBe('')
    expect(codeFontCss(undefined)).toBe(
      await liveStack({ codeFont: 'fragment-mono' }, '--font-mono'),
    )
  })

  test('every interface font: preview catalog value resolves to the live --font-sans', async () => {
    const { UI_FONT_OPTIONS, liveStack } = await surfaces()
    const { UI_FONT_STACKS } = await import('./fontOptions')

    expect(UI_FONT_OPTIONS.length).toBeGreaterThan(0)
    for (const option of UI_FONT_OPTIONS) {
      const live = await liveStack({ fontFamily: option.value }, '--font-sans')
      expect(live, `${option.value}: the hook installed no --font-sans`).not.toBe('')
      expect(
        UI_FONT_STACKS[option.value],
        `${option.value}: sans stack drifted from the live one`,
      ).toBe(live)
    }
  })
})
