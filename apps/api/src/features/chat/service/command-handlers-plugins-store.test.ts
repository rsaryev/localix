import { describe, expect, test } from 'bun:test'
import type { InstallPlan, SourceView } from '@localixai/store'

import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { handlePluginsControlCommand } from './command-handlers-plugins'
import { handleMarketplaceSubcommand } from './command-handlers-plugins-marketplace'

/**
 * `/plugin install` and `/plugin marketplace add` go through the Store, as the Store screen's
 * Install and Add source do: the plan is read first, and a plan that needs consent is installed
 * only once the person says so (`--yes`), where the screen asks with a button.
 */

const session = { id: 'session', projectId: 'p1' } as unknown as SessionRecord

const plan = (over: Partial<InstallPlan> = {}): InstallPlan => ({
  scope: 'user',
  adds: [{ kind: 'skill', name: 'review' }],
  runs: [],
  network: [],
  requires: [],
  warnings: [],
  needsConsent: false,
  ...over,
})
const source = (id: string, count = 3): SourceView => ({
  kind: 'plugin',
  id,
  label: id,
  url: `https://example.test/${id}`,
  builtIn: false,
  count,
})

function harness(opts: { plan?: InstallPlan; sources?: SourceView[][] } = {}) {
  const calls: unknown[][] = []
  const lists = [...(opts.sources ?? [[]])]
  const store = {
    plan: async (...args: unknown[]) => (calls.push(['plan', ...args]), opts.plan ?? plan()),
    install: async (...args: unknown[]) => void calls.push(['install', ...args]),
    sources: async () => ({
      sources: lists.length > 1 ? lists.shift()! : lists[0]!,
      addable: ['plugin' as const],
    }),
    addSource: async (...args: unknown[]) => void calls.push(['addSource', ...args]),
  }
  const direct: unknown[] = []
  const pluginService = {
    install: async (_user: string, input: unknown) => {
      direct.push(input)
      return { name: 'review', version: '1.0.0', provides: {} }
    },
    addMarketplace: async () => {
      throw new Error('the plugin service was used directly')
    },
  }
  const say = async (prompt: string, withStore = true) => {
    let text = ''
    const ctx = { pluginService, deps: withStore ? { store } : {} }
    await handlePluginsControlCommand(ctx as never, 'user', session, prompt, async (value) => {
      text = value
      return {} as MessageMutationResponse
    })
    return text
  }
  const marketplace = async (tokens: string[]) => {
    let text = ''
    await handleMarketplaceSubcommand(
      { pluginService, deps: { store } } as never,
      'user',
      tokens,
      async (value) => {
        text = value
        return {} as MessageMutationResponse
      },
    )
    return text
  }
  return { calls, direct, say, marketplace }
}
const ref = { kind: 'plugin', id: 'review@market' }

describe('/plugin install through the Store', () => {
  test('reads the plan, then queues the install for the person', async () => {
    const h = harness()
    const text = await h.say('/plugin install review@market')
    expect(h.calls).toEqual([
      ['plan', ref, 'user', { userId: 'user', projectId: 'p1' }],
      ['install', ref, 'user', { plan: false }, { userId: 'user', projectId: 'p1' }],
    ])
    expect(h.direct).toEqual([])
    expect(text).toContain('Install of `review@market` started')
  })

  test('--project installs for this chat’s project', async () => {
    const h = harness()
    await h.say('/plugin install review@market --project')
    expect(h.calls.at(-1)?.slice(0, 4)).toEqual(['install', ref, 'project', { plan: false }])
  })

  test('a plan that needs consent is shown, and installs nothing until --yes', async () => {
    const h = harness({
      plan: plan({
        runs: [{ kind: 'hook', name: 'fmt', command: 'fmt --all' }],
        warnings: ['It runs programs on this computer'],
        needsConsent: true,
      }),
    })
    const text = await h.say('/plugin install review@market')
    expect(h.calls.map((call) => call[0])).toEqual(['plan'])
    expect(text).toContain('fmt --all')
    expect(text).toContain('It runs programs on this computer')
    expect(text).toContain('/plugin install review@market --yes')

    await h.say('/plugin install review@market --yes')
    expect(h.calls.at(-1)?.slice(0, 4)).toEqual(['install', ref, 'user', { plan: true }])
  })

  test('--marketplace adds the source first and installs from the marketplace it made', async () => {
    const h = harness({ sources: [[], [source('market')]] })
    await h.say('/plugin install review --marketplace owner/market')
    expect(h.calls.map((call) => call[0])).toEqual(['addSource', 'plan', 'install'])
    expect(h.calls[0]).toEqual(['addSource', 'plugin', 'owner/market'])
    expect(h.calls.at(-1)?.slice(0, 3)).toEqual(['install', ref, 'user'])
    expect(h.direct).toEqual([])
  })

  test('a failure of the Store is the reply', async () => {
    let said = ''
    const store = {
      plan: async () => {
        throw new Error('No plugin "review@market" in the Store')
      },
    }
    await handlePluginsControlCommand(
      { pluginService: {}, deps: { store } } as never,
      'user',
      session,
      '/plugin install review@market',
      async (value) => {
        said = value
        return {} as MessageMutationResponse
      },
    )
    expect(said).toBe('Install failed: No plugin "review@market" in the Store')
  })

  test('a git address, owner/repo or folder is not a Store listing and installs as it did', async () => {
    const h = harness()
    for (const source of ['owner/review', 'https://git.test/r.git', '/abs/path']) {
      await h.say(`/plugin install ${source}`)
    }
    expect(h.calls).toEqual([])
    expect(h.direct).toHaveLength(3)
  })

  test('with no Store composed it says so rather than going around it', async () => {
    const h = harness()
    expect(await h.say('/plugin install review@market', false)).toContain('Store is not available')
    expect(h.direct).toEqual([])
  })
})

describe('/plugin marketplace add through the Store', () => {
  test('adds the source in the Store and names what it made', async () => {
    const h = harness({ sources: [[source('old')], [source('old'), source('market', 7)]] })
    const text = await h.marketplace(['plugin', 'marketplace', 'add', 'owner/market'])
    expect(h.calls).toEqual([['addSource', 'plugin', 'owner/market']])
    expect(text).toContain('Added marketplace `market` (7 plugins)')
    expect(text).toContain('/plugin install <name>@market')
  })
})
