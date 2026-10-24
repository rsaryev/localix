import { describe, expect, test } from 'bun:test'

import type { MessageMutationResponse } from '../contracts'
import { handleMarketplaceSubcommand } from './command-handlers-plugins-marketplace'

type Ctx = Parameters<typeof handleMarketplaceSubcommand>[0]

function run(tokens: string[], pluginService: Partial<Ctx['pluginService']>) {
  let said = ''
  const reply = async (text: string) => {
    said = text
    return {} as MessageMutationResponse
  }
  return handleMarketplaceSubcommand(
    { pluginService: pluginService as Ctx['pluginService'] },
    'u1',
    tokens,
    reply,
  ).then(() => said)
}

describe('/plugin marketplace update', () => {
  test('with no name refreshes every listing and updates no plugin, as in Claude Code', async () => {
    const said = await run(['plugin', 'marketplace', 'update'], {
      refreshMarketplaces: async () => ({
        refreshed: ['localix', 'acme'],
        updated: [],
        manual: [],
        warnings: [],
      }),
    })
    expect(said).toContain('`localix`, `acme`')
    expect(said).toContain('Installed plugins keep their versions')
  })

  test('with a name names the plugins it left for the person to update', async () => {
    const said = await run(['plugin', 'marketplace', 'update', 'acme'], {
      updateMarketplace: async () => ({
        name: 'acme',
        count: 2,
        updated: ['tool'],
        manual: ['gated'],
        warnings: [],
      }),
    })
    expect(said).toContain('`tool`')
    expect(said).toContain('Update these yourself: `gated`')
  })
})
