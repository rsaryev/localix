import { describe, expect, test } from 'bun:test'

import { gitOrigin, miniAppOrigin, npmOrigin } from './identity'

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

  test('the usual default branch is the repository itself, named or not', () => {
    expect(gitOrigin({ url: 'acme/tools', ref: 'main' })).toBe(gitOrigin({ url: 'acme/tools' }))
    expect(gitOrigin({ url: 'acme/tools', ref: 'master' })).toBe('git:github.com/acme/tools')
  })

  test('an npm package by its name', () => {
    expect(npmOrigin('@Acme/Lint')).toBe('npm:@acme/lint')
  })

  // A list that links an app and the author's own marketplace offer one app, not two; the same
  // name in two marketplaces is two apps.
  test('a mini app by the released marketplace it is built in, and its name', () => {
    const release =
      'https://github.com/Grace/Habits/releases/latest/download/mini-app-marketplace.json'
    expect(miniAppOrigin(release, 'habits')).toBe(
      miniAppOrigin(release.replace('Grace/Habits', 'grace/habits'), 'habits'),
    )
    expect(miniAppOrigin(release, 'habits')).not.toBe(
      miniAppOrigin('https://ada.example/mini-app-marketplace.json', 'habits'),
    )
  })
})
