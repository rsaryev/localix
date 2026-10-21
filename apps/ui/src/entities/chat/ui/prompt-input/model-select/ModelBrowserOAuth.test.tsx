import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ProviderConnection } from '@/shared/api/contracts'
import type { useConnections } from '../useConnections'
import { ModelBrowser } from './ModelBrowser'

test('returning from OAuth previews the exact connection among two accounts at the same provider', () => {
  const personal: ProviderConnection = {
    id: 'openai-personal',
    providerId: 'openai',
    providerName: 'OpenAI',
    label: 'Personal account',
    authType: 'oauth-pkce',
    hasApiKey: true,
    keyCount: 1,
    keys: [],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  }
  const work = { ...personal, id: 'openai-work', label: 'Work account' }
  const connectionsState: ReturnType<typeof useConnections> = {
    connections: [personal, work],
    activeConnection: personal,
    activeId: personal.id,
    addApiKeyConnection: async () => work,
    addOAuthConnection: async () => ({ mode: 'local-server' }),
    remove: async () => {},
    updateLabel: async () => {},
    updateSettings: async () => {},
    addKey: async () => {},
    removeKey: async () => {},
    updateKey: async () => {},
  }
  const html = renderToStaticMarkup(
    <ModelBrowser
      models={[]}
      connectionsState={connectionsState}
      sessionModelId=""
      sessionConnectionId={personal.id}
      onPickSessionModel={() => {}}
      initialProviderId="openai"
      initialConnectionId={work.id}
      taskColumn={false}
    />,
  )
  const modelPanel = html.slice(html.indexOf('data-slot="model-browser-main-panel"'))
  expect(modelPanel).toContain('Work account actions')
  expect(modelPanel).not.toContain('Personal account actions')
  expect(modelPanel).toContain('Search models')
})
