import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Composition-root fences: a negative fence keeping chat behavior out of the root, and the
 * ordering of the agent-run policy barrier against the first render.
 */

const read = (rel: string) => readFileSync(resolve(import.meta.dir, rel), 'utf8')

describe('app composition root', () => {
  it('keeps chat behavior out of the composition root', () => {
    for (const file of ['./App.tsx', './routing/router.tsx', './RootLayout.tsx']) {
      const source = read(file)
      expect(source).not.toContain('useAutoScroll')
      expect(source).not.toContain('Scroll to bottom')
      expect(source).not.toContain('PromptInput')
      expect(source).not.toContain('MessageList')
    }
  })

  it('installs the agent-run policy barrier before the first render', () => {
    const source = read('./workspaceEntry.tsx')
    const registration = source.indexOf('registerAgentRunPreflight(waitForRuntimeCapabilities)')
    const render = source.indexOf('createRoot(')
    expect(registration).toBeGreaterThan(-1)
    expect(render).toBeGreaterThan(registration)
  })
})
