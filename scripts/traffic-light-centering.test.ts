import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The HTML toolbar shares the native button row and reserves the measured tab band. */
const repoRoot = resolve(import.meta.dir, '..')
const RUST = 'apps/desktop-tauri/src-tauri/src/workspace_builder.rs'
const CSS = 'packages/kit/styles/chrome.css'
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8')

function usesSharedTitlebarGeometry(source: string): boolean {
  return (
    source.includes('.title_bar_style(TitleBarStyle::Overlay)') &&
    source.includes('crate::native_chrome::install(') &&
    !source.includes('.traffic_light_position(')
  )
}

describe('macOS native titlebar geometry', () => {
  test('the toolbar shares AppKit buttons with measured geometry', () => {
    expect(usesSharedTitlebarGeometry(read(RUST))).toBe(true)
    expect(read(RUST)).toContain('.tabbing_identifier("ai.localix.workspace")')
    expect(read(RUST)).toContain('.hidden_title(true)')
  })

  test('separate chrome, unmeasured overlays and manual button positioning fail', () => {
    const source = read(RUST)
    expect(
      usesSharedTitlebarGeometry(
        source.replace('TitleBarStyle::Overlay', 'TitleBarStyle::Transparent'),
      ),
    ).toBe(false)
    expect(
      usesSharedTitlebarGeometry(
        source.replace('crate::native_chrome::install(', 'unmeasured_overlay('),
      ),
    ).toBe(false)
    expect(usesSharedTitlebarGeometry(`${source}\n.traffic_light_position(position)`)).toBe(false)
  })

  test('the HTML toolbar reserves the button gap and a separate native tab band', () => {
    expect(read(RUST)).toContain("document.documentElement.dataset.nativeTitlebar='true'")
    expect(read(CSS)).toContain('padding-left: var(--native-window-button-gap)')
    expect(read(CSS)).toContain('height: var(--native-tabbar-height)')
    const geometry = read('apps/desktop-tauri/src-tauri/src/native_chrome.rs')
    expect(geometry).toContain('native.contentLayoutRect()')
    expect(geometry).toContain('addObserver: &*observer')
    expect(geometry).toContain('removeObserver: &*observer')
    expect(geometry).toContain('crate::main_queue::defer')
  })
})

test('Command T belongs to native workspace creation', () => {
  expect(read('apps/desktop-tauri/src-tauri/src/workspace_menu.rs')).toContain(
    '("new_workspace_tab", "New Workspace Tab", Some("Cmd+T"))',
  )
})
