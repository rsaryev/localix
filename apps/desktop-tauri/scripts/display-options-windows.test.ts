import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every window the shell opens is told the system's Reduce transparency, through one code path.
 *
 * WKWebView never matches `prefers-reduced-transparency`, so a page knows the setting only when
 * the shell stamps `data-reduce-transparency` on it (`display_options.rs`). Only the workspace
 * window was stamped: the agent island and a standalone mini app's window stayed translucent with
 * the setting on. A window built anywhere else must go through `display_options` too.
 */
const SRC = join(import.meta.dir, '../src-tauri/src')
const sources = readdirSync(SRC)
  .filter((name) => name.endsWith('.rs'))
  .map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }))
const source = (name: string) => sources.find((file) => file.name === name)?.text ?? ''

describe('Reduce transparency reaches every window', () => {
  test('each Tauri window builder goes through display_options::stamped', () => {
    const builders = sources.filter((file) => file.text.includes('WebviewWindowBuilder::new('))
    expect(builders.map((file) => file.name).sort()).toEqual(['island.rs', 'workspace_builder.rs'])
    for (const file of builders)
      expect([file.name, file.text]).toEqual([
        file.name,
        expect.stringContaining('display_options::stamped('),
      ])
  })

  test('the stamp script is applied in display_options alone, not hand-wired per window', () => {
    const elsewhere = sources
      .filter((file) => file.name !== 'display_options.rs' && !file.name.startsWith('app_runner'))
      .filter((file) => file.text.includes('display_options::script()'))
      .map((file) => file.name)
    expect(elsewhere).toEqual([])
  })

  test('a workspace becoming key re-tells every open window, the island included', () => {
    expect(source('workspace_lifecycle.rs')).toContain('display_options::restamp(')
    expect(source('display_options.rs')).toContain('webview_windows()')
  })

  test('a standalone mini app stamps its page at load and again when its window becomes key', () => {
    expect(source('app_runner_page.rs')).toContain('display_options::script()')
    expect(source('app_runner_web.rs')).toContain('windowDidBecomeKey:')
  })
})
