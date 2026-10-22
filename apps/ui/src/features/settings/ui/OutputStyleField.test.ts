import { describe, expect, test } from 'bun:test'

import { outputStyleOptions } from './OutputStyleField'

const style = (name: string, source: 'builtin' | 'user' | 'plugin', forced = false) => ({
  name,
  source,
  description: `${name} replies`,
  forced,
})

describe('the default output style options', () => {
  test('Default first, then each style with where it comes from', () => {
    const options = outputStyleOptions(
      [style('Concise', 'builtin'), style('mine', 'user')],
      undefined,
    )
    expect(options.map((option) => option.value)).toEqual(['default', 'Concise', 'mine'])
    expect(options[1]?.description).toBe('Built-in · Concise replies')
    expect(options[2]?.description).toBe('Yours · mine replies')
  })

  test('a forced plugin style is not a choice; a saved name nothing offers stays listed', () => {
    const options = outputStyleOptions([style('p:house', 'plugin', true)], 'team-voice')
    expect(options.map((option) => option.value)).toEqual(['default', 'team-voice'])
    expect(options[1]?.description).toBe('Not offered here')
  })
})
