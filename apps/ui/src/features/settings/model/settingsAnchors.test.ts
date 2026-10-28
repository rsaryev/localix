import { describe, expect, test } from 'bun:test'
import { settingsEntityUiUri } from '@localixai/mini-app-sdk/navigation'
import { parseSettingsAnchorUri, settingsTargetUri } from '@/shared/lib/settingsAnchors'

const sectionUri = (id: string, scope = '') => settingsEntityUiUri('project', 'section', id, scope)

describe('settings UI anchors', () => {
  test('forms one hierarchical canonical URI', () => {
    expect(
      settingsTargetUri({ tab: 'editor', anchor: 'editor-on-save', entryId: 'editor.save' }),
    ).toBe('localix://ui/settings/editor/editor-on-save/editor.save')
  })

  test('resolves roots, tabs, and indexed settings to navigation targets', () => {
    expect(parseSettingsAnchorUri('localix://ui/settings/root')).toEqual({ tab: 'preferences' })
    expect(parseSettingsAnchorUri('localix://ui/settings/permissions')).toEqual({
      tab: 'permissions',
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

  test('carries exact project and no-project scopes in canonical section links', () => {
    expect(sectionUri('sample-plugin', 'PRJ-1')).toBe(
      'localix://ui/settings/project/section-sample-plugin?scope=PRJ-1',
    )
    expect(parseSettingsAnchorUri(sectionUri('sample-plugin', 'PRJ-1'))).toEqual({
      tab: 'project',
      anchor: 'section-sample-plugin',
      scope: 'PRJ-1',
    })
    expect(parseSettingsAnchorUri(sectionUri('sample-plugin', ''))).toEqual({
      tab: 'project',
      anchor: 'section-sample-plugin',
      scope: '',
    })
  })

  test('encodes entity ids and scopes exactly once', () => {
    const uri = sectionUri('dev ops/cluster', 'project/a')
    expect(uri).toBe('localix://ui/settings/project/section-dev%20ops%2Fcluster?scope=project%2Fa')
    expect(parseSettingsAnchorUri(uri)).toEqual({
      tab: 'project',
      anchor: 'section-dev ops/cluster',
      scope: 'project/a',
    })
  })

  test('does not decode literal percent-encoded text a second time', () => {
    const uri = sectionUri('dev%2Fops', 'project%2Fa')
    expect(uri).toBe('localix://ui/settings/project/section-dev%252Fops?scope=project%252Fa')
    expect(parseSettingsAnchorUri(uri)).toEqual({
      tab: 'project',
      anchor: 'section-dev%2Fops',
      scope: 'project%2Fa',
    })
  })
})
