import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Composition-root fences. Source-level on purpose: these are structural claims about
 * WHERE things are mounted, and the composition root has no seam to render in a test.
 *
 * The rule they must follow, learned by mutation — the previous version passed the one
 * below: assert the ELEMENT, never the bare name. `toContain('ChatPage')` matched the
 * import line AND two prose comments that merely mention ChatPage, so replacing
 * `<ChatPage />` with `<div />` — a completely blank app — kept it 2-pass-0-fail.
 *
 * The negative fences (`not.toContain`) are the good kind: reintroducing chat behavior
 * into the composition root is exactly what makes them red.
 */

const read = (rel: string) => readFileSync(resolve(import.meta.dir, rel), 'utf8')

describe('app composition root', () => {
  it('renders the router provider', () => {
    // Mutation this must catch: dropping <RouterProvider> while keeping the import.
    expect(read('./App.tsx')).toMatch(/<RouterProvider\b/)
  })

  it('shares one tooltip delay group across workbench actions', () => {
    const source = read('./App.tsx')
    expect(source).toMatch(/<TooltipProvider\b/)
    expect(source).toMatch(/<TooltipProvider>[\s\S]*<RouterProvider\b/)
  })

  it('mounts ChatPage as an ELEMENT through the router', () => {
    // Mutation this must catch: `const chatElement = <div />`. The old
    // `toContain('ChatPage')` passed that mutation — it was matching the import
    // statement and the comments, not the thing actually being rendered.
    expect(read('./routing/router.tsx')).toMatch(/<ChatPage\s*\/>/)
  })

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
    const source = read('./main.tsx')
    const registration = source.indexOf('registerAgentRunPreflight(waitForRuntimeCapabilities)')
    const render = source.indexOf('createRoot(')
    expect(registration).toBeGreaterThan(-1)
    expect(render).toBeGreaterThan(registration)
  })
})
