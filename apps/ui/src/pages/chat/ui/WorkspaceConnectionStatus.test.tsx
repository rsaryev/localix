import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceConnectionStatus } from './WorkspaceConnectionStatus'

describe('WorkspaceConnectionStatus', () => {
  test('distinguishes a browser connection from desktop startup', () => {
    const html = renderToStaticMarkup(
      <WorkspaceConnectionStatus
        hasHydrated={false}
        error={null}
        runtimeState={undefined}
        onRetry={() => {}}
      />,
    )
    expect(html).toContain('Connecting to the local service')
    expect(html).not.toContain('<button')
    expect(html).toContain('aria-live="polite"')
  })

  test('offers a workspace retry for a failed data load', () => {
    const html = renderToStaticMarkup(
      <WorkspaceConnectionStatus
        hasHydrated={false}
        error={new Error('Offline')}
        runtimeState="ready"
        onRetry={() => {}}
      />,
    )
    expect(html).toContain('aria-label="Workspace data could not be loaded. Retry"')
    expect(html).not.toContain('Restart Localix')
  })
})
