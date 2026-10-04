import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EnvDetectedProviderRow } from './EnvDetectedProviders'

const provider = {
  providerId: 'openai',
  providerName: 'OpenAI',
  envVar: 'OPENAI_API_KEY',
}

describe('EnvDetectedProviderRow presentation', () => {
  test('renders a flat registry row instead of a success card', () => {
    const html = renderToStaticMarkup(
      <EnvDetectedProviderRow provider={provider} onConnect={() => {}} />,
    )

    expect(html).toContain('OPENAI_API_KEY')
    expect(html).toContain('Connect')
    expect(html).not.toContain('rounded-xl')
    expect(html).not.toContain('bg-status-success')
    expect(html).not.toContain('border-status-success')
  })

  test('shows the shared activity indicator and a readable status while connecting', () => {
    const html = renderToStaticMarkup(
      <EnvDetectedProviderRow provider={provider} disabled isConnecting onConnect={() => {}} />,
    )

    expect(html).toContain('lx-activity-orb')
    expect(html).toContain('Connecting')
  })
})
