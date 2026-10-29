import { afterEach, describe, it, expect } from 'bun:test'
import {
  canNavigateUi,
  invokeUi,
  navigateUi,
  navigateUiAction,
  parseCoreUiUri,
  resolveUiNavigation,
  type UiNavigationHost,
} from '@/shared/lib/uiNavigation'
import { setUiCommands } from '@/shared/contrib/uiCommands'
import { activateSearchHit } from './activateSearch'
import { registerUiLocation, unregisterUiLocation } from '@/shared/contrib/uiLocations'
import globalSearchSurface from '../ui/GlobalSearchTab.surface'

afterEach(() => {
  setUiCommands([])
  unregisterUiLocation(globalSearchSurface.id)
})

describe('parseCoreUiUri', () => {
  it('leaves canonical chat resources to their self-registered anchor owner', () => {
    expect(parseCoreUiUri('localix://resource/chat/session/s1')).toBeNull()
    expect(parseCoreUiUri('localix://resource/chat/project/p1')).toBeNull()
    expect(parseCoreUiUri('localix://resource/chat/message/s1/m1')).toBeNull()
  })
  it('a subsystem scheme like localix://resource/fixture-db/ is not a core target (owned by a mini app contrib)', () => {
    // `localix://resource/fixture-db/` hits are activated by a mini app UI-anchor contribution
    // (it reveals that mini app sidebar) BEFORE core; core treats the scheme as unknown.
    expect(parseCoreUiUri('localix://resource/fixture-db/conn9')).toBeNull()
  })
  it('rejects removed per-feature schemes', () => {
    expect(parseCoreUiUri('gallery://s7')).toBeNull()
  })
  it('leaves external file identities to canonical file locations', () => {
    expect(parseCoreUiUri('file:///abs/src/store.ts')).toBeNull()
    expect(parseCoreUiUri('file:///abs/a.ts#L42')).toBeNull()
  })
  it('a subsystem scheme is not a core target (owned by its feature contrib)', () => {
    // Container/cluster hit grammars are recognised by their own UI-anchor contribution;
    // the core parser deliberately treats them as unknown.
    expect(parseCoreUiUri('weird://abc123')).toBeNull()
  })
  it('settings tab + anchor', () => {
    expect(parseCoreUiUri('localix://ui/settings/editor/editor-on-save/editor.save')).toEqual({
      kind: 'settings',
      tab: 'editor',
      anchor: 'editor-on-save',
      entryId: 'editor.save',
    })
    expect(parseCoreUiUri('localix://ui/settings/preferences')).toEqual({
      kind: 'settings',
      tab: 'preferences',
      anchor: undefined,
    })
    expect(
      parseCoreUiUri('localix://ui/settings/permissions/plugin-sample-plugin?scope=PRJ-1'),
    ).toEqual({
      kind: 'settings',
      tab: 'permissions',
      anchor: 'plugin-sample-plugin',
      scope: 'PRJ-1',
    })
    expect(parseCoreUiUri('localix://ui/settings/permissions?unknown=value')).toBeNull()
    expect(parseCoreUiUri('localix://ui/settings/permissions?scope=a&scope=b')).toBeNull()
  })
  it('command', () => {
    setUiCommands([
      {
        id: 'view.global-search',
        label: 'Global search',
        effect: 'read',
        run: () => {},
      },
    ])
    expect(parseCoreUiUri('localix://ui/command/view.global-search')).toEqual({
      kind: 'command',
      commandId: 'view.global-search',
    })
  })
  it('unknown scheme → unknown', () => {
    expect(parseCoreUiUri('weird://x')).toBeNull()
  })
})

describe('navigateUi', () => {
  it('resolves strict feature-owned query arguments through the live registry', () => {
    registerUiLocation(globalSearchSurface)

    expect(
      resolveUiNavigation('localix://ui/work-item/global-search?query=auth+failure&scope=files'),
    ).toEqual({
      kind: 'inspector',
      target: 'global-search',
      query: 'auth failure',
      searchScope: 'files',
    })
    expect(resolveUiNavigation('localix://ui/work-item/global-search?unknown=value')).toBeNull()
    expect(resolveUiNavigation('localix://ui/work-item/global-search?scope=not-a-scope')).toBeNull()
  })

  function spyDeps() {
    const calls: string[] = []
    const deps: UiNavigationHost = {
      open: (target) => {
        if (target.kind === 'session' || target.kind === 'message') {
          calls.push(`session:${target.sessionId}`)
        } else if (target.kind === 'project') {
          calls.push(`project:${target.projectId}`)
        } else if (target.kind === 'settings') {
          calls.push(`settings:${target.tab}:${target.anchor ?? ''}:${target.scope ?? ''}`)
        } else if (target.kind === 'command') {
          calls.push(`command:${target.commandId}`)
        }
      },
    }
    return { calls, deps }
  }

  it('routes each target to the right navigator', () => {
    const { calls, deps } = spyDeps()
    setUiCommands([{ id: 'c1', label: 'C1', effect: 'read', run: () => {} }])
    navigateUi('localix://ui/settings/permissions/a/permissions.entry', deps)
    invokeUi('localix://ui/command/c1', deps)
    expect(calls).toEqual(['settings:permissions:a:', 'command:c1'])
  })

  it('unknown target is a no-op', () => {
    const { calls, deps } = spyDeps()
    const opened = navigateUi('weird://x', deps)
    expect(opened).toBe(false)
    expect(calls).toEqual([])
  })

  it('treats unknown UI locations as unavailable', () => {
    expect(resolveUiNavigation('ui://views/not-registered')).toBeNull()
    expect(canNavigateUi('ui://views/not-registered')).toBe(false)
  })

  it('accepts only a registered canonical Localix command URI', () => {
    setUiCommands([
      {
        id: 'view.known',
        label: 'Known command',
        effect: 'read',
        run: () => {},
      },
    ])

    expect(resolveUiNavigation('localix://ui/command/view.known')).toEqual({
      kind: 'command',
      commandId: 'view.known',
    })
    for (const uri of [
      'localix://ui/command/view.unknown',
      'localix://ui/command/view.known?unexpected=true',
      'localix://ui/command/view.known#fragment',
      'localix://user@ui/command/view.known',
      'localix://ui:1234/command/view.known',
    ]) {
      expect(resolveUiNavigation(uri)).toBeNull()
      expect(canNavigateUi(uri)).toBe(false)
    }
  })

  it('executes the same URI from a serializable agent action', () => {
    const { calls, deps } = spyDeps()
    expect(
      navigateUiAction(
        {
          type: 'ui.navigate',
          label: 'Open sample plugin',
          uri: 'localix://ui/settings/permissions/plugin-sample-plugin?scope=PRJ-1',
        },
        deps,
      ),
    ).toBe(true)
    expect(calls).toEqual(['settings:permissions:plugin-sample-plugin:PRJ-1'])
  })

  it('uses a separate navigation URI when the hit identity is not openable', () => {
    const { calls, deps } = spyDeps()
    expect(
      activateSearchHit(
        {
          id: 'localix://resource/model/openai%2Fgpt',
          uri: 'localix://ui/settings/permissions?scope=PRJ-1',
        },
        deps,
      ),
    ).toBe(true)
    expect(calls).toEqual(['settings:permissions::PRJ-1'])
  })

  it('grants write authority only to a canonical client command search hit', () => {
    const { calls, deps } = spyDeps()
    setUiCommands([
      {
        id: 'state.reset',
        label: 'Reset state',
        effect: 'write',
        run: () => {},
      },
    ])
    const id = 'localix://ui/action/command/state.reset'

    expect(activateSearchHit({ id, domain: 'plugins' }, deps)).toBe(false)
    expect(calls).toEqual([])
    expect(activateSearchHit({ id, domain: 'commands' }, deps)).toBe(true)
    expect(calls).toEqual(['command:state.reset'])
  })
})
