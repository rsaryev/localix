import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getPaletteMru, recordPaletteUse } from './paletteMru'

const KEY = 'localix.palette.mru'
let stored: Map<string, string>
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

beforeEach(() => {
  stored = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
  })
})
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('the palette remembers the commands run, most recent first', () => {
  it('puts a run command in front, once', () => {
    recordPaletteUse('a')
    recordPaletteUse('b')
    expect(getPaletteMru()).toEqual(['b', 'a'])
    recordPaletteUse('a')
    expect(getPaletteMru()).toEqual(['a', 'b'])
    recordPaletteUse('a')
    expect(getPaletteMru()).toEqual(['a', 'b'])
  })

  it('keeps six, dropping the oldest', () => {
    for (const id of ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'fresh']) recordPaletteUse(id)
    expect(getPaletteMru()).toEqual(['fresh', 'c5', 'c4', 'c3', 'c2', 'c1'])
  })

  it('ignores what is not a list of ids', () => {
    stored.set(KEY, JSON.stringify({ not: 'a list' }))
    expect(getPaletteMru()).toEqual([])
    stored.set(KEY, JSON.stringify(['a', 3, 'b']))
    expect(getPaletteMru()).toEqual(['a', 'b'])
  })
})
