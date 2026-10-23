import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('UI build cache inputs', () => {
  test('invalidates the production bundle when an external plugin UI changes', () => {
    const config = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../../turbo.json'), 'utf8'),
    ) as {
      tasks?: { build?: { inputs?: string[] } }
    }

    expect(config.tasks?.build?.inputs).toContain('$TURBO_ROOT$/mini-apps/**/ui/**')
    expect(config.tasks?.build?.inputs).toContain('$TURBO_ROOT$/mini-apps/**/backend/**')
  })
})
