import { describe, expect, test } from 'bun:test'
import {
  parseSettingsAnchorUri,
  pluginSettingsUri,
  settingsTargetUri,
} from '@/shared/lib/settingsAnchors'

describe('settings UI anchors', () => {
  test('forms one hierarchical canonical URI', () => {
    expect(
      settingsTargetUri({ tab: 'editor', anchor: 'editor-on-save', entryId: 'editor.save' }),
    ).toBe('localix://ui/settings/editor/editor-on-save/editor.save')
  })

  test('resolves roots, tabs, and indexed settings to navigation targets', () => {
    expect(parseSettingsAnchorUri('localix://ui/settings/root')).toEqual({ tab: 'preferences' })
    expect(parseSettingsAnchorUri('localix://ui/settings/tools')).toEqual({
      tab: 'tools',
      anchor: undefined,
    })
    expect(
      parseSettingsAnchorUri('localix://ui/settings/editor/editor-on-save/editor.save'),
    ).toEqual({
      tab: 'editor',
      anchor: 'editor-on-save',
      entryId: 'editor.save',
    })
    expect(parseSettingsAnchorUri('file:///tmp/a')).toBeNull()
  })

  test('carries exact project and no-project scopes in canonical plugin links', () => {
    expect(pluginSettingsUri('sample-plugin', 'PRJ-1')).toBe(
      'localix://ui/settings/plugins/plugin-sample-plugin?scope=PRJ-1',
    )
    expect(parseSettingsAnchorUri(pluginSettingsUri('sample-plugin', 'PRJ-1'))).toEqual({
      tab: 'plugins',
      anchor: 'plugin-sample-plugin',
      scope: 'PRJ-1',
    })
    expect(parseSettingsAnchorUri(pluginSettingsUri('sample-plugin', ''))).toEqual({
      tab: 'plugins',
      anchor: 'plugin-sample-plugin',
      scope: '',
    })
  })

  test('encodes entity ids and scopes exactly once', () => {
    const uri = pluginSettingsUri('dev ops/cluster', 'project/a')
    expect(uri).toBe('localix://ui/settings/plugins/plugin-dev%20ops%2Fcluster?scope=project%2Fa')
    expect(parseSettingsAnchorUri(uri)).toEqual({
      tab: 'plugins',
      anchor: 'plugin-dev ops/cluster',
      scope: 'project/a',
    })
  })

  test('does not decode literal percent-encoded text a second time', () => {
    const uri = pluginSettingsUri('dev%2Fops', 'project%2Fa')
    expect(uri).toBe('localix://ui/settings/plugins/plugin-dev%252Fops?scope=project%252Fa')
    expect(parseSettingsAnchorUri(uri)).toEqual({
      tab: 'plugins',
      anchor: 'plugin-dev%2Fops',
      scope: 'project%2Fa',
    })
  })
})
