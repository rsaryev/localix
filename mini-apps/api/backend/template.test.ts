/**
 * `{{ variable }}` substitution. Small on purpose — see the module header on why this is not a
 * template engine. These tests pin the boundary: substitution, and nothing that shades into
 * evaluation.
 */

import { describe, expect, test } from 'bun:test'
import { hasTemplate, renderTemplate } from './template'

const vars = (o: Record<string, string>) => new Map(Object.entries(o))

describe('hasTemplate', () => {
  test.each([
    ['{{ a }}', true],
    ['x{{a}}y', true],
    ['plain', false],
    ['{{ unclosed', false],
    ['closed }}', false],
    ['', false],
  ])('%p → %p', (text, expected) => {
    expect(hasTemplate(text)).toBe(expected)
  })
})

describe('renderTemplate', () => {
  test('substitutes a value', () => {
    expect(renderTemplate('{{base_url}}/users', vars({ base_url: 'https://api.dev' })).text).toBe(
      'https://api.dev/users',
    )
  })

  test('tolerates inner spaces', () => {
    expect(renderTemplate('{{  base_url  }}/x', vars({ base_url: 'https://a.dev' })).text).toBe(
      'https://a.dev/x',
    )
  })

  test('substitutes every occurrence', () => {
    expect(renderTemplate('{{v}}-{{v}}', vars({ v: 'x' })).text).toBe('x-x')
  })

  test('leaves text with no variables untouched', () => {
    expect(renderTemplate('https://api.dev/users', vars({})).text).toBe('https://api.dev/users')
  })

  test('an empty-string value is a real value, not a miss', () => {
    const out = renderTemplate('{{prefix}}/x', vars({ prefix: '' }))
    expect(out.text).toBe('/x')
    expect(out.missing).toEqual([])
  })
})

describe('an unknown variable is reported, never blanked', () => {
  test('the braces stay so the url is visibly unfinished', () => {
    // `{{base_url}}/users` silently becoming `/users` is a request to a different place that looks
    // like it worked.
    const out = renderTemplate('{{base_url}}/users', vars({}))
    expect(out.text).toBe('{{base_url}}/users')
    expect(out.missing).toEqual(['base_url'])
  })

  test('several unknowns are all named, deduped', () => {
    const out = renderTemplate('{{a}}/{{b}}/{{a}}', vars({}))
    expect(out.missing).toEqual(['a', 'b'])
  })

  test('known and unknown mix: the known one still resolves', () => {
    const out = renderTemplate('{{host}}/{{missing}}', vars({ host: 'https://a.dev' }))
    expect(out.text).toBe('https://a.dev/{{missing}}')
    expect(out.missing).toEqual(['missing'])
  })
})

describe('substitution is flat — it is not an evaluator', () => {
  test('a value containing a variable is inserted VERBATIM, not re-expanded', () => {
    // Recursion needs a cycle guard (`a`→`b`→`a` is one typo away) and is the step from
    // substitution to evaluation. A user who wants composition can write the composed value.
    const out = renderTemplate('{{a}}', vars({ a: '{{b}}', b: 'final' }))
    expect(out.text).toBe('{{b}}')
  })

  test('there are no filters', () => {
    const out = renderTemplate('{{ name | upper }}', vars({ name: 'ada' }))
    // Not a variable name we recognise, so it is left alone rather than half-interpreted.
    expect(out.text).toBe('{{ name | upper }}')
  })

  test('there are no tags', () => {
    expect(renderTemplate('{% if x %}y{% endif %}', vars({ x: '1' })).text).toBe(
      '{% if x %}y{% endif %}',
    )
  })

  test('a value with braces cannot smuggle in another variable', () => {
    const out = renderTemplate('{{a}}', vars({ a: '{{secret}}', secret: 'leaked' }))
    expect(out.text).not.toContain('leaked')
  })
})
