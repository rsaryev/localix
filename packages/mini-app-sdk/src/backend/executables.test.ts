import { describe, expect, test } from 'bun:test'

import { toolEnv, toolPath } from './executables'

describe('toolPath', () => {
  test("appends the GUI-missing install dirs AFTER the person's own PATH", () => {
    const path = toolPath({
      path: '/usr/bin:/bin',
      platform: 'darwin',
      home: '/Users/me',
      exists: () => true,
    })
    const entries = path.split(':')
    expect(entries.slice(0, 2)).toEqual(['/usr/bin', '/bin'])
    expect(entries).toContain('/usr/local/bin')
    expect(entries).toContain('/opt/homebrew/bin')
    expect(entries).toContain('/Users/me/.orbstack/bin')
  })

  test('adds only directories that exist, and never twice', () => {
    const path = toolPath({
      path: '/usr/local/bin:/usr/bin',
      platform: 'darwin',
      home: '/Users/me',
      exists: (dir) => dir === '/usr/local/bin' || dir === '/opt/homebrew/bin',
    })
    expect(path).toBe('/usr/local/bin:/usr/bin:/opt/homebrew/bin')
  })

  test('a platform it knows nothing about keeps the PATH as it is', () => {
    expect(toolPath({ path: 'C:\\bin', platform: 'win32', exists: () => true })).toBe('C:\\bin')
  })
})

describe('toolEnv', () => {
  // The defect: `Bun.spawn` without `env` resolves against the PATH the process STARTED with, so a
  // repaired `process.env.PATH` never reached it. The env handed to a spawn must be read NOW.
  test('reads the CURRENT process.env, not a snapshot', () => {
    const before = process.env.LOCALIX_TOOL_ENV_PROBE
    process.env.LOCALIX_TOOL_ENV_PROBE = 'now'
    try {
      expect(toolEnv().LOCALIX_TOOL_ENV_PROBE).toBe('now')
    } finally {
      if (before === undefined) delete process.env.LOCALIX_TOOL_ENV_PROBE
      else process.env.LOCALIX_TOOL_ENV_PROBE = before
    }
  })

  test('extra variables win, and undefined ones are dropped', () => {
    const env = toolEnv({ LC_ALL: 'C', LOCALIX_UNSET_PROBE: undefined })
    expect(env.LC_ALL).toBe('C')
    expect('LOCALIX_UNSET_PROBE' in env).toBe(false)
  })
})
