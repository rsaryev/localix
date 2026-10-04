import { describe, expect, test } from 'bun:test'
import { pluginCommandActivity } from './pluginCommandActivity'

describe('pluginCommandActivity', () => {
  test('describes plugin installation for the optimistic tool row', () => {
    expect(pluginCommandActivity('/plugin install owner/review')).toEqual({
      kind: 'plugin',
      action: 'install',
      state: 'running',
      label: 'Installing plugin',
      subject: 'owner/review',
    })
  })

  test('describes supported lifecycle actions', () => {
    expect(pluginCommandActivity('/plugin update review')).toMatchObject({
      action: 'update',
      label: 'Updating plugin',
    })
    expect(pluginCommandActivity('/plugin remove review')).toMatchObject({
      action: 'remove',
      label: 'Removing plugin',
    })
  })

  test('shows creation progress without taking a word of the description as the name', () => {
    expect(pluginCommandActivity('/plugin create show GPU temperatures')).toEqual({
      kind: 'plugin',
      action: 'create',
      state: 'running',
      label: 'Creating plugin',
    })
    expect(pluginCommandActivity('/plugin create a GPU monitor:\n- temperature\n- fan')).toEqual({
      kind: 'plugin',
      action: 'create',
      state: 'running',
      label: 'Creating plugin',
    })
  })

  test('does not capture listings, marketplace commands, or ordinary prompts', () => {
    expect(pluginCommandActivity('/plugin list')).toBeNull()
    expect(pluginCommandActivity('/plugin marketplace add owner/repo')).toBeNull()
    expect(pluginCommandActivity('/provider install unsupported')).toBeNull()
    expect(pluginCommandActivity('/plugin upgrade review')).toBeNull()
    expect(pluginCommandActivity('/plugin uninstall review')).toBeNull()
    expect(pluginCommandActivity('/plugin rm review')).toBeNull()
    expect(pluginCommandActivity('/plugin install')).toBeNull()
    expect(pluginCommandActivity('/plugin init gpu-monitor')).toBeNull()
    expect(pluginCommandActivity('/plugins install owner/review')).toBeNull()
    expect(pluginCommandActivity('install the plugin')).toBeNull()
  })
})
