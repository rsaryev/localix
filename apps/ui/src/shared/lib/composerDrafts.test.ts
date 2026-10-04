import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installTestLocalStorage, removeTestLocalStorage } from '@localixai/kit/testing/dom'
import {
  composerDrafts,
  MAX_DRAFTS,
  MAX_PERSISTED_CHARS,
  reloadComposerDraftsForTests,
} from './composerDrafts'
import { flushAllBeforeQuit } from './quitFlush'

const KEY = 'localix_composer_drafts_v1'
let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  installTestLocalStorage({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
  reloadComposerDraftsForTests()
})
afterEach(() => {
  reloadComposerDraftsForTests()
  removeTestLocalStorage()
})

/** What the next page load reads: the in-memory copy dropped, storage re-read. */
const simulateReload = reloadComposerDraftsForTests

describe('composerDrafts', () => {
  test('stores and returns a draft per session', () => {
    composerDrafts.set('a', 'hello A')
    composerDrafts.set('b', 'hello B')
    expect(composerDrafts.get('a')).toBe('hello A')
    expect(composerDrafts.get('b')).toBe('hello B')
  })

  test('a never-typed session reads as empty string', () => {
    expect(composerDrafts.get('never')).toBe('')
  })

  test('setting empty text clears the entry (keeps the map clean)', () => {
    composerDrafts.set('c', 'draft')
    expect(composerDrafts.get('c')).toBe('draft')
    composerDrafts.set('c', '')
    expect(composerDrafts.get('c')).toBe('')
  })
})

describe('a draft survives the page going away', () => {
  test('a quit inside the debounce window still persists the half-typed message', async () => {
    composerDrafts.set('s1', 'half-typed')
    expect(store.has(KEY)).toBe(false)
    await flushAllBeforeQuit(50)
    simulateReload()
    expect(composerDrafts.get('s1')).toBe('half-typed')
  })

  test('a deleted session takes its draft with it', async () => {
    composerDrafts.set('gone', 'text')
    await flushAllBeforeQuit(50)
    composerDrafts.forget('gone')
    await flushAllBeforeQuit(50)
    simulateReload()
    expect(composerDrafts.get('gone')).toBe('')
    expect(store.has(KEY)).toBe(false)
  })

  test('the store is bounded: newest drafts kept, an oversize one stays in memory only', async () => {
    const realNow = Date.now
    let clock = 1_000
    Date.now = () => ++clock
    try {
      for (let index = 0; index <= MAX_DRAFTS; index += 1) composerDrafts.set(`s${index}`, 'x')
      composerDrafts.set('huge', 'y'.repeat(MAX_PERSISTED_CHARS + 1))
    } finally {
      Date.now = realNow
    }
    await flushAllBeforeQuit(50)
    const persisted = JSON.parse(store.get(KEY)!) as Record<string, unknown>
    expect(Object.keys(persisted)).toHaveLength(MAX_DRAFTS)
    expect(persisted.s0).toBeUndefined() // the oldest is evicted
    expect(persisted[`s${MAX_DRAFTS}`]).toBeDefined()
    expect(persisted.huge).toBeUndefined()
    expect(composerDrafts.get('huge')).toHaveLength(MAX_PERSISTED_CHARS + 1)
  })

  test('a corrupt stored value is ignored, not thrown', () => {
    store.set(KEY, JSON.stringify({ s1: { text: 5 }, s2: 'bare', s3: { text: 'ok', at: 1 } }))
    reloadComposerDraftsForTests()
    expect(composerDrafts.get('s1')).toBe('')
    expect(composerDrafts.get('s3')).toBe('ok')
  })
})
