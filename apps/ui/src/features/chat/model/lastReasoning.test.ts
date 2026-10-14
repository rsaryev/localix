import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { loadLastReasoning, rememberLastReasoning } from './persistence'

/**
 * What a NEW session inherits from the last one.
 *
 * Model and mode stick unconditionally and should. Reasoning mostly should too — but the top two
 * rungs are different in kind: `max` on one hard problem used to become a permanent, invisible
 * multiplier on every new chat, and the picker showing `max` on a fresh session reads as a
 * DEFAULT rather than as something you once chose. Observed on a real database: a session created
 * from the app at 08:32 carried `max` while runs seconds later through the CLI (which does not
 * read this key) carried the code default.
 */

const KEY = 'localix_last_reasoning'

/**
 * An in-memory stand-in — these tests run headless, where `localStorage` does not exist.
 *
 * Installed and REMOVED around this file rather than at module scope: `bun test` shares one
 * process, so a `localStorage` left on `globalThis` silently becomes the storage every later
 * file sees, and the globals guard then reports the leak against whichever file happened to
 * run last. Deleting the key (not assigning `undefined`, which leaves the key behind) keeps
 * the fake scoped to the suite that asked for it.
 */
const store = new Map<string, string>()
const fakeStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size
  },
} as Storage

const hadStorage = Object.hasOwn(globalThis, 'localStorage')
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

beforeAll(() => {
  // A registered DOM exposes `localStorage` as a read-only accessor, so plain assignment
  // is not enough to take it over.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: fakeStorage,
  })
})

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
  if (hadStorage && previousStorage) {
    Object.defineProperty(globalThis, 'localStorage', previousStorage)
  }
})

beforeEach(() => store.clear())
afterEach(() => store.clear())

describe('remembered reasoning effort', () => {
  test('nothing remembered means nothing inherited', () => {
    expect(loadLastReasoning()).toBeNull()
  })

  test('ordinary levels stick, exactly as chosen', () => {
    for (const effort of ['minimal', 'low', 'medium', 'high'] as const) {
      rememberLastReasoning(effort)
      expect(loadLastReasoning()).toBe(effort)
    }
  })

  test('`off` is never remembered — it is a model fact, not a preference', () => {
    // One pick of a model that cannot reason used to seed every later session with no thinking
    // at all, and the picker then painted every model "Off".
    rememberLastReasoning('medium')
    rememberLastReasoning('off')
    expect(loadLastReasoning()).toBe('medium')
  })

  test('the top two rungs do not carry to the next session', () => {
    rememberLastReasoning('max')
    expect(loadLastReasoning()).toBe('high')

    rememberLastReasoning('xhigh')
    expect(loadLastReasoning()).toBe('high')
  })

  test('a value stored BEFORE this rule is clamped on read', () => {
    // The whole point: an old `max` is already sitting in localStorage, and clamping only on
    // write would leave every existing user seeding new sessions at max forever.
    localStorage.setItem(KEY, 'max')
    expect(loadLastReasoning()).toBe('high')
  })

  test('garbage is ignored rather than clamped into something plausible', () => {
    localStorage.setItem(KEY, 'turbo')
    expect(loadLastReasoning()).toBeNull()
  })
})
