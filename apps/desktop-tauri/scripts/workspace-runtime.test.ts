import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (name: string) => readFileSync(join(import.meta.dir, '../src-tauri/src', name), 'utf8')

function startsRuntime(source: string): boolean {
  return /\b(?:prepare_api|start_api|spawn_runtime)\s*\(/.test(source)
}

test('workspace creation inherits the app initialization script and never starts another backend', () => {
  const workspace = read('workspace_windows.rs')
  expect(workspace).toContain('.init_script')
  expect(workspace).toContain('.clone()')
  expect(workspace).toContain('workspace_builder::build')
  expect(startsRuntime(workspace)).toBe(false)
  expect(read('lib.rs').match(/\bstart_api\s*\(/g)).toHaveLength(1)
  expect(read('sidecar.rs')).toContain('workspace_windows::views(app)')
})

test('the workspace runtime guard rejects a per-window backend launch', () => {
  expect(startsRuntime('let window = build(); start_api(&app, launch);')).toBe(true)
  expect(startsRuntime('spawn_runtime(app, resources, port, 1)')).toBe(true)
})
