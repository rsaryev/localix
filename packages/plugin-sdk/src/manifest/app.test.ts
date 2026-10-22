import { describe, expect, test } from 'bun:test'
import { miniAppManifestSchema } from './app'

describe('miniAppManifestSchema', () => {
  test('a mini app names its plugin and adds what only Localix runs', () => {
    const parsed = miniAppManifestSchema.parse({
      name: 'calories',
      category: 'utilities',
      surfaces: ['agent', 'workbench'],
      backend: './backend/index.ts',
      config: { DAILY_GOAL: { type: 'number', default: 2000 } },
      commands: { log: { featured: true, activateTools: ['calories_log'] } },
    })
    expect(parsed).toMatchObject({
      name: 'calories',
      backend: './backend/index.ts',
      commands: { log: { featured: true } },
    })
    // The plugin's version wins: the mini app does not invent a default one.
    expect(parsed.version).toBeUndefined()
  })

  test('a command key follows the plugin’s command names, and the backend is a path', () => {
    expect(
      miniAppManifestSchema.safeParse({ name: 'x', commands: { 'Bad Name': {} } }).success,
    ).toBe(false)
    expect(miniAppManifestSchema.safeParse({ name: 'x', backend: 3 }).success).toBe(false)
    expect(
      miniAppManifestSchema.safeParse({ name: 'x', commands: { 'db:migrate': {} } }).success,
    ).toBe(true)
  })
})
