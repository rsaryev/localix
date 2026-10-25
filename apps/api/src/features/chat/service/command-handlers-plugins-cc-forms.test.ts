import { describe, expect, test } from 'bun:test'
import type { InstallPlan } from '@localixai/store'

import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { handlePluginsControlCommand } from './command-handlers-plugins'

/**
 * People paste the commands Claude Code's docs and claude.com/marketplace print
 * (`discover-plugins.md`): `name@marketplace` everywhere, `--scope user|project|local`, the
 * `uninstall` spelling and `/plugin market`. Each must do in Localix what it does there.
 */

const session = { id: 'session', projectId: 'p1' } as unknown as SessionRecord
const plan: InstallPlan = {
  scope: 'user',
  adds: [],
  runs: [],
  network: [],
  requires: [],
  warnings: [],
  needsConsent: false,
}

function harness() {
  const calls: unknown[][] = []
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args.slice(1)])
      return { name: 'formatter', version: '1.0.0', provides: {}, warnings: [] }
    }
  const pluginService = {
    remove: record('remove'),
    setEnabled: record('setEnabled'),
    update: record('update'),
    install: record('install'),
  }
  const store = {
    plan: async () => plan,
    install: async (...args: unknown[]) => void calls.push(['store.install', ...args.slice(0, 2)]),
    sources: async () => ({ sources: [], addable: ['plugin' as const] }),
    addSource: async (...args: unknown[]) => void calls.push(['store.addSource', ...args]),
  }
  const say = async (prompt: string) => {
    let text = ''
    await handlePluginsControlCommand(
      { pluginService, deps: { store } } as never,
      'user',
      session,
      prompt,
      async (value) => {
        text = value
        return {} as MessageMutationResponse
      },
    )
    return text
  }
  return { calls, say }
}

describe('Claude Code plugin commands, pasted', () => {
  test('--scope picks the install scope; local is this project, the nearest Localix has', async () => {
    const h = harness()
    await h.say('/plugin install formatter@your-org --scope project')
    await h.say('/plugin install formatter@your-org --scope user')
    await h.say('/plugin install formatter@your-org --scope local')
    expect(h.calls).toEqual([
      ['store.install', { kind: 'plugin', id: 'formatter@your-org' }, 'project'],
      ['store.install', { kind: 'plugin', id: 'formatter@your-org' }, 'user'],
      ['store.install', { kind: 'plugin', id: 'formatter@your-org' }, 'project'],
    ])
  })

  test('uninstall, enable, disable and update take name@marketplace', async () => {
    const h = harness()
    await h.say('/plugin uninstall formatter@your-org')
    await h.say('/plugin disable formatter@your-org')
    await h.say('/plugin enable formatter@your-org')
    await h.say('/plugin update formatter@your-org')
    expect(h.calls.map(([name, input]) => [name, (input as { name: string }).name])).toEqual([
      ['remove', 'formatter'],
      ['setEnabled', 'formatter'],
      ['setEnabled', 'formatter'],
      ['update', 'formatter'],
    ])
  })

  test('/plugin market is /plugin marketplace, and a pinned #ref reaches the Store whole', async () => {
    const h = harness()
    await h.say('/plugin market add your-org/plugins#v1.2.0')
    expect(h.calls).toEqual([['store.addSource', 'plugin', 'your-org/plugins#v1.2.0']])
  })
})
