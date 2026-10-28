/**
 * `/add-dir` remembers a folder the way Claude Code's "remember" choice does: in the project's
 * `.claude/settings.local.json`, under `permissions.additionalDirectories`, where the gate reads it.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { readSettingsFileLayers } from './settings-files'
import { settingsAdditionalDirectories } from './settings-permissions'
import { addAdditionalDirectory } from './settings-directories'

const root = tempDirPerTest('settings-directories-')

function project() {
  const cwd = join(root(), 'project')
  mkdirSync(cwd, { recursive: true })
  return { cwd, home: join(root(), 'home') }
}

describe('addAdditionalDirectory', () => {
  test('writes the folder where the permission gate reads it, creating the file', () => {
    const { cwd, home } = project()
    const result = addAdditionalDirectory({ cwd, directory: '/srv/shared' })
    expect(result).toEqual({ status: 'added', file: join(cwd, '.claude', 'settings.local.json') })
    const layers = readSettingsFileLayers({ homeDir: home, cwd, managed: null })
    expect(
      settingsAdditionalDirectories(layers, { projectTrusted: false, cwd, homeDir: home }),
    ).toEqual(['/srv/shared'])
  })

  test('keeps every other setting and the folders already listed, and adds a folder once', () => {
    const { cwd } = project()
    const file = join(cwd, '.claude', 'settings.local.json')
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(
      file,
      JSON.stringify({
        model: 'x',
        permissions: { allow: ['Read'], additionalDirectories: ['/a'] },
      }),
    )
    expect(addAdditionalDirectory({ cwd, directory: '/b' }).status).toBe('added')
    expect(addAdditionalDirectory({ cwd, directory: '/b' }).status).toBe('present')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      model: 'x',
      permissions: { allow: ['Read'], additionalDirectories: ['/a', '/b'] },
    })
  })

  test('refuses to overwrite a file it cannot read as JSON', () => {
    const { cwd } = project()
    const file = join(cwd, '.claude', 'settings.local.json')
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(file, '{ not json')
    expect(addAdditionalDirectory({ cwd, directory: '/b' })).toEqual({
      status: 'unreadable',
      file,
    })
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
    expect(existsSync(join(cwd, '.claude', 'settings.local.json'))).toBe(true)
  })
})
