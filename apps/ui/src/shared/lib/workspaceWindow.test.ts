import { afterEach, describe, expect, test } from 'bun:test'
import { workspaceStorageKey } from './workspaceWindow'

const original = globalThis.window
afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(globalThis, 'window')
  else
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: original,
    })
})
function context(id?: string): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: id ? { __LOCALIX_WORKSPACE: { id, route: null } } : {},
  })
}
describe('native workspace storage', () => {
  test('browser and original workspace preserve existing saved layouts', () => {
    context()
    expect(workspaceStorageKey('workspace_grid_v2')).toBe('workspace_grid_v2')
    context('main')
    expect(workspaceStorageKey('workspace_grid_v2')).toBe('workspace_grid_v2')
  })
  test('different native workspaces never overwrite each other and reload keeps identity', () => {
    const saved = new Map<string, string>()
    context('workspace-0123456789abcdef')
    saved.set(workspaceStorageKey('workspace_grid_v2'), 'first layout')
    saved.set(workspaceStorageKey('localix_last_workspace'), 'first project')
    context('workspace-fedcba9876543210')
    expect(saved.get(workspaceStorageKey('workspace_grid_v2'))).toBeUndefined()
    saved.set(workspaceStorageKey('workspace_grid_v2'), 'second layout')
    context('workspace-0123456789abcdef')
    expect(saved.get(workspaceStorageKey('workspace_grid_v2'))).toBe('first layout')
    expect(saved.get(workspaceStorageKey('localix_last_workspace'))).toBe('first project')
  })
})
