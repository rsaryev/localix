import { describe, expect, test } from 'bun:test'
import { buildDiagnostics, computeToolSurface, type ValidateInput } from './validate'

const RESOLVED = { providerConnectionId: 'conn-1', modelId: 'anthropic/opus' }

function baseInput(over: Partial<ValidateInput> = {}): ValidateInput {
  return {
    values: {},
    hasSession: true,
    resolvedModels: { session: RESOLVED },
    skillNames: [],
    ...over,
  }
}

describe('computeToolSurface', () => {
  test('gates nothing by itself — every catalogued tool starts enabled', () => {
    // This projection used to hide tools of its own accord: the task board unless the scope
    // named its MODE, then a session-level economy trim. Both were second answers to a question
    // the capability chain owns, and both let Settings show a tool the run never saw.
    const surface = computeToolSurface({ disabledTools: [] })
    for (const name of ['agents', 'jobs', 'skill']) {
      expect(surface.enabled).toContain(name)
    }
    expect(surface.disabled).toEqual([])
  })

  test('disabledTools removes a named tool with a settings reason', () => {
    const surface = computeToolSurface({ disabledTools: ['bash'] })
    expect(surface.enabled).not.toContain('bash')
    expect(surface.disabled.find((d) => d.name === 'bash')?.reason).toContain('disabledTools')
  })

  test('projects live plugin names through the same policy instead of omitting them', () => {
    const surface = computeToolSurface({
      disabledTools: ['plugin_write'],
      toolNames: ['read', 'plugin_search', 'plugin_write'],
    })

    expect(surface.enabled).toEqual(['read', 'plugin_search'])
    expect(surface.disabled).toEqual([
      {
        name: 'plugin_write',
        reason: 'disabled by settings (disabledTools)',
        source: 'settings',
      },
    ])
  })

  test('a structural denial wins over the settings reason for the same tool', () => {
    // A tool whose owning plugin is disabled is ABSENT, not merely denied — pointing a
    // reader at the settings switch would send them somewhere that changes nothing.
    const surface = computeToolSurface({
      disabledTools: ['plugin_write'],
      toolNames: ['read', 'plugin_write'],
      structuralDenials: [
        {
          name: 'plugin_write',
          reason: 'provided by disabled plugin "Writer"',
          source: 'capability',
        },
      ],
    })

    expect(surface.enabled).toEqual(['read'])
    expect(surface.disabled).toEqual([
      {
        name: 'plugin_write',
        reason: 'provided by disabled plugin "Writer"',
        source: 'capability',
      },
    ])
  })

  test('a scope denial is reported as a settings switch the reader can actually flip', () => {
    // `source` distinguishes "flip a switch to fix this" from "the product decided". Only the
    // first kind is left: the one other producer was a session-level economy trim, which the
    // Tools screen could not change and which reported `policy` for exactly that reason.
    const surface = computeToolSurface({ disabledTools: ['skill'], toolNames: ['skill'] })

    expect(surface.disabled).toEqual([
      { name: 'skill', reason: 'disabled by settings (disabledTools)', source: 'settings' },
    ])
  })
})

describe('buildDiagnostics', () => {
  test('resolves the main session consumer from the session model', () => {
    const { consumers, diagnostics } = buildDiagnostics(baseInput())
    const session = consumers.find((c) => c.id === 'session')!
    expect(session.usable).toBe(true)
    expect(session.modelId).toBe('anthropic/opus')
    expect(diagnostics.find((d) => d.code === 'session_model_unresolved')).toBeUndefined()
  })

  test('flags an unresolved session model as an error', () => {
    const { diagnostics, consumers } = buildDiagnostics(baseInput({ resolvedModels: {} }))
    expect(diagnostics.find((d) => d.code === 'session_model_unresolved')?.severity).toBe('error')
    expect(consumers.find((c) => c.id === 'session')?.usable).toBe(false)
  })

  test('a configured workload route that resolves is reported via model-route', () => {
    const input = baseInput({
      values: {
        modelRouting: {
          inlineCompletion: {
            enabled: true,
            providerConnectionId: 'c',
            modelId: 'anthropic/haiku',
          },
        },
      },
      resolvedModels: {
        session: RESOLVED,
        'modelRouting.inlineCompletion': {
          providerConnectionId: 'c2',
          modelId: 'anthropic/haiku',
        },
      },
    })
    const c = buildDiagnostics(input).consumers.find(
      (x) => x.id === 'modelRouting.inlineCompletion',
    )!
    expect(c.source).toBe('model-route')
    expect(c.usable).toBe(true)
    expect(c.modelId).toBe('anthropic/haiku')
  })

  test('an off workload keeps its assignment visible but does not resolve as usable', () => {
    const input = baseInput({
      values: {
        modelRouting: {
          inlineCompletion: {
            enabled: false,
            providerConnectionId: 'c',
            modelId: 'anthropic/haiku',
          },
        },
      },
      resolvedModels: { session: RESOLVED },
    })
    const c = buildDiagnostics(input).consumers.find(
      (x) => x.id === 'modelRouting.inlineCompletion',
    )!
    expect(c.source).toBe('disabled')
    expect(c.usable).toBe(false)
    expect(c.modelId).toBe('anthropic/haiku')
    expect(c.reason).toContain('off')
  })

  test('a configured but unresolved workload route warns and falls back to session', () => {
    const input = baseInput({
      values: {
        modelRouting: {
          delegation: { providerConnectionId: 'gone', modelId: 'dead/model' },
        },
      },
      resolvedModels: { session: RESOLVED },
    })
    const { diagnostics, consumers } = buildDiagnostics(input)
    expect(
      diagnostics.find(
        (d) => d.code === 'model_route_unresolved' && d.field === 'modelRouting.delegation',
      )?.severity,
    ).toBe('warning')
    const c = consumers.find((x) => x.id === 'modelRouting.delegation')!
    expect(c.source).toBe('session')
    expect(c.usable).toBe(true)
  })

  test('title generation with no slot falls back deterministically, not to a model', () => {
    const c = buildDiagnostics(baseInput()).consumers.find(
      (x) => x.id === 'modelRouting.titleGeneration',
    )!
    expect(c.source).toBe('disabled')
    expect(c.usable).toBe(true)
    expect(c.reason).toContain('truncation')
  })

  test('an enabled model route with no usable model is reported unusable', () => {
    const input = baseInput({
      values: { modelRouting: { inlineCompletion: { enabled: true } } },
      resolvedModels: {},
    })
    const c = buildDiagnostics(input).consumers.find(
      (x) => x.id === 'modelRouting.inlineCompletion',
    )!
    expect(c.usable).toBe(false)
    expect(c.source).toBe('none')
  })

  test('a skillOverride targeting a missing skill warns', () => {
    const input = baseInput({
      values: {},
      skillOverrides: { 'ghost-skill': 'off' },
      skillNames: ['real-skill'],
    })
    expect(
      buildDiagnostics(input).diagnostics.find((d) => d.code === 'skill_override_missing')
        ?.severity,
    ).toBe('warning')
  })

  test('a disabledTools entry unknown to the registry is flagged as info', () => {
    const input = baseInput({
      values: {},
      disabledTools: ['not_a_tool'],
      knownToolNames: ['bash', 'read'],
    })
    expect(
      buildDiagnostics(input).diagnostics.find((d) => d.code === 'disabled_tool_unknown')?.severity,
    ).toBe('info')
  })
})
