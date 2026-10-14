import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./PluginsSettings.tsx', import.meta.url), 'utf8')

test('a shared sidecar outage produces one plugin registry error', () => {
  expect(source).toContain(
    'const registryAuthoritative = plugins.length > 0 || (!loading && !error)',
  )
  expect(source).toContain(
    '!scope && registryAuthoritative && <MarketplacesPanel onChanged={refresh} />',
  )
})
