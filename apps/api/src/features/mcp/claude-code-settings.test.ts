import { afterEach, expect, test } from 'bun:test'
import {
  folderSettingsEnv,
  installMcpSettingsReader,
  mcpFolderSettings,
} from './claude-code-settings'

afterEach(() => installMcpSettingsReader(undefined))

test('until the host installs a reader a folder has no settings', () => {
  expect(mcpFolderSettings({ homeDir: '/h', cwd: '/w' })).toEqual({
    files: [],
    localRoot: undefined,
    trusted: false,
    mcpLocked: false,
    env: {},
    managedDir: null,
  })
  expect(folderSettingsEnv('/w')).toEqual({})
})

test('the installed reader answers for every folder', () => {
  const settings = {
    files: [],
    localRoot: '/repo',
    trusted: true,
    mcpLocked: true,
    env: { A: '1' },
    managedDir: '/m',
  }
  installMcpSettingsReader({ read: () => settings, folderEnv: (cwd) => ({ CWD: cwd }) })
  expect(mcpFolderSettings({ homeDir: '/h', cwd: '/w' })).toBe(settings)
  expect(folderSettingsEnv('/w')).toEqual({ CWD: '/w' })
})
