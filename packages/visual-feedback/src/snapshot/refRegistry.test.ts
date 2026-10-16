import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { createRefRegistry } from './index'

/** Minimal connected/detached element stand-in (no DOM needed for the registry). */
function fakeEl(connected = true): Element {
  return { isConnected: connected } as unknown as Element
}

describe('createRefRegistry', () => {
  test('assigns sequential eN handles and resolves them', () => {
    const reg = createRefRegistry()
    const a = fakeEl()
    const b = fakeEl()
    expect(reg.put(a)).toBe('e1')
    expect(reg.put(b)).toBe('e2')
    expect(reg.get('e1')).toBe(a)
    expect(reg.get('e2')).toBe(b)
  })

  test('normalizes @e3 / e3 / 3 to the same handle', () => {
    const reg = createRefRegistry()
    reg.put(fakeEl())
    reg.put(fakeEl())
    const third = fakeEl()
    expect(reg.put(third)).toBe('e3')
    expect(reg.get('e3')).toBe(third)
    expect(reg.get('@e3')).toBe(third)
    expect(reg.get('3')).toBe(third)
    expect(reg.get(' e3 ')).toBe(third)
  })

  test('clear() invalidates prior handles and restarts numbering', () => {
    const reg = createRefRegistry()
    reg.put(fakeEl())
    reg.clear()
    expect(reg.get('e1')).toBeNull()
    expect(reg.put(fakeEl())).toBe('e1')
  })

  test('a detached element resolves to null (stale ref)', () => {
    const reg = createRefRegistry()
    const ref = reg.put(fakeEl(false))
    expect(reg.get(ref)).toBeNull()
  })

  test('unknown / empty handles resolve to null', () => {
    const reg = createRefRegistry()
    expect(reg.get('e99')).toBeNull()
    expect(reg.get('')).toBeNull()
  })
})

describe('createRefRegistry self-heal (re-resolves a stale ref by selector)', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('a ref whose element was RE-MOUNTED re-resolves via its captured selector', () => {
    document.body.innerHTML = `<div id="app"><button class="theme-toggle">Light</button></div>`
    const reg = createRefRegistry()
    const original = document.querySelector('.theme-toggle')!
    const ref = reg.put(original, { selector: 'button.theme-toggle' })
    expect(reg.get(ref)).toBe(original)
    // Simulate a React re-render that re-mounts the button (a NEW node, same selector).
    document.querySelector('#app')!.innerHTML = `<button class="theme-toggle">Dark</button>`
    expect(original.isConnected).toBe(false) // the old node is detached…
    const healed = reg.get(ref)
    expect(healed).not.toBeNull() // …but the ref still resolves
    expect(healed).toBe(document.querySelector('.theme-toggle')) // to the FRESH node
    expect((healed as Element).textContent).toBe('Dark')
  })

  test('without a captured selector, a detached element stays null (no false heal)', () => {
    document.body.innerHTML = `<button class="x">Hi</button>`
    const reg = createRefRegistry()
    const ref = reg.put(document.querySelector('.x')!) // no selector
    document.body.innerHTML = ''
    expect(reg.get(ref)).toBeNull()
  })

  test('a bad selector is swallowed — get() returns null, never throws', () => {
    document.body.innerHTML = `<button>Hi</button>`
    const reg = createRefRegistry()
    const ref = reg.put(document.querySelector('button')!, { selector: ':::not a selector:::' })
    document.body.innerHTML = ''
    expect(() => reg.get(ref)).not.toThrow()
    expect(reg.get(ref)).toBeNull()
  })
})

describe('createRefRegistry cross-generation identity (self-heal after re-snapshot)', () => {
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())

  test('identityOf reads the current generation, then falls back to the previous one', () => {
    const reg = createRefRegistry()
    reg.put(fakeEl(), { selector: '.a', role: 'button', name: 'A' })
    expect(reg.identityOf('e1')).toEqual({ selector: '.a', role: 'button', name: 'A' })
    // A fresh snapshot clears the current gen but retains the previous for re-resolution.
    reg.clear()
    expect(reg.identityOf('e1')).toEqual({ selector: '.a', role: 'button', name: 'A' })
    // A SECOND clear drops it (only one prior generation is kept).
    reg.clear()
    expect(reg.identityOf('e1')).toBeNull()
  })

  test('findByIdentity re-resolves by selector against the CURRENT generation', () => {
    document.body.innerHTML = `<button class="submit">Save</button>`
    const reg = createRefRegistry()
    reg.put(document.querySelector('.submit')!, {
      selector: 'button.submit',
      role: 'button',
      name: 'Save',
    })
    const el = reg.findByIdentity({ selector: 'button.submit', role: 'button', name: 'Save' })
    expect(el).toBe(document.querySelector('.submit'))
  })

  test('findByIdentity re-resolves by UNIQUE role+name when the selector is stale', () => {
    document.body.innerHTML = `<button class="v1-hash">Buy now</button>`
    const reg = createRefRegistry()
    const btn = document.querySelector('button')!
    reg.clear() // start a fresh gen so this element is a live ref in it
    reg.put(btn, { selector: 'button.v9-was-different', role: 'button', name: 'Buy now' })
    // Selector no longer matches, but role+name uniquely identify the button.
    const el = reg.findByIdentity({
      selector: 'button.v9-was-different',
      role: 'button',
      name: 'Buy now',
    })
    expect(el).toBe(btn)
  })

  test('findByIdentity refuses to guess between two equal role+name matches', () => {
    document.body.innerHTML = `<button>Go</button><button>Go</button>`
    const reg = createRefRegistry()
    const [a, b] = Array.from(document.querySelectorAll('button'))
    reg.put(a, { selector: 'x', role: 'button', name: 'Go' })
    reg.put(b, { selector: 'y', role: 'button', name: 'Go' })
    expect(reg.findByIdentity({ selector: 'nope', role: 'button', name: 'Go' })).toBeNull()
  })

  test('findByIdentity returns null for an anonymous (nameless) identity', () => {
    document.body.innerHTML = `<button aria-label=""></button>`
    const reg = createRefRegistry()
    reg.put(document.querySelector('button')!, { selector: 'gone', role: 'button', name: '' })
    expect(reg.findByIdentity({ selector: 'gone', role: 'button', name: '' })).toBeNull()
  })
})
