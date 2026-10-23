import { describe, expect, test } from 'bun:test'
import type { MiniAppTextInputCompletionSurface } from '@localixai/mini-app-sdk/backend'

import { createTextInputSurfaceRegistry } from './surface-registry'

const surface = (id: string): MiniAppTextInputCompletionSurface => ({
  id,
  resolveContext: async () => [],
  actionable: () => true,
  buildFragment: () => '',
  instruction: () => 'a suffix',
  clean: (raw) => raw,
})

describe('text-input surface registry', () => {
  test('two mini apps contribute surfaces side by side', () => {
    const registry = createTextInputSurfaceRegistry()
    expect(registry.register(surface('git.commit'), { miniApp: 'git', source: 'git:scm' })).toEqual(
      {
        status: 'registered',
      },
    )
    expect(registry.register(surface('db.query'), { miniApp: 'db', source: 'db:console' })).toEqual(
      {
        status: 'registered',
      },
    )
    expect(registry.get('git.commit')?.id).toBe('git.commit')
    expect(registry.get('db.query')?.id).toBe('db.query')
  })

  test("a mini app cannot answer for another mini app's field or a bare id", () => {
    const registry = createTextInputSurfaceRegistry()
    for (const id of ['git.commit', 'chat', 'db.', 'dbx.query'])
      expect(registry.register(surface(id), { miniApp: 'db', source: 'db:console' })).toEqual({
        status: 'rejected',
        reason: 'namespace',
      })
  })

  test('disabling a mini app removes only the surfaces its subsystem registered', () => {
    const registry = createTextInputSurfaceRegistry()
    registry.register(surface('git.commit'), { miniApp: 'git', source: 'git:scm' })
    expect(
      registry.register(surface('git.commit'), { miniApp: 'git', source: 'git:other' }),
    ).toEqual({ status: 'rejected', reason: 'duplicate' })
    registry.unregisterBySource('git:other')
    expect(registry.get('git.commit')).toBeDefined()
    registry.unregisterBySource('git:scm')
    expect(registry.get('git.commit')).toBeUndefined()
  })
})
