import { describe, expect, test } from 'bun:test'
import type { UiLocationContribution } from '@localixai/plugin-sdk/ui'
import { settingsUiUri } from '@localixai/plugin-sdk/navigation'
import { SETTINGS_STRING_TABS } from '@/shared/routing/routes'
import { createUiLocationRegistry } from '@/shared/contrib/uiLocations'
import root from '../ui/SettingsPanel.surface'
import preferences from '../ui/PreferencesSettings.surface'
import editor from '../ui/EditorSettings.surface'
import shortcuts from '../ui/KeyboardShortcutsSettings.surface'
import tools from '../ui/ToolsSettings.surface'
import skills from '../ui/SkillsSettings.surface'
import mcp from '../ui/McpSettings.surface'
import plugins from '../ui/PluginsSettings.surface'
import rules from '../ui/PermissionRulesSettings.surface'
import agents from '../ui/AgentsSettings.surface'
import project from '../ui/ProjectsSettings.surface'
import context from '../ui/ContextSettings.surface'
import system from '../ui/SystemSettings.surface'
import models from '../ui/ModelsSettings.surface'
import modelList from '../ui/ModelCatalogSection.surface'
import diagnostics from '../ui/DiagnosticsSettings.surface'

const surfaces: UiLocationContribution[] = [
  preferences,
  editor,
  shortcuts,
  agents,
  tools,
  skills,
  mcp,
  plugins,
  rules,
  project,
  models,
  modelList,
  system,
  context,
  diagnostics,
]

describe('Settings UI surfaces', () => {
  test('the Settings root owns its canonical standalone location', () => {
    const registry = createUiLocationRegistry()

    expect(root.uri).toBe(settingsUiUri())
    expect(registry.register(root)).toBe(true)
    expect(registry.resolve(settingsUiUri(undefined, { scope: 'PRJ-1' }))).toMatchObject({
      descriptor: { id: 'settings.open', effect: 'read', surface: 'settings' },
      target: { kind: 'settings', tab: 'preferences', scope: 'PRJ-1' },
    })
  })

  test('every static Settings tab owns one exact canonical location', () => {
    expect(surfaces.map((surface) => surface.id)).toEqual(
      SETTINGS_STRING_TABS.map((tab) => `settings.${tab}.open`),
    )
    expect(surfaces.map((surface) => surface.uri)).toEqual(
      SETTINGS_STRING_TABS.map((tab) => settingsUiUri(tab)),
    )
  })

  test('resolves a validated scope without teaching the registry about Settings', () => {
    const registry = createUiLocationRegistry()
    for (const surface of surfaces) expect(registry.register(surface)).toBe(true)

    expect(registry.resolve(settingsUiUri('plugins', { scope: 'PRJ-1' }))).toMatchObject({
      descriptor: { effect: 'read', surface: 'settings' },
      args: { scope: 'PRJ-1' },
      target: { kind: 'settings', tab: 'plugins', scope: 'PRJ-1' },
      presentation: { label: 'Open Plugins' },
    })
    expect(registry.resolve(`${settingsUiUri('plugins')}?scope=`)).toMatchObject({
      args: { scope: '' },
      target: { kind: 'settings', tab: 'plugins', scope: '' },
    })
    expect(registry.resolve(`${settingsUiUri('plugins')}?unknown=value`)).toBeNull()
    expect(registry.resolve(`${settingsUiUri('plugins')}?scope=a&scope=b`)).toBeNull()
  })
})
