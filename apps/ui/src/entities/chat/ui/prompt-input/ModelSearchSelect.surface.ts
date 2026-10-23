import { Waypoints } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export default defineUiLocation({
  id: 'models.picker.open',
  uri: 'localix://ui/picker/model',
  title: 'Model picker',
  description: 'Open the model picker without selecting a model',
  agent: { description: 'Open the model picker without selecting a model' },
  keywords: ['models', 'providers', 'llm'],
  group: 'Application',
  Icon: Waypoints,
  effect: 'read',
  surface: 'picker',
  params: {
    session: {
      type: 'string',
      description: 'Optional chat session id whose model selection is being inspected.',
      optional: true,
      maxLength: 256,
    },
    query: {
      type: 'string',
      description: 'Optional initial model search text.',
      optional: true,
      maxLength: 256,
    },
    provider: {
      type: 'string',
      description: 'Optional provider id used to pre-filter the model list.',
      optional: true,
      maxLength: 128,
    },
  },
  exposure: { search: true, palette: true },
  present: ({ query }) => ({
    label: query ? `Find model “${query}”` : 'Open model picker',
  }),
  resolve: ({ session, query, provider }) => ({
    kind: 'model-picker',
    sessionId: session,
    query,
    providerId: provider,
  }),
})
