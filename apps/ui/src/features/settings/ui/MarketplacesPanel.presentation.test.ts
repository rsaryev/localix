import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./MarketplacesPanel.tsx', import.meta.url), 'utf8')

describe('marketplace loading presentation', () => {
  test('does not expose the add form while the marketplace inventory is unknown', () => {
    expect(source).toContain('errors={loadError ? [loadError] : []}')
    expect(source).toContain('onRetry={retryLoad}')
    expect(source).toContain('markets !== null && (')
  })

  test('keeps load failures distinct from add and remove failures', () => {
    expect(source).toContain('const [loadError, setLoadError]')
    expect(source).toContain('const [mutationError, setMutationError]')
    expect(source).not.toContain('const [error, setError]')
  })

  test('keeps startup retries inside the loading state before surfacing a failure', () => {
    expect(source).toContain('startStartupRetry((failureIndex)')
    expect(source).toContain('load(shouldSurfaceStartupFailure(failureIndex))')
  })
})
