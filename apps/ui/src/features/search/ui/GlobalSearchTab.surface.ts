import { Search } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'
import { scopeById } from '../model/scopes'

export default defineUiLocation({
  id: 'search.open',
  uri: 'localix://ui/work-item/global-search',
  title: 'Global search',
  description: 'Search across Localix',
  agent: { description: 'Search across Localix' },
  keywords: ['find', 'everything', 'spotlight'],
  group: 'Application',
  Icon: Search,
  effect: 'read',
  surface: 'work-item',
  params: {
    query: {
      type: 'string',
      description: 'Optional initial search text.',
      optional: true,
      maxLength: 512,
    },
    scope: {
      type: 'string',
      description: 'Optional search provider scope returned by Localix search metadata.',
      optional: true,
      maxLength: 64,
    },
  },
  exposure: { search: true },
  present: ({ query }) => ({
    label: query ? `Search for “${query}”` : 'Open global search',
  }),
  resolve: ({ query, scope }) => {
    if (scope && !scopeById(scope)) return null
    return {
      kind: 'inspector',
      target: 'global-search',
      query,
      searchScope: scope,
    }
  },
})
