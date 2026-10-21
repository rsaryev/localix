import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConnectionAuthStatus, UnreadableCredentialNotice } from './ConnectionSettingsPanel'

describe('UnreadableCredentialNotice presentation', () => {
  test('uses the shared warning notice without a warning card surface', () => {
    const html = renderToStaticMarkup(<UnreadableCredentialNotice />)

    expect(html).toContain('lucide-triangle-alert')
    expect(html).toContain('Credential unavailable')
    expect(html).toContain('data-slot="workbench-notice-bar"')
    expect(html).toContain('border-b')
    expect(html).not.toContain('bg-status-warning')
    expect(html).not.toContain('rounded-lg')
  })
})

describe('ConnectionAuthStatus presentation', () => {
  test('renders an available OAuth credential as a flat connected status row', () => {
    const html = renderToStaticMarkup(
      <ConnectionAuthStatus authType="oauth-pkce" credentialAvailable />,
    )

    expect(html).toContain('OAuth connected')
    expect(html).toContain('bg-status-success')
    expect(html).not.toContain('rounded-lg')
    expect(html).not.toContain('bg-muted/30')
  })

  test('does not claim an unreadable API key is connected', () => {
    const html = renderToStaticMarkup(
      <ConnectionAuthStatus authType="api-key" credentialAvailable={false} />,
    )

    expect(html).toContain('API key unavailable')
    expect(html).toContain('bg-status-warning')
    expect(html).not.toContain('API key connected')
  })
})
