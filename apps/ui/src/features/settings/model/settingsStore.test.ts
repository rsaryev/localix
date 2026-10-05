import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'

import type { useSettingsStore as UseSettingsStore } from './settingsStore'
import { toProfileWirePatch } from './settingsProfilePatch'

/**
 * REGRESSION — a stale `localStorage` blob could overwrite NEWER server `agentSettings`.
 *
 * The ordering that made it happen (all three steps are routine, none is exotic):
 *
 *   1. The store seeds SYNCHRONOUSLY from `localStorage` at module load, and `RootLayout`
 *      renders the app WITHOUT gating on `synced` — so Settings is interactive on
 *      local-only state while the profile GET is still in flight.
 *   2. The user edits a setting. `update()` writes the store + localStorage, puts the whole
 *      patch in `_pending`, and arms an 800ms debounce.
 *   3. `loadFromBackend()` resolves INSIDE that window. It correctly let the server win in
 *      the store — but nothing reconciled `_pending`. The timer then fired and PATCHed the
 *      pre-server blob.
 *
 * Result: the store (and the screen) showed the server's settings while the server was
 * handed the stale local ones. Silent — the flush even swallows its own errors. And because
 * `user/service.ts` `updateProfile` does `agent_settings = JSON.stringify(patch)` — a
 * WHOLESALE REPLACE with no key merge — the stale blob DESTROYED every agentSettings key
 * another tab or device had set.
 *
 * The fix is a sync barrier + a pre-sync flush hold. These tests pin BOTH directions of the
 * precedence rule, because a naive "server always wins" would fix the clobber by throwing
 * away legitimate un-synced local edits instead:
 *
 *   - server HAS a value → server wins, pending flush for that key is DROPPED.
 *   - server has NO value → local survives AND still reaches the server.
 *
 * And the residual third case, closed here: a FAILED profile GET is not a sync. It stays
 * unsynced and HOLDS the pending patch — flushing a base we never confirmed against the
 * server is exactly the wholesale-replace clobber the barrier exists to prevent.
 */

const getUserProfile = mock(async () => ({}) as Record<string, unknown>)
const updateUserProfile = mock(async (_p: Record<string, unknown>) => ({}))

// `mock.module` REPLACES a module process-wide for every suite in the same `bun test`
// run, so the factory must re-export everything the real module does — otherwise sibling
// suites lose unrelated exports (`applyStreamEventToSession`, `API_BASE_URL`, …) and die
// with a SyntaxError. Spread the real module and override ONLY the two profile calls.
const realClient = await import('@/shared/api/client')
await mock.module('@/shared/api/client', () => ({
  ...realClient,
  backendClient: { ...realClient.backendClient, getUserProfile, updateUserProfile },
}))

const LS_KEY = 'localix_user_settings_v2'
const DEBOUNCE_MS = 800
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))
const isAgentSettingsMutation = (patch: Record<string, unknown>) =>
  'agentSettings' in patch || 'agentSettingsPatch' in patch
const isUiSettingsMutation = (patch: Record<string, unknown>) =>
  'uiSettings' in patch || 'uiSettingsPatch' in patch

/** In-memory localStorage backing the guarded shared storage util under `bun test`
 *  (no DOM needed) — same shim the notifications-persist suite uses. */
class FakeStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v)
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
}

/** Fresh module instance per test — the store seeds from localStorage at import time. */
async function freshStore(localBlob: Record<string, unknown> | null) {
  if (localBlob) localStorage.setItem(LS_KEY, JSON.stringify(localBlob))
  else localStorage.removeItem(LS_KEY)
  // Bust the module cache so `loadLocal()` re-runs against the blob we just wrote.
  const mod = await import(`./settingsStore?fresh=${Math.random()}`)
  return (mod as { useSettingsStore: typeof UseSettingsStore }).useSettingsStore
}

beforeEach(() => {
  getUserProfile.mockClear()
  updateUserProfile.mockClear()
  installTestLocalStorage(new FakeStorage())
})
afterEach(() => {
  removeTestLocalStorage()
})

describe('a stale local blob never overwrites newer server agentSettings', () => {
  test('retired task routes cannot block ordinary chat model selection', async () => {
    const store = await freshStore({
      agentSettings: {
        modelRouting: {
          removedRoute: { modelId: 'retired-model' },
          session: { reasoningEffort: 'low' },
        },
      },
    })
    expect(store.getState().settings.agentSettings.modelRouting).toStrictEqual({
      session: { reasoningEffort: 'low' },
    })

    getUserProfile.mockImplementation(async () => ({ agentSettings: null, name: null }))
    await store.getState().loadFromBackend()
    const base = store.getState().settings.agentSettings
    store.getState().update({
      agentSettings: {
        ...base,
        modelRouting: {
          ...base.modelRouting,
          session: { reasoningEffort: 'high' },
        },
      },
    })
    await store.getState().flush()

    expect(updateUserProfile.mock.calls.at(-1)?.[0]?.agentSettingsPatch).toStrictEqual({
      modelRouting: { session: { reasoningEffort: 'high' } },
    })
    expect(store.getState().settings.agentSettings.modelRouting).toStrictEqual({
      session: { reasoningEffort: 'high' },
    })

    // A pending retry created before this release is sanitized at the wire boundary too.
    const poisoned = {
      modelRouting: {
        removedRoute: { modelId: 'retired-model' },
        session: { reasoningEffort: 'high' as const },
      },
    }
    expect(toProfileWirePatch({}, {}, poisoned).agentSettingsPatch).toStrictEqual({
      modelRouting: { session: { reasoningEffort: 'high' } },
    })
    const retiredOnly = { modelRouting: { removedRoute: { modelId: 'retired' } } }
    expect(
      toProfileWirePatch(
        {},
        {},
        retiredOnly as unknown as Parameters<typeof toProfileWirePatch>[2],
      ),
    ).toStrictEqual({})
  })

  test('THE BUG: an edit in flight when the server load lands must not flush the stale base', async () => {
    // Local cache is STALE: it knows `gitBlame`, and nothing else.
    const store = await freshStore({ agentSettings: { gitBlame: { enabled: true } } })

    // The server is NEWER — another tab disabled a tool and turned gitBlame off.
    getUserProfile.mockImplementation(async () => ({
      agentSettings: { gitBlame: { enabled: false }, contextExclusions: ['**/.env'] },
    }))

    // (2) The user toggles something BEFORE the profile GET resolves. The patch is built
    // from the stale local base, exactly as the real Settings UI builds it.
    const stale = store.getState().settings.agentSettings
    store.getState().update({ agentSettings: { ...stale, maxTurns: 5 } })

    // (3) The server load lands inside the 800ms debounce window.
    await store.getState().loadFromBackend()

    // …and the debounce comes due afterwards.
    await tick(DEBOUNCE_MS + 100)

    // The store shows the server's settings (it always did).
    expect(store.getState().settings.agentSettings).toStrictEqual({
      gitBlame: { enabled: false },
      contextExclusions: ['**/.env'],
    })

    // THE ASSERTION THAT USED TO FAIL: the stale blob must never have been PATCHed. Before
    // the fix this fired with { gitBlame: { enabled: true }, maxTurns: 5 } — which, because the
    // server replaces agent_settings wholesale, would have DELETED `contextExclusions` outright.
    const agentPatches = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(agentPatches).toStrictEqual([])
  })

  test('a SLOW server: the debounce comes due BEFORE the load lands — the patch is HELD', async () => {
    // The other half of the fix. If the profile GET is slower than the 800ms debounce, the
    // timer fires while the store still holds nothing but the localStorage cache. Flushing
    // then would push the stale blob to the server BEFORE we have any idea what the server
    // holds — the same clobber, just earlier. So a pre-sync flush is HELD, and the sync
    // barrier decides its fate once the server actually answers.
    const store = await freshStore({ agentSettings: { gitBlame: { enabled: true } } })
    getUserProfile.mockImplementation(async () => {
      await tick(DEBOUNCE_MS + 300) // slower than the debounce
      return { agentSettings: { contextExclusions: ['**/.env'] } }
    })

    store.getState().update({ agentSettings: { gitBlame: { enabled: true }, maxTurns: 5 } })
    const load = store.getState().loadFromBackend()

    // The debounce comes due here, with the GET still in flight.
    await tick(DEBOUNCE_MS + 100)
    expect(store.getState().synced).toBe(false)
    const sentWhileUnsynced = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(sentWhileUnsynced).toStrictEqual([]) // held, not sent

    await load
    await tick(50)

    // The server had a value → it supersedes the held patch, which is dropped, never sent.
    expect(store.getState().settings.agentSettings).toStrictEqual({
      contextExclusions: ['**/.env'],
    })
    const everSent = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(everSent).toStrictEqual([])
  })

  test('the store and the server never disagree about agentSettings', async () => {
    // The real damage was DIVERGENCE: screen said one thing, server held another.
    const store = await freshStore({ agentSettings: { gitBlame: { enabled: true } } })
    getUserProfile.mockImplementation(async () => ({
      agentSettings: { contextExclusions: ['**/.env'] },
    }))

    store.getState().update({ agentSettings: { gitBlame: { enabled: true }, maxTurns: 9 } })
    await store.getState().loadFromBackend()
    await tick(DEBOUNCE_MS + 100)

    const onScreen = store.getState().settings.agentSettings
    const sent = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(sent).toStrictEqual([])
    expect(onScreen).toStrictEqual({ contextExclusions: ['**/.env'] })
  })
})

describe('the other direction — a legitimate un-synced local edit is NOT thrown away', () => {
  test('the server has NO value for the key: the local edit survives AND reaches the server', async () => {
    // This is what a naive "server always wins" would silently lose: a first-run user whose
    // profile is empty server-side. Their settings must still persist.
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => ({ agentSettings: null, name: null }))

    store.getState().update({ agentSettings: { gitBlame: { enabled: true } } })
    await store.getState().loadFromBackend()
    await tick(DEBOUNCE_MS + 100)

    expect(store.getState().settings.agentSettings).toStrictEqual({ gitBlame: { enabled: true } })
    const sent = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.at(-1)!.agentSettingsPatch).toStrictEqual({ gitBlame: { enabled: true } })
  })

  test('supersession is PER KEY — an untouched-by-server field still flushes', async () => {
    const store = await freshStore(null)
    // Server knows agentSettings but has no uiSettings.
    getUserProfile.mockImplementation(async () => ({
      agentSettings: { contextExclusions: ['**/.env'] },
      uiSettings: null,
    }))

    store
      .getState()
      .update({ agentSettings: { gitBlame: { enabled: true } }, uiSettings: { fontSize: 'lg' } })
    await store.getState().loadFromBackend()
    await tick(DEBOUNCE_MS + 100)

    // agentSettings: server wins, the pending flush is dropped.
    expect(store.getState().settings.agentSettings).toStrictEqual({
      contextExclusions: ['**/.env'],
    })
    // uiSettings: server had none → the local edit survives and IS sent.
    expect(store.getState().settings.uiSettings).toEqual({ fontSize: 'lg' })

    const sent = updateUserProfile.mock.calls.map(([p]) => p)
    expect(sent.some((p) => isAgentSettingsMutation(p))).toBe(false)
    expect(
      sent.some((p) => (p.uiSettingsPatch as { fontSize?: string } | undefined)?.fontSize === 'lg'),
    ).toBe(true)
  })
})

describe('after sync, normal editing still works', () => {
  test('a UI preference sends only its atomic top-level delta', async () => {
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => ({
      uiSettings: {
        fontFamily: 'inter',
        fontSize: 'md',
        keymapPreset: 'default',
      },
    }))
    await store.getState().loadFromBackend()

    store.getState().update({
      uiSettings: {
        fontFamily: 'inter',
        fontSize: 'lg',
        keymapPreset: 'default',
      },
    })
    await store.getState().flush()

    const sent = updateUserProfile.mock.calls
      .map(([patch]) => patch)
      .filter((patch) => patch && isUiSettingsMutation(patch))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toStrictEqual({ uiSettingsPatch: { fontSize: 'lg' } })
  })

  test('an explicit flush persists tool availability before a dependent agent run', async () => {
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => ({
      agentSettings: { contextExclusions: [] },
    }))
    await store.getState().loadFromBackend()

    store.getState().update({ agentSettings: { contextExclusions: ['**/dist/**'] } })
    await store.getState().flush()

    expect(updateUserProfile).toHaveBeenCalledTimes(1)
    expect(updateUserProfile.mock.calls[0]?.[0]?.agentSettingsPatch).toStrictEqual({
      contextExclusions: ['**/dist/**'],
    })
  })

  test('a quit inside the debounce window still sends the PATCH before the runtime stops', async () => {
    const { flushAllBeforeQuit } = await import('@/shared/lib/quitFlush')
    // The fresh module instance re-registers under 'settings', replacing earlier instances.
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => ({ agentSettings: { contextExclusions: [] } }))
    await store.getState().loadFromBackend()

    store.getState().update({ agentSettings: { contextExclusions: ['**/tmp/**'] } })
    // No tick: the 800 ms debounce is still pending, which is where a quit used to drop it.
    expect(updateUserProfile).not.toHaveBeenCalled()
    expect(await flushAllBeforeQuit(500)).toEqual([])

    expect(updateUserProfile).toHaveBeenCalledTimes(1)
    expect(updateUserProfile.mock.calls[0]?.[0]?.agentSettingsPatch).toStrictEqual({
      contextExclusions: ['**/tmp/**'],
    })
  })

  test('an edit made against SYNCED state flushes to the server as usual', async () => {
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => ({
      agentSettings: { contextExclusions: ['**/.env'] },
    }))

    await store.getState().loadFromBackend() // sync first
    expect(store.getState().synced).toBe(true)

    // Now the base IS server-derived, so last-write-wins points the RIGHT way.
    store
      .getState()
      .update({ agentSettings: { contextExclusions: ['**/.env'], gitBlame: { enabled: true } } })
    await tick(DEBOUNCE_MS + 100)

    const sent = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(sent.at(-1)!.agentSettingsPatch).toStrictEqual({
      gitBlame: { enabled: true },
    })
  })

  test('a failed profile GET HOLDS the local edit (unsynced base is never flushed)', async () => {
    // RESIDUAL of the sync-barrier fix: the catch path used to mark synced + flush, which
    // pushed a patch computed against the un-synced localStorage cache. A transient GET
    // failure followed by a working PATCH would then send a STALE value for the same key.
    // The precedence rule is absolute: flush only against synced state. A failed GET is not
    // a sync, so we stay unsynced and hold the patch (a later successful load releases it).
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => {
      throw new Error('offline')
    })

    store.getState().update({ agentSettings: { gitBlame: { enabled: true } } })
    const result = await store.getState().loadFromBackend()
    await tick(DEBOUNCE_MS + 100)

    // Stayed unsynced: the base was never confirmed against the server.
    expect(result).toBe(false)
    expect(store.getState().synced).toBe(false)
    expect(store.getState().syncError).toBe('offline')
    // Nothing was flushed — the stale, wholesale-replacing blob never reached the server.
    const sent = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(sent).toStrictEqual([])
    // The edit still lives locally (first-paint cache) and survives to the next load.
    expect(store.getState().settings.agentSettings).toStrictEqual({ gitBlame: { enabled: true } })
  })

  test('a load that SUCCEEDS after a failed one releases the held edit against server state', async () => {
    // The held patch isn't lost — it flushes once we actually reach the server. Here the
    // server has no value for the key, so the local edit survives AND is sent.
    const store = await freshStore(null)
    getUserProfile.mockImplementationOnce(async () => {
      throw new Error('offline')
    })
    getUserProfile.mockImplementation(async () => ({ agentSettings: null, name: null }))

    store.getState().update({ agentSettings: { gitBlame: { enabled: true } } })
    await store.getState().loadFromBackend() // fails → held
    expect(store.getState().synced).toBe(false)

    expect(await store.getState().loadFromBackend()).toBe(true) // succeeds → releases
    await tick(DEBOUNCE_MS + 100)

    expect(store.getState().synced).toBe(true)
    expect(store.getState().syncError).toBeNull()
    const sent = updateUserProfile.mock.calls
      .map(([p]) => p)
      .filter((p) => p && isAgentSettingsMutation(p))
    expect(sent.at(-1)!.agentSettingsPatch).toStrictEqual({ gitBlame: { enabled: true } })
  })

  test('concurrent bootstrap callers share one profile request', async () => {
    const store = await freshStore(null)
    let release!: (profile: { agentSettings: null; name: null }) => void
    getUserProfile.mockImplementation(
      () => new Promise((resolve) => (release = resolve as typeof release)),
    )

    const first = store.getState().loadFromBackend()
    const second = store.getState().loadFromBackend()
    expect(getUserProfile).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)

    release({ agentSettings: null, name: null })
    expect(await first).toBe(true)
  })

  test('profile writes are serialized so a slow old model route cannot overwrite the latest one', async () => {
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => ({ agentSettings: null, name: null }))
    await store.getState().loadFromBackend()

    let releaseFirst!: () => void
    updateUserProfile.mockImplementationOnce(
      () => new Promise<Record<string, never>>((resolve) => (releaseFirst = () => resolve({}))),
    )
    updateUserProfile.mockImplementation(async () => ({}))

    const firstRoute = {
      modelRouting: {
        inlineCompletion: { providerConnectionId: 'codex', modelId: 'gpt-5.6', enabled: true },
      },
    }
    store.getState().update({ agentSettings: firstRoute })
    await tick(DEBOUNCE_MS + 100)
    expect(updateUserProfile).toHaveBeenCalledTimes(1)

    const latestRoute = {
      modelRouting: {
        inlineCompletion: {
          providerConnectionId: 'openrouter',
          modelId: 'openai/gpt-5.6',
          reasoningEffort: 'low' as const,
          enabled: true,
        },
      },
    }
    store.getState().update({ agentSettings: latestRoute })
    await tick(DEBOUNCE_MS + 100)

    // The newer top-level route patch waits: requests are never allowed to overtake.
    expect(updateUserProfile).toHaveBeenCalledTimes(1)
    releaseFirst()
    await tick(20)

    expect(updateUserProfile).toHaveBeenCalledTimes(2)
    expect(updateUserProfile.mock.calls[1]?.[0]?.agentSettingsPatch).toStrictEqual(latestRoute)
  })

  test('a transient profile write failure retries the latest atomic settings patch', async () => {
    const store = await freshStore(null)
    getUserProfile.mockImplementation(async () => ({ agentSettings: null, name: null }))
    await store.getState().loadFromBackend()
    updateUserProfile.mockImplementationOnce(async () => {
      throw new Error('temporary outage')
    })
    updateUserProfile.mockImplementation(async () => ({}))

    const route = {
      modelRouting: {
        inlineCompletion: {
          providerConnectionId: 'codex',
          modelId: 'gpt-5.6-luna',
          enabled: true,
        },
      },
    }
    store.getState().update({ agentSettings: route })
    await tick(DEBOUNCE_MS + 100)
    expect(updateUserProfile).toHaveBeenCalledTimes(1)

    await tick(1_100)
    expect(updateUserProfile).toHaveBeenCalledTimes(2)
    expect(updateUserProfile.mock.calls[1]?.[0]?.agentSettingsPatch).toStrictEqual(route)
  })
})
