import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { UiLocationContribution, UiLocationParamSchema } from '@localixai/plugin-sdk/ui'
import { setEnabledPluginNames } from './pluginActivation'
import {
  createUiLocationRegistry,
  pluginLocationId,
  parseUiLocationArgs,
  subscribeUiLocations,
  type UiLocationRegistry,
  uiLocationRevision,
} from './uiLocations'

const workItem = (title: string, payload?: Record<string, unknown>) => ({
  kind: 'work-item' as const,
  workKind: 'ui-location-fixture',
  id: `fixture:${title}`,
  title,
  ...(payload ? { payload } : {}),
})

function location(
  id: string,
  overrides: Partial<UiLocationContribution> = {},
): UiLocationContribution {
  return {
    id,
    uri: `localix://ui/work-item/${id}/open`,
    title: id,
    effect: 'read',
    surface: 'work-item',
    exposure: {},
    resolve: () => workItem(id),
    ...overrides,
  }
}

function registerSearchLocation(
  registry: UiLocationRegistry,
  id: string,
  title: string,
  exposure: { agent?: boolean; search?: boolean } = {},
): void {
  expect(
    registry.register(
      location(id, {
        title,
        description: `${title} destination`,
        ...(exposure.agent ? { agent: { description: `Open the ${title} destination.` } } : {}),
        keywords: [`${id}-keyword`],
        exposure: exposure.search === undefined ? {} : { search: exposure.search },
      }),
    ),
  ).toBe(true)
}

afterEach(() => setEnabledPluginNames(null))

describe('parseUiLocationArgs', () => {
  const schema = {
    query: { type: 'string', optional: true, maxLength: 12 },
    mode: { type: 'string', values: ['reuse', 'new'] },
    focus: { type: 'boolean', optional: true },
    line: { type: 'integer', optional: true, minimum: 1, maximum: 100 },
    tag: { type: 'string-array', optional: true, maxItems: 3, maxLength: 8 },
  } as const satisfies UiLocationParamSchema

  test('parses strict scalar values and preserves repeated array parameters', () => {
    const params = new URLSearchParams('query=auth&mode=new&focus=false&line=42&tag=git&tag=review')

    expect(parseUiLocationArgs(schema, params)).toEqual({
      query: 'auth',
      mode: 'new',
      focus: false,
      line: 42,
      tag: ['git', 'review'],
    })
  })

  test('rejects unknown, duplicate scalar, malformed, missing, and oversized arguments', () => {
    const rejected = [
      'mode=new&unknown=value',
      'mode=new&mode=reuse',
      'mode=new&focus=1',
      'mode=new&line=1.5',
      'mode=new&line=101',
      'mode=unsupported',
      'query=auth',
      'mode=new&query=longer-than-12',
      'mode=new&tag=one&tag=two&tag=three&tag=four',
      'mode=new&tag=',
    ]

    for (const query of rejected) {
      expect(parseUiLocationArgs(schema, new URLSearchParams(query))).toBeNull()
    }
  })
})

describe('UiLocationRegistry', () => {
  test('builds encoded URIs and resolves typed arguments, target, and presentation', () => {
    const registry = createUiLocationRegistry()
    const terminalParams = {
      cwd: { type: 'string', optional: true },
      mode: { type: 'string', optional: true, values: ['reuse', 'new'] },
      focus: { type: 'boolean', optional: true },
      line: { type: 'integer', optional: true, minimum: 1 },
      tag: { type: 'string-array', optional: true },
    } as const satisfies UiLocationParamSchema
    const terminal: UiLocationContribution<typeof terminalParams> = {
      id: 'terminal.open',
      uri: 'localix://ui/work-item/terminal/open',
      title: 'Open terminal',
      description: 'Open a terminal without executing input',
      effect: 'read',
      surface: 'work-item',
      params: terminalParams,
      exposure: { search: true },
      present: (args) => ({
        label: args.cwd ? `Open terminal in ${args.cwd}` : 'Open terminal',
        description: args.mode === 'new' ? 'In a new terminal' : 'In the current terminal',
      }),
      resolve: (args) => ({
        kind: 'inspector',
        target: 'terminal',
        terminalMode: args.mode,
        sessionId: args.focus ? `line:${args.line ?? 1}` : undefined,
      }),
    }
    expect(registry.register(terminal)).toBe(true)

    const uri = registry.build('terminal.open', {
      cwd: 'apps/api & docs',
      mode: 'new',
      focus: true,
      line: 7,
      tag: ['git', 'review'],
    })

    expect(uri).toBe(
      'localix://ui/work-item/terminal/open?cwd=apps%2Fapi+%26+docs&mode=new&focus=true&line=7&tag=git&tag=review',
    )
    expect(registry.resolve(uri!)).toEqual({
      descriptor: {
        id: 'terminal.open',
        uri: 'localix://ui/work-item/terminal/open',
        title: 'Open terminal',
        description: 'Open a terminal without executing input',
        keywords: [],
        effect: 'read',
        surface: 'work-item',
        params: terminalParams,
        exposure: { search: true },
      },
      args: {
        cwd: 'apps/api & docs',
        mode: 'new',
        focus: true,
        line: 7,
        tag: ['git', 'review'],
      },
      target: {
        kind: 'inspector',
        target: 'terminal',
        terminalMode: 'new',
        sessionId: 'line:7',
      },
      presentation: {
        label: 'Open terminal in apps/api & docs',
        description: 'In a new terminal',
      },
    })
  })

  test('fails closed when building or resolving invalid location URIs', () => {
    const registry = createUiLocationRegistry()
    expect(
      registry.register(
        location('strict', {
          params: {
            required: { type: 'string' },
            enabled: { type: 'boolean', optional: true },
            count: { type: 'integer', optional: true, minimum: 1 },
            tag: { type: 'string-array', optional: true, maxItems: 2 },
          },
        }),
      ),
    ).toBe(true)

    expect(registry.build('missing')).toBeNull()
    expect(registry.build('strict')).toBeNull()
    expect(registry.build('strict', { required: 'yes', extra: 'no' })).toBeNull()
    expect(registry.build('strict', { required: 'yes', enabled: 'true' })).toBeNull()
    expect(registry.build('strict', { required: 'yes', count: 0 })).toBeNull()
    expect(registry.build('strict', { required: 'yes', tag: ['a', 'b', 'c'] })).toBeNull()

    expect(
      registry.resolve('localix://ui/work-item/strict/open?required=yes&unknown=no'),
    ).toBeNull()
    expect(registry.owns('localix://ui/work-item/strict/open?required=yes&unknown=no')).toBe(true)
    expect(
      registry.resolve(
        'localix://ui/work-item/strict/open?required=yes&enabled=true&enabled=false',
      ),
    ).toBeNull()
    expect(registry.resolve('localix://ui/work-item/strict/open?required=yes#fragment')).toBeNull()
    expect(registry.resolve('not a uri')).toBeNull()
  })

  test('strictly canonicalizes ownership and rejects credential or dot-segment aliases', () => {
    const registry = createUiLocationRegistry()
    expect(
      registry.register(
        location('terminal', {
          uri: 'localix://ui/work-item/%74erminal',
        }),
      ),
    ).toBe(true)
    expect(registry.list()[0]?.uri).toBe('localix://ui/work-item/terminal')
    expect(
      registry.register(
        location('terminal-alias', {
          uri: 'localix://ui/work-item/terminal',
        }),
      ),
    ).toBe(false)

    for (const uri of [
      'localix://user@ui/work-item/terminal',
      'localix://user:password@ui/work-item/terminal',
      'localix://ui/work-item/x/../terminal',
      'localix://ui/work-item/x/%2e%2e/terminal',
    ]) {
      expect(registry.owns(uri)).toBe(false)
      expect(registry.resolve(uri)).toBeNull()
    }
  })

  test('rejects invalid definitions and collisions without replacing the first owner', () => {
    const registry = createUiLocationRegistry()
    const first = location('first', {
      uri: 'localix://ui/work-item/shared/open',
      title: 'First owner',
      resolve: () => workItem('first'),
    })
    const warn = spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(registry.register(first)).toBe(true)
      expect(
        registry.register(location('first', { uri: 'localix://ui/work-item/other/open' })),
      ).toBe(false)
      expect(
        registry.register(location('second', { uri: 'localix://ui/work-item/shared/open' })),
      ).toBe(false)
      expect(
        registry.register(
          location('query-base', {
            uri: 'localix://ui/work-item/query/open?x=1',
          }),
        ),
      ).toBe(false)
      expect(registry.register(location('', { uri: 'localix://ui/work-item/empty/open' }))).toBe(
        false,
      )

      expect(registry.resolve('localix://ui/work-item/shared/open')?.presentation.label).toBe(
        'First owner',
      )
      expect(registry.resolve('localix://ui/work-item/other/open')).toBeNull()
      // Every rejection reports itself now, not only the two collisions: the four
      // registrations that returned false above each named the rule they broke. The
      // count is asserted per cause rather than in total, so a NEW silent rejection
      // path cannot hide inside a bumped number.
      const reported = warn.mock.calls.map((call) => String(call[0]))
      expect(reported.filter((line) => line.includes('duplicate'))).toHaveLength(2)
      expect(reported.filter((line) => line.includes('rejected'))).toHaveLength(2)
      expect(reported.join('\n')).toContain('is not a canonical work-item base URI')
      expect(reported.join('\n')).toContain('id must be lowercase')
    } finally {
      warn.mockRestore()
    }
  })

  test('rejects missing or unknown required metadata after a runtime type bypass', () => {
    const registry = createUiLocationRegistry()
    const valid = location('metadata.valid')
    const { effect: _effect, ...withoutEffect } = valid
    const { surface: _surface, ...withoutSurface } = valid
    const { exposure: _exposure, ...withoutExposure } = valid

    for (const malformed of [
      withoutEffect,
      withoutSurface,
      withoutExposure,
      { ...valid, id: 'metadata.bad-effect', effect: 'execute' },
      { ...valid, id: 'metadata.bad-surface', surface: 'dialog' },
      { ...valid, id: 'metadata.bad-exposure-key', exposure: { sidebar: true } },
      { ...valid, id: 'metadata.bad-exposure-value', exposure: { agent: 'yes' } },
      {
        ...valid,
        id: 'metadata.write-without-schema',
        effect: 'write',
        surface: 'action',
      },
      {
        ...valid,
        id: 'metadata.write-wrong-surface',
        effect: 'write',
        params: {},
      },
      { ...valid, id: 'metadata.read-action', surface: 'action' },
    ]) {
      expect(registry.register(malformed as UiLocationContribution)).toBe(false)
    }

    expect(registry.list()).toEqual([])
    expect(registry.revision()).toBe(0)
  })

  test('rejects agent-exposed writes and requires explicit trusted access for other writes', () => {
    const registry = createUiLocationRegistry()
    const writeLocation = location('state.reset', {
      uri: 'localix://ui/action/state/reset',
      title: 'Reset state',
      effect: 'write',
      surface: 'action',
      params: {},
      exposure: { search: true },
      resolve: () => ({
        kind: 'command',
        commandId: 'state.reset',
      }),
    })

    expect(
      registry.register({
        ...writeLocation,
        id: 'state.agent-reset',
        uri: 'localix://ui/action/state/agent-reset',
        agent: { description: 'Reset application state.' },
        exposure: {},
      }),
    ).toBe(false)
    expect(registry.register(writeLocation)).toBe(true)

    expect(registry.list({ exposure: 'agent' })).toEqual([])
    expect(registry.build('state.reset')).toBeNull()
    expect(registry.resolve('localix://ui/action/state/reset')).toBeNull()

    const uri = registry.build('state.reset', {}, { allowWrite: true })
    expect(uri).toBe('localix://ui/action/state/reset')
    expect(registry.resolve(uri!, { allowWrite: true })?.descriptor).toMatchObject({
      id: 'state.reset',
      effect: 'write',
    })
  })

  test('searches only requested exposure, ranks title matches, and enforces the limit', () => {
    const registry = createUiLocationRegistry()
    registerSearchLocation(registry, 'terminal', 'Terminal', { agent: true, search: true })
    registerSearchLocation(registry, 'terminal-settings', 'Terminal settings', { search: true })
    registerSearchLocation(registry, 'logs', 'Runtime logs', { agent: true })
    registerSearchLocation(registry, 'hidden', 'Terminal diagnostics')

    expect(registry.search('terminal', { exposure: 'agent' }).map((entry) => entry.id)).toEqual([
      'terminal',
    ])
    expect(registry.search('terminal', { exposure: 'search' }).map((entry) => entry.id)).toEqual([
      'terminal',
      'terminal-settings',
    ])
    expect(registry.search('runtime', { exposure: 'agent' }).map((entry) => entry.id)).toEqual([
      'logs',
    ])
    expect(registry.search('', { limit: 2 })).toHaveLength(2)
    expect(registry.search('', { limit: 0 })).toHaveLength(1)
  })

  test('increments revision for catalog changes and notifies until unsubscribed', () => {
    const registry = createUiLocationRegistry()
    let notifications = 0
    const unsubscribe = registry.subscribe(() => {
      notifications += 1
    })

    expect(registry.revision()).toBe(0)
    expect(registry.register(location('one'))).toBe(true)
    expect(registry.revision()).toBe(1)
    expect(notifications).toBe(1)

    registry.refresh()
    expect(registry.revision()).toBe(2)
    expect(notifications).toBe(2)

    unsubscribe()
    expect(registry.register(location('two'))).toBe(true)
    expect(registry.revision()).toBe(3)
    expect(notifications).toBe(2)
  })

  test('deeply snapshots accepted metadata and batches changes atomically', () => {
    const registry = createUiLocationRegistry()
    const params = {
      query: {
        type: 'string' as const,
        description: 'Initial query.',
        optional: true,
        values: ['one', 'two'],
      },
    }
    const keywords = ['initial']
    const contribution = location('immutable', {
      keywords,
      params,
    })
    expect(registry.register(contribution)).toBe(true)
    const revision = registry.revision()

    keywords.push('mutated')
    params.query.values.push('three')
    expect(registry.list()[0]?.keywords).toEqual(['initial'])
    expect(registry.list()[0]?.params.query).toMatchObject({ values: ['one', 'two'] })
    expect(registry.revision()).toBe(revision)

    let notifications = 0
    const unsubscribe = registry.subscribe(() => notifications++)
    expect(
      registry.batch(() => {
        registry.unregister('immutable')
        registry.register(location('replacement'))
        return true
      }),
    ).toBe(true)
    expect(registry.list().map((entry) => entry.id)).toEqual(['replacement'])
    expect(notifications).toBe(1)

    expect(
      registry.batch(() => {
        registry.unregister('replacement')
        registry.register(location('temporary'))
        return false
      }),
    ).toBe(false)
    expect(registry.list().map((entry) => entry.id)).toEqual(['replacement'])
    expect(notifications).toBe(1)
    unsubscribe()
  })

  test('removes dynamic locations atomically and invalidates their old URIs', () => {
    const registry = createUiLocationRegistry()
    const uri = 'localix://ui/work-item/dynamic/open'

    expect(registry.register(location('dynamic', { uri }))).toBe(true)
    expect(registry.build('dynamic')).toBe(uri)
    expect(registry.resolve(uri)?.descriptor.id).toBe('dynamic')
    expect(registry.revision()).toBe(1)

    expect(registry.unregister('dynamic')).toBe(true)
    expect(registry.list()).toEqual([])
    expect(registry.owns(uri)).toBe(false)
    expect(registry.build('dynamic')).toBeNull()
    expect(registry.resolve(uri)).toBeNull()
    expect(registry.revision()).toBe(2)

    expect(registry.unregister('dynamic')).toBe(false)
    expect(registry.revision()).toBe(2)
  })

  test('publishes plugin activation changes as live singleton catalog revisions', () => {
    const startRevision = uiLocationRevision()
    let notifications = 0
    const unsubscribe = subscribeUiLocations(() => {
      notifications += 1
    })

    setEnabledPluginNames(new Set(['ui-location-plugin']))
    expect(uiLocationRevision()).toBe(startRevision + 1)
    expect(notifications).toBe(1)

    setEnabledPluginNames(new Set())
    expect(uiLocationRevision()).toBe(startRevision + 2)
    expect(notifications).toBe(2)

    unsubscribe()
  })

  test('keeps plugin-owned definitions registered while gating every public lookup', () => {
    const registry = createUiLocationRegistry()
    expect(
      registry.register(
        location('plugin.open', {
          pluginName: 'ui-location-plugin',
          exposure: { search: true },
        }),
      ),
    ).toBe(true)

    setEnabledPluginNames(null)
    expect(registry.list()).toEqual([])
    expect(registry.search('plugin')).toEqual([])
    expect(registry.build('plugin.open')).toBeNull()
    expect(registry.resolve('localix://ui/work-item/plugin.open/open')).toBeNull()

    setEnabledPluginNames(new Set(['ui-location-plugin']))
    expect(registry.list().map((entry) => entry.id)).toEqual(['plugin.open'])
    expect(registry.search('plugin').map((entry) => entry.id)).toEqual(['plugin.open'])
    expect(registry.build('plugin.open')).toBe('localix://ui/work-item/plugin.open/open')
    expect(registry.resolve('localix://ui/work-item/plugin.open/open')?.descriptor.id).toBe(
      'plugin.open',
    )

    setEnabledPluginNames(new Set())
    expect(registry.list()).toEqual([])
    expect(registry.build('plugin.open')).toBeNull()
    expect(registry.resolve('localix://ui/work-item/plugin.open/open')).toBeNull()
  })
})

describe('rejection is reported, not swallowed', () => {
  function captureWarnings<T>(run: () => T): { result: T; warnings: string[] } {
    const warnings: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '))
    }
    try {
      return { result: run(), warnings }
    } finally {
      console.warn = original
    }
  }

  const valid = {
    id: 'diag.valid',
    uri: 'localix://ui/work-item/diag/open',
    title: 'Valid',
    effect: 'read' as const,
    surface: 'work-item' as const,
    params: {},
    exposure: { search: true },
    resolve: () => ({ kind: 'inspector' as const, target: 'terminal' as const }),
  }

  test('names the violated rule instead of returning a bare false', () => {
    const registry = createUiLocationRegistry()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ title: '' }, 'title is empty'],
      [{ id: 'Not-Lowercase' }, 'id must be lowercase'],
      [{ effect: 'write' }, 'one decision'],
      [{ exposure: { search: 'yes' } }, 'exposure must be'],
      [
        { agent: { description: 'x' }, params: { path: { type: 'string' } } },
        'needs a description',
      ],
    ]
    for (const [override, expected] of cases) {
      const { result, warnings } = captureWarnings(() =>
        registry.register({ ...valid, ...override } as never),
      )
      expect(result).toBe(false)
      expect(warnings.join('\n')).toContain(expected)
    }
  })

  test('says so when one rejected member rolls the whole batch back', () => {
    const registry = createUiLocationRegistry()
    const { result, warnings } = captureWarnings(() =>
      registry.batch(() => {
        // A group registration — plugin views and panels register exactly like this.
        if (!registry.register(valid as never)) return false
        return registry.register({ ...valid, id: 'diag.bad', title: '' } as never)
      }),
    )

    expect(result).toBe(false)
    // Both halves must be visible: which entry was bad, and that the group is gone.
    expect(warnings.join('\n')).toContain('title is empty')
    expect(warnings.join('\n')).toContain('rolled back')
    // The rollback is real — the good sibling did not survive either.
    expect(registry.list()).toEqual([])
  })

  test('a batch that throws still reports the throw, not a rollback notice', () => {
    const registry = createUiLocationRegistry()
    const { warnings } = captureWarnings(() =>
      registry.batch(() => {
        throw new Error('boom')
      }),
    )
    expect(warnings.join('\n')).toContain('atomic catalog update failed')
    expect(warnings.join('\n')).not.toContain('rolled back')
  })
})

describe('pluginLocationId', () => {
  const VALID_ID = /^[a-z0-9][a-z0-9:._-]{0,127}$/

  test('normalizes plugin-supplied names that the registry would otherwise reject', () => {
    // camelCase is ordinary in JS and the plugin contract accepts any string, so the
    // previous raw interpolation produced an invalid id for a perfectly normal manifest.
    expect(pluginLocationId('plugin-view.open', 'sample:sqlConsole')).toBe(
      'plugin-view.open.sample:sqlconsole',
    )
    expect(pluginLocationId('plugin-panel.open', 'Sample:Chart View')).toBe(
      'plugin-panel.open.sample:chart-view',
    )
  })

  test('yields a registry-valid id for hostile identity, never an invalid one', () => {
    for (const name of [
      'sample:sqlConsole',
      'Sample:Chart View',
      'ok:plain-view',
      'weird:@#$%',
      ':',
      '',
      '---',
      `${'x'.repeat(300)}:v`,
      'emoji:🚀view',
    ]) {
      expect(pluginLocationId('plugin-view.open', name)).toMatch(VALID_ID)
    }
  })

  test('keeps an already-valid name byte-identical apart from the prefix', () => {
    expect(pluginLocationId('plugin-view.open', 'sample:container-logs')).toBe(
      'plugin-view.open.sample:container-logs',
    )
  })

  test('a normalized id registers, so one odd view no longer withdraws the group', () => {
    const registry = createUiLocationRegistry()
    const view = (fullName: string) => ({
      id: pluginLocationId('plugin-view.open', fullName),
      uri: `localix://ui/plugin/view/${encodeURIComponent(fullName)}`,
      title: `View ${fullName}`,
      keywords: ['plugin'],
      effect: 'read' as const,
      surface: 'plugin' as const,
      exposure: { search: true },
      params: {},
      resolve: () => ({
        kind: 'work-item' as const,
        workKind: 'plugin-view',
        id: fullName,
        title: fullName,
      }),
    })

    const accepted = registry.batch(() => {
      if (!registry.register(view('sample:container-logs') as never)) return false
      return registry.register(view('sample:sqlConsole') as never)
    })

    expect(accepted).toBe(true)
    expect(
      registry
        .list()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(['plugin-view.open.sample:container-logs', 'plugin-view.open.sample:sqlconsole'])
  })
})
