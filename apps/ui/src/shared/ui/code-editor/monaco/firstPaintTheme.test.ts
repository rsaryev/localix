import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerDom } from '@localixai/kit/testing/dom'
import { defineLocalixMonacoTheme } from './theme'
import type { MonacoApi } from './runtime'

let teardown: () => Promise<void>
// `defineLocalixMonacoTheme` resolves colours through getComputedStyle + a canvas, so it needs a
// document. With no CSS loaded every token falls back to its dark default, which is the point.
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

/**
 * `monaco.editor.create` without a `theme` uses Monaco's own default, `vs` — which is LIGHT. Every
 * editor therefore painted a white rectangle for the frames between `create()` and the `setTheme`
 * that `watchLocalixMonacoTheme` issues afterwards. That is the "a piece of the screen is white on
 * startup" flash: the editor is the largest sub-surface in the app, Monaco is loaded lazily, and in
 * dev those frames are long enough to see.
 */
const editorSource = readFileSync(join(import.meta.dir, '../CodeEditor.tsx'), 'utf8')

/** The options object literal passed to the single `monaco.editor.create(...)` call. */
function createOptions(): string {
  const start = editorSource.indexOf('monaco.editor.create(')
  expect(start).toBeGreaterThan(-1)
  return editorSource.slice(start, start + 1200)
}

describe('editors are born with the app theme', () => {
  test('compact editors can disable pinned rows at creation and on later prop changes', () => {
    expect(editorSource).toContain('enabled: latestPropsRef.current.stickyScrollEnabled ?? true')
    expect(editorSource).toContain(
      'stickyScroll: { enabled: stickyScrollEnabled, maxLineCount: 5 }',
    )
    expect(editorSource).not.toContain('stickyScroll: { enabled: true')
  })

  test('the create call passes a theme, so the first painted frame is already themed', () => {
    expect(createOptions()).toContain('theme:')
  })

  test('that theme comes from defineLocalixMonacoTheme, not a hardcoded name', () => {
    // A literal 'vs-dark' would be dark — and would also ignore a plugin theme's own appearance,
    // which is exactly what `defineLocalixMonacoTheme` resolves from the live CSS variables.
    expect(createOptions()).toContain('theme: defineLocalixMonacoTheme(monaco)')
    expect(createOptions()).not.toMatch(/theme: '(vs|vs-dark|hc-black)'/u)
  })

  test('defineLocalixMonacoTheme defines a dark base by default and returns its name', () => {
    // No CSS is loaded here, so every token falls back to its dark default — the same dark-first
    // rule the rest of the app follows. The returned name must be the one it defined, or `create`
    // would reference a theme Monaco does not know.
    const defined: Array<{ name: string; base: string }> = []
    const monaco = {
      editor: {
        defineTheme: (name: string, data: { base: string }) =>
          void defined.push({ name, base: data.base }),
      },
    } as unknown as MonacoApi

    const name = defineLocalixMonacoTheme(monaco)
    expect(defined).toHaveLength(1)
    expect(defined[0]?.name).toBe(name)
    expect(defined[0]?.base).toBe('vs-dark')
  })

  test('definition peek uses the app frame, result selection and navigation highlight', () => {
    let colors: Record<string, string> = {}
    const monaco = {
      editor: {
        defineTheme: (_name: string, data: { colors: Record<string, string> }) => {
          colors = data.colors
        },
      },
    } as unknown as MonacoApi
    defineLocalixMonacoTheme(monaco)
    expect(colors['peekView.border']).toBe(colors['editorWidget.border'])
    for (const token of [
      'peekViewTitle.background',
      'peekViewResult.background',
      'peekViewEditor.background',
      'peekViewEditorGutter.background',
      'editorStickyScroll.background',
      'editorStickyScrollGutter.background',
      'peekViewEditorStickyScroll.background',
      'peekViewEditorStickyScrollGutter.background',
    ]) {
      expect(colors[token]).toBe(colors['editor.background'])
    }
    expect(colors['peekViewResult.selectionBackground']).toBe(
      colors['list.activeSelectionBackground'],
    )
    expect(colors['peekViewResult.lineForeground']).toBe(colors['editor.foreground'])
    expect(colors['peekViewEditor.matchHighlightBackground']).toBe(
      `${colors['editorInfo.foreground']!.slice(0, 7)}24`,
    )
  })
})
