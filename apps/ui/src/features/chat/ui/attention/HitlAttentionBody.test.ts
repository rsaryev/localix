import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./HitlAttentionBody.tsx', import.meta.url), 'utf8')

test('keeps the interaction renderer off the no-request startup path', () => {
  expect(source).not.toMatch(
    /import\s+\{\s*ChatInteractionOverlay\s*\}\s+from\s+['"][./]*hitl\/ChatInteractionOverlay['"]/,
  )
  expect(source).toContain("import('../hitl/ChatInteractionOverlay')")
  expect(source).toMatch(/<Suspense\s+fallback=/)
  expect(source).toContain('<ChatInteractionOverlay')
})

test('uses the shared compact dialog header as an eyebrow above the request', () => {
  expect(source).toContain('<DialogHeader')
  expect(source).toContain('actionsLabel="Background request actions"')
  expect(source).toContain('border-b border-border-soft px-4 py-2')
  expect(source).toContain('text-2xs font-medium')
})

test('renders the interaction in the dialog chrome, not the transcript card chrome', () => {
  // Without this the frame keeps the compact in-chat padding and its own seam weight inside a
  // modal — the "two surfaces stacked" look this dialog is meant not to have.
  expect(source).toContain("chrome={embedded ? 'compact' : 'dialog'}")
})

test('the agent island renders the same body without a dialog around it', () => {
  expect(source).toMatch(/if \(embedded\)\s*return \(\s*<section aria-label=\{sessionTitle\}>/)
})
