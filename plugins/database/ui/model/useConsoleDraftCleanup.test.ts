import { describe, expect, it } from 'bun:test'
import { draftStoreKey } from './consoleDraft'
import { consolePrefix } from './openConsole'
import { clearConnectionConsoleDrafts, isExtraConsoleId } from './useConsoleDraftCleanup'

function memoryStorage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('connection console draft cleanup', () => {
  it('removes primary, extra and non-SQL drafts for only the deleted connection', () => {
    const storage = memoryStorage({
      [draftStoreKey(consolePrefix('gone'))]: 'SELECT secret',
      [draftStoreKey(`${consolePrefix('gone')}:extra-1`)]: 'SELECT other_secret',
      [draftStoreKey('gone')]: 'GET sensitive-key',
      [draftStoreKey(consolePrefix('keep'))]: 'SELECT keep_me',
      unrelated: 'keep',
    })

    clearConnectionConsoleDrafts('gone', storage)

    expect(storage.getItem(draftStoreKey(consolePrefix('gone')))).toBeNull()
    expect(storage.getItem(draftStoreKey(`${consolePrefix('gone')}:extra-1`))).toBeNull()
    expect(storage.getItem(draftStoreKey('gone'))).toBeNull()
    expect(storage.getItem(draftStoreKey(consolePrefix('keep')))).toBe('SELECT keep_me')
    expect(storage.getItem('unrelated')).toBe('keep')
  })
})

describe('which closed console loses its draft', () => {
  it('only an extra console is throwaway; the primary keeps its draft, in any chat', () => {
    // The kind `database:console` has its own colon, so counting colons over the whole id read
    // the primary console as an extra and closing it deleted its saved draft.
    expect(isExtraConsoleId(consolePrefix('conn'))).toBe(false)
    expect(isExtraConsoleId(`${consolePrefix('conn')}@chat-a`)).toBe(false)
    expect(isExtraConsoleId(`${consolePrefix('conn')}:r4nd`)).toBe(true)
    expect(isExtraConsoleId(`${consolePrefix('conn')}:r4nd@chat-a`)).toBe(true)
    expect(isExtraConsoleId('database:table:conn:public:users')).toBe(false)
  })
})
