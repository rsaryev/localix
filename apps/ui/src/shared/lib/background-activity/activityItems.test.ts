import { describe, expect, test } from 'bun:test'

import type { DesktopUpdateState } from '@/shared/hooks/useDesktopUpdate'
import type { LocalModelsStatus } from '@/shared/api/localModelsApi'
import { buildActivity, type ActivityOps } from './activityItems'

/** Every action a row can offer, recorded as the call it makes. */
function recordingOps() {
  const calls: string[] = []
  const ops: ActivityOps = {
    openStore: () => void calls.push('store'),
    pauseModel: (id) => void calls.push(`pause ${id}`),
    resumeModel: (id) => void calls.push(`resume ${id}`),
    cancelModel: (id) => void calls.push(`cancel ${id}`),
    updateMiniApps: () => void calls.push('update mini apps'),
    updatePlugins: () => void calls.push('update plugins'),
    openPlugins: () => void calls.push('plugins'),
    restartToUpdate: () => void calls.push('restart'),
  }
  return { ops, calls }
}

const press = (action: { run: () => unknown } | undefined) => void action?.run()

const models = (over: Partial<LocalModelsStatus>): LocalModelsStatus =>
  ({ jobs: [], paused: [], installed: [], running: [], ...over }) as unknown as LocalModelsStatus

const appUpdate = (over: Partial<DesktopUpdateState> = {}): DesktopUpdateState => ({
  available: true,
  message: 'Update 1.5.0 available',
  latestVersion: '1.5.0',
  currentVersion: '1.4.0',
  notes: null,
  installing: false,
  percent: null,
  ...over,
})

describe('what is happening in the background, as rows', () => {
  test('nothing running and nothing offered is nothing to show', () => {
    expect(buildActivity({}, recordingOps().ops)).toEqual({ items: [], updates: [] })
  })

  test('a mini app download: its name, its icon, how far it is, and the store', () => {
    const { ops, calls } = recordingOps()
    const { items } = buildActivity(
      {
        miniApps: {
          jobs: [
            {
              name: 'sample-git',
              displayName: 'Git',
              icon: '/rpc/mini-apps/store/media/sample-git/icon?v=1',
              kind: 'install',
              phase: 'downloading',
              received: 1024,
              total: 4096,
            },
            { name: 'kanban', displayName: 'Kanban', kind: 'install', phase: 'queued' },
          ],
          updates: [],
        },
      },
      ops,
    )
    expect(
      items.map(({ name, status, percent, state, icon }) => ({
        name,
        status,
        percent,
        state,
        icon,
      })),
    ).toEqual([
      {
        name: 'Git',
        status: 'Downloading · 1.0 KB of 4.0 KB',
        percent: 25,
        state: 'running',
        icon: '/rpc/mini-apps/store/media/sample-git/icon?v=1',
      },
      {
        name: 'Kanban',
        status: 'Waiting to install',
        percent: null,
        state: 'waiting',
        icon: undefined,
      },
    ])
    press(items[0]?.actions.find((action) => action.label === 'Open the store'))
    expect(calls).toEqual(['store'])
  })

  test('a model download can be paused or cancelled; a paused one resumed', () => {
    const { ops, calls } = recordingOps()
    const { items } = buildActivity(
      {
        localModels: models({
          jobs: [
            {
              modelId: 'gemma',
              label: 'Gemma 4',
              background: false,
              phase: 'downloading',
              received: 50,
              total: 200,
              rate: null,
              error: null,
            },
          ],
          paused: [
            { modelId: 'nomic', label: 'Nomic Embed', received: 1, total: 4, background: true },
          ],
        }),
      },
      ops,
    )
    expect(items.map(({ name, percent, state }) => ({ name, percent, state }))).toEqual([
      { name: 'Gemma 4', percent: 25, state: 'running' },
      { name: 'Nomic Embed', percent: 25, state: 'paused' },
    ])
    for (const action of [...items[0]!.actions, ...items[1]!.actions]) press(action)
    expect(calls).toEqual(['pause gemma', 'cancel gemma', 'resume nomic', 'cancel nomic'])
  })

  test('the app update: offered with Restart to update, and a row with its percent while it downloads', () => {
    const { ops, calls } = recordingOps()
    const offered = buildActivity({ app: appUpdate() }, ops)
    expect(offered.items).toEqual([])
    expect(offered.updates).toEqual([
      expect.objectContaining({
        id: 'app',
        title: 'Localix 1.5.0',
        detail: 'you have 1.4.0',
        fingerprint: '1.5.0',
      }),
    ])
    press(offered.updates[0]?.action)
    expect(calls).toEqual(['restart'])

    const downloading = buildActivity(
      { app: appUpdate({ installing: true, percent: 42, message: 'Downloading update… 42%' }) },
      ops,
    )
    expect(downloading.items).toEqual([
      expect.objectContaining({
        name: 'Localix 1.5.0',
        status: 'Downloading update… 42%',
        percent: 42,
      }),
    ])
    expect(downloading.updates[0]?.running).toEqual({
      percent: 42,
      status: 'Downloading update… 42%',
    })
  })

  test('mini app and plugin updates are offered as Update all, naming what changes', () => {
    const { ops, calls } = recordingOps()
    const { updates } = buildActivity(
      {
        miniApps: {
          jobs: [],
          updates: [
            { name: 'chess', displayName: 'Chess', from: '1.0.0', to: '1.1.0' },
            { name: 'reader', displayName: 'Reader', from: '0.3.0', to: '0.4.0' },
          ],
        },
        plugins: {
          available: [
            {
              id: 'review@localix',
              name: 'review',
              marketplace: 'localix',
              from: '1.0.0',
              to: '1.1.0',
            },
          ],
          jobs: [],
          lastCheckedAt: null,
        },
      },
      ops,
    )
    expect(
      updates.map(({ id, title, detail, fingerprint }) => ({ id, title, detail, fingerprint })),
    ).toEqual([
      {
        id: 'mini-apps',
        title: '2 mini app updates',
        detail: 'Chess and Reader',
        fingerprint: 'chess@1.1.0,reader@0.4.0',
      },
      {
        id: 'plugins',
        title: '1 plugin update',
        detail: 'review',
        fingerprint: 'review@localix@1.1.0',
      },
    ])
    for (const offer of updates) press(offer.action)
    expect(calls).toEqual(['update mini apps', 'update plugins'])
  })

  test('an update that is running keeps its offer, with its progress, under the same fingerprint', () => {
    const { ops } = recordingOps()
    const { items, updates } = buildActivity(
      {
        miniApps: {
          jobs: [
            {
              name: 'chess',
              displayName: 'Chess',
              kind: 'update',
              version: '1.1.0',
              phase: 'downloading',
              received: 3,
              total: 4,
            },
          ],
          updates: [],
        },
        plugins: {
          available: [],
          jobs: [
            { id: 'review@localix', phase: 'installing' },
            { id: 'lint@localix', phase: 'done' },
          ],
          lastCheckedAt: null,
        },
      },
      ops,
    )
    expect(items.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'Chess', status: 'Downloading 1.1.0 · 3 B of 4 B' },
      { name: 'review', status: 'Installing' },
    ])
    expect(updates.map(({ fingerprint, running }) => ({ fingerprint, running }))).toEqual([
      { fingerprint: 'chess@1.1.0', running: { percent: 75, status: 'Updating Chess · 75%' } },
      {
        fingerprint: 'review@localix',
        running: { percent: 50, status: 'Updating plugins · 1 of 2' },
      },
    ])
  })
})
