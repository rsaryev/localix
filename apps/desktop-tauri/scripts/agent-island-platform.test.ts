import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (name: string) => readFileSync(join(import.meta.dir, '../src-tauri/src', name), 'utf8')
const createsIsland = (source: string) =>
  /WebviewWindowBuilder|\.on_shortcut\(|companion_pointer|companion_macos|main_queue/.test(source)

test('non-macOS selects a companion adapter without any native island producers', () => {
  expect(read('lib.rs')).toContain(
    '#[cfg_attr(not(target_os = "macos"), path = "companion_unsupported.rs")]',
  )
  expect(createsIsland(read('companion_unsupported.rs'))).toBe(false)
  expect(createsIsland(read('companion.rs'))).toBe(true)
  expect(createsIsland('WebviewWindowBuilder::new(app, LABEL, url)')).toBe(true)
  expect(createsIsland('app.global_shortcut().on_shortcut(SHORTCUT, callback)')).toBe(true)
})

test('System island startup never substitutes a forced dark appearance', () => {
  const source = read('companion.rs')
  expect(source).toContain('load_theme_is_dark(app).map(')
  expect(source).toContain('.theme(theme)')
  expect(source).not.toContain('load_theme_is_dark(app) != Some(false)')
})
