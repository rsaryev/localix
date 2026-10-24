import { describe, expect, test } from 'bun:test'

import { catalogOrigin, gitOrigin, npmOrigin } from './identity'

describe('a package identity is its origin, normalized', () => {
  test('one git repository however it is spelled', () => {
    const spellings = [
      'https://github.com/Acme/Tools.git',
      'https://github.com/acme/tools',
      'https://github.com/acme/tools/',
      'git@github.com:acme/tools.git',
      'ssh://git@github.com/acme/tools.git',
      'acme/tools',
    ]
    expect(new Set(spellings.map((url) => gitOrigin({ url })))).toEqual(
      new Set(['git:github.com/acme/tools']),
    )
  })

  test('its path and revision are part of it; a pinned commit is not', () => {
    expect(gitOrigin({ url: 'acme/tools', path: './plugins/lint/', ref: 'v2' })).toBe(
      'git:github.com/acme/tools#plugins/lint@v2',
    )
    expect(gitOrigin({ url: 'acme/tools', path: 'plugins/lint' })).toBe(
      'git:github.com/acme/tools#plugins/lint',
    )
    expect(gitOrigin({ url: 'acme/tools', path: '.' })).toBe('git:github.com/acme/tools')
  })

  test('an npm package by its name, a catalog archive by its own', () => {
    expect(npmOrigin('@Acme/Lint')).toBe('npm:@acme/lint')
    expect(catalogOrigin('chess')).toBe('catalog:chess')
  })
})
