import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyState } from './EmptyState'

const source = readFileSync(new URL('./EmptyState.tsx', import.meta.url), 'utf8')

test('empty chat shows the Localix bird above the greeting', () => {
  const html = renderToStaticMarkup(<EmptyState sessionId={null} />)

  expect(html).toContain('What would you like to accomplish?')
  expect(html).toContain('mask-image:url(/logo-dark.svg)')
  expect(html).toContain('wind-sweep')
  expect(html).toContain('text-2xl')
  expect(html).not.toContain('<svg')
  expect(html).not.toContain('fade-up')
  expect(html).not.toContain('text-3xl')
})

test('keeps environment discovery out of the connected chat startup path', () => {
  expect(source).not.toMatch(
    /import\s+\{\s*EnvDetectedProviders\s*\}\s+from\s+['"]\.\/prompt-input\/EnvDetectedProviders['"]/,
  )
  expect(source).toContain("import('./prompt-input/EnvDetectedProviders')")
  expect(source).toContain('!hasConnection && (')
  expect(source).toContain('<Suspense fallback={null}>')
})
