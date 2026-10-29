import { describe, expect, test } from 'bun:test'

import type { DesktopUpdateState } from '@/shared/hooks/useDesktopUpdate'
import type { LocalModelsStatus } from '@/shared/api/localModelsApi'
import { buildActivity, type ActivityOps } from './activityItems'

/** Every action a row can offer, recorded as the call it makes. */
function recordingOps() {
  const calls: string[] = []
  const ops: ActivityOps = {
    openStore: (target) =>
      void calls.push(
        `store ${target?.ref ? `${target.ref.kind}/${target.ref.id}` : target?.shelf}`,
      ),
    pauseModel: (id) => void calls.push(`pause ${id}`),
    resumeModel: (id) => void calls.push(`resume ${id}`),
    cancelModel: (id) => void calls.push(`cancel ${id}`),
    updateStore: () => void calls.push('update store'),
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

  test('a Store download: its name, its icon, how far it is, and its page in the Store', () => {
    const { ops, calls } = recordingOps()
    const { items } = buildActivity(
      {
        store: {
          jobs: [
            {
              ref: { kind: 'mini-app', id: 'sample-git' },
              displayName: 'Sync',
              icon: '/rpc/mini-apps/store/media/sample-git/icon?v=1',
              action: 'install',
              phase: 'downloading',
              received: 1024,
              total: 4096,
            },
            {
              ref: { kind: 'plugin', id: 'review@localix' },
              displayName: 'Review',
              action: 'install',
              phase: 'queued',
            },
            {
              ref: { kind: 'plugin', id: 'lint@localix' },
              displayName: 'Lint',
              action: 'remove',
              phase: 'installing',
            },
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
        name: 'Sync',
        status: 'Downloading · 1.0 KB of 4.0 KB',
        percent: 25,
        state: 'running',
        icon: '/rpc/mini-apps/store/media/sample-git/icon?v=1',
      },
      {
        name: 'Review',
        status: 'Waiting to install',
        percent: null,
        state: 'waiting',
        icon: undefined,
      },
      { name: 'Lint', status: 'Removing', percent: null, state: 'running', icon: undefined },
    ])
    press(items[1]?.actions.find((action) => action.label === 'Open in the Store'))
    expect(calls).toEqual(['store plugin/review@localix'])
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

  test('the Store’s updates, of every kind, are one offer with Update all, naming what changes', () => {
    const { ops, calls } = recordingOps()
    const { updates } = buildActivity(
      {
        store: {
          jobs: [],
          updates: [
            { ref: { kind: 'mini-app', id: 'sample-viewer' }, displayName: 'Viewer', to: '0.4.0' },
            { ref: { kind: 'mini-app', id: 'sample-puzzle' }, displayName: 'Puzzle', to: '1.1.0' },
            { ref: { kind: 'plugin', id: 'review@localix' }, displayName: 'Review', to: '1.1.0' },
          ],
        },
      },
      ops,
    )
    expect(
      updates.map(({ id, title, detail, fingerprint }) => ({ id, title, detail, fingerprint })),
    ).toEqual([
      {
        id: 'store',
        title: '3 updates',
        detail: 'Puzzle, Viewer and Review',
        fingerprint:
          'mini-app:sample-puzzle@1.1.0,mini-app:sample-viewer@0.4.0,plugin:review@localix@1.1.0',
      },
    ])
    press(updates[0]?.action)
    expect(calls).toEqual(['update store'])
  })

  test('updates of one kind say which kind', () => {
    const { updates } = buildActivity(
      {
        store: {
          jobs: [],
          updates: [
            { ref: { kind: 'plugin', id: 'review@localix' }, displayName: 'Review', to: '1.1.0' },
          ],
        },
      },
      recordingOps().ops,
    )
    expect(updates[0]?.title).toBe('1 plugin update')
  })

  test('an update that is running keeps its offer, with its progress, under the same fingerprint', () => {
    const { items, updates } = buildActivity(
      {
        store: {
          jobs: [
            {
              ref: { kind: 'mini-app', id: 'sample-puzzle' },
              displayName: 'Puzzle',
              action: 'update',
              version: '1.1.0',
              phase: 'downloading',
              received: 3,
              total: 4,
            },
          ],
          updates: [],
        },
      },
      recordingOps().ops,
    )
    expect(items.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'Puzzle', status: 'Downloading 1.1.0 · 3 B of 4 B' },
    ])
    expect(
      updates.map(({ title, fingerprint, running }) => ({ title, fingerprint, running })),
    ).toEqual([
      {
        title: '1 mini app update',
        fingerprint: 'mini-app:sample-puzzle@1.1.0',
        running: { percent: 75, status: 'Updating Puzzle · 75%' },
      },
    ])
  })
})
