import { describe, expect, test } from 'bun:test'
import type { PluginRecord } from '@/shared/api/contracts'
import { canUninstallPlugin, removePlugin, type RemovePluginDeps } from './uninstallPlugin'

const plugin = (overrides: Partial<PluginRecord> = {}) =>
  ({
    name: 'calorie-estimator',
    displayName: 'Photo Calorie Estimator',
    projectId: '',
    bundled: false,
    dir: '/home/.localix/plugins/calorie-estimator',
    ...overrides,
  }) as PluginRecord

function recorder(fail?: Error) {
  const calls: string[] = []
  const deps: RemovePluginDeps = {
    remove: async (name, opts) => {
      calls.push(`remove ${name} ${String(opts.projectId)}`)
      if (fail) throw fail
    },
    refetch: async () => calls.push('refetch'),
    notify: {
      success: (message: string) => calls.push(`ok ${message}`),
      error: (message: string) => calls.push(`error ${message}`),
    } as RemovePluginDeps['notify'],
  }
  return { calls, deps }
}

describe('uninstallPlugin', () => {
  test('only an installed plugin can be uninstalled, never a bundled one', () => {
    expect(canUninstallPlugin(plugin())).toBe(true)
    expect(canUninstallPlugin(plugin({ bundled: true }))).toBe(false)
  })

  test('removes in its own scope, then refreshes the live set before saying so', async () => {
    const { calls, deps } = recorder()
    expect(await removePlugin(plugin({ projectId: 'p1' }), deps)).toBe(true)
    expect(calls[0]).toBe('remove calorie-estimator p1')
    expect(calls[1]).toBe('refetch')
    expect(calls[2]).toStartWith('ok ')
  })

  test('a personal plugin is removed with no project', async () => {
    const { calls, deps } = recorder()
    await removePlugin(plugin(), deps)
    expect(calls[0]).toBe('remove calorie-estimator null')
  })

  test('a failed removal is reported and leaves the list alone', async () => {
    const { calls, deps } = recorder(new Error('busy'))
    expect(await removePlugin(plugin(), deps)).toBe(false)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toStartWith('error Could not uninstall')
  })
})
