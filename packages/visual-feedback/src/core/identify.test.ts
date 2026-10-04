import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'

import { cleanClass, isUtilityClass } from './css-classes'
import { generateSelector, getSemanticRole } from './identify'

/** Minimal element-like for role tests (tag + attributes), no DOM needed. */
function fakeEl(tag: string, attrs: Record<string, string> = {}): Element {
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (k: string) => attrs[k] ?? null,
  } as unknown as Element
}

describe('cleanClass', () => {
  test('keeps meaningful hyphenated names (the lucide-icon case)', () => {
    expect(cleanClass('lucide-filter')).toBe('lucide-filter')
    expect(cleanClass('rounded-md')).toBe('rounded-md')
    expect(cleanClass('my-component')).toBe('my-component')
    expect(cleanClass('arrowDown')).toBe('arrowDown')
  })

  test('strips hash-like suffixes (CSS modules / styled-components with digits)', () => {
    expect(cleanClass('Button_x7f2a3')).toBe('Button')
    expect(cleanClass('card-a1b2c3')).toBe('card')
  })

  test('rejects junk: empty, too short, single utility letters, all-consonant hashes', () => {
    expect(cleanClass('')).toBeNull()
    expect(cleanClass('ab')).toBeNull()
    expect(cleanClass('px')).toBeNull()
    expect(cleanClass('bcdfghjk')).toBeNull() // 8+ chars, no vowels → hash
  })
})

describe('isUtilityClass', () => {
  test('flags Tailwind-style atoms and prefixes', () => {
    for (const c of [
      'flex',
      'gap-3',
      'px-4',
      'text-sm',
      'rounded-md',
      'hover:bg-red-500',
      'md:flex',
    ]) {
      expect(isUtilityClass(c)).toBe(true)
    }
  })

  test('does not flag component / icon classes', () => {
    for (const c of ['lucide-filter', 'Sidebar', 'hero-section', 'card']) {
      expect(isUtilityClass(c)).toBe(false)
    }
  })
})

describe('getSemanticRole', () => {
  test('maps <input> by type, not always textbox', () => {
    expect(getSemanticRole(fakeEl('input', { type: 'checkbox' }))).toBe('checkbox')
    expect(getSemanticRole(fakeEl('input', { type: 'radio' }))).toBe('radio')
    expect(getSemanticRole(fakeEl('input', { type: 'range' }))).toBe('slider')
    expect(getSemanticRole(fakeEl('input', { type: 'submit' }))).toBe('button')
    expect(getSemanticRole(fakeEl('input', { type: 'email' }))).toBe('textbox')
    expect(getSemanticRole(fakeEl('input'))).toBe('textbox') // default
    expect(getSemanticRole(fakeEl('input', { type: 'date' }))).toBe('textbox') // no simple role → default
  })

  test('explicit role wins; common tags map implicitly', () => {
    expect(getSemanticRole(fakeEl('div', { role: 'tab' }))).toBe('tab')
    expect(getSemanticRole(fakeEl('a'))).toBe('link')
    expect(getSemanticRole(fakeEl('nav'))).toBe('navigation')
    expect(getSemanticRole(fakeEl('span'))).toBeUndefined()
  })
})

/**
 * A selector is the capture's answer to "what did you point at". An empty one means nothing
 * is addressable, and every consumer treats it that way — which is how a click on the page
 * root produced a comment with no screenshot: the ancestor climb stops AT `body`, so a pick
 * OF `body` came back with nothing at all.
 */
describe('generateSelector', () => {
  const dom = () => {
    const window = new Window()
    const globals = globalThis as unknown as Record<string, unknown>
    for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'Element'] as const) {
      globals[key] = (window as unknown as Record<string, unknown>)[key]
    }
    return {
      window,
      done: () => {
        for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'Element'] as const) {
          delete globals[key]
        }
      },
    }
  }

  test('the page root addresses itself', () => {
    const { window, done } = dom()
    try {
      expect(generateSelector(window.document.body as unknown as Element).selector).toBe('body')
      expect(generateSelector(window.document.documentElement as unknown as Element).selector).toBe(
        'html',
      )
    } finally {
      done()
    }
  })

  test('an ordinary element still gets a chain that does not name the root', () => {
    const { window, done } = dom()
    try {
      window.document.body.innerHTML = '<main><p>hello</p></main>'
      const p = window.document.querySelector('p')!
      const selector = generateSelector(p as unknown as Element).selector
      expect(selector).toContain('p:nth-of-type(1)')
      expect(selector).not.toContain('body')
    } finally {
      done()
    }
  })
})
