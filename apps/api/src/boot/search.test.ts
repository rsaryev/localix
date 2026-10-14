import { describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../db/connection'
import { migrateToLatest } from '../db/migrator'
import { buildSearchService, type SearchCompositionDeps } from './search'

describe('search composition', () => {
  test('routes chat search through the narrow repository roster', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    let wideRosterCalls = 0
    const chatService = {
      listSessions: async () => {
        wideRosterCalls += 1
        return { sessions: [] }
      },
      searchHistoryDetailed: async () => [],
      findFiles: async () => ({ root: '', files: [] }),
      searchContent: async () => ({ root: '', matches: [] }),
    } as unknown as SearchCompositionDeps['chatService']

    const service = buildSearchService({
      db,
      chatService,
      backendHost: { setSearchRegistry() {} },
      // Named-domain search below never invokes these providers; the composition
      // still registers them so this exercises the same production wiring.
      projectsService: {} as SearchCompositionDeps['projectsService'],
      secretsService: {} as SearchCompositionDeps['secretsService'],
      skillsCuratorService: {} as SearchCompositionDeps['skillsCuratorService'],
      pluginService: {} as SearchCompositionDeps['pluginService'],
      mcpService: {} as SearchCompositionDeps['mcpService'],
      agentsService: {} as SearchCompositionDeps['agentsService'],
      catalogService: {} as SearchCompositionDeps['catalogService'],
    })

    await service.search('user-a', {
      text: 'target',
      domains: ['sessions', 'messages'],
      projectId: null,
    })

    expect(wideRosterCalls).toBe(0)
    await destroyDatabase(db)
  })
})
