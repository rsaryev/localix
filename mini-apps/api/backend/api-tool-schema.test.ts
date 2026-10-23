import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  API_ACTIONS,
  buildApiToolSchema,
  resolveTarget,
  targetProblem,
  type ApiAction,
} from './api-tool-schema'
import { API_TOOL_DESCRIPTION } from './api-tool'

describe('the model-facing intent router', () => {
  test('makes send, save, and save-then-send unambiguous without adding another tool', () => {
    expect(API_TOOL_DESCRIPTION).toContain('call/test/check/fetch now → action="send"')
    expect(API_TOOL_DESCRIPTION).toContain('action="save" (save never sends)')
    expect(API_TOOL_DESCRIPTION).toContain('exactly ONE action="batch" call')
  })
})

describe('the merge kept the vocabulary small', () => {
  test('eight domain verbs plus one batch envelope, not twelve subject-specific names', () => {
    // The reason the two tools were split was a fourteen-action enum nobody reads to the end.
    // Concatenating them would have proved that argument right; this pins that it did not happen.
    expect(API_ACTIONS.length).toBeLessThanOrEqual(9)
  })

  test('requests and environments share their verbs', () => {
    for (const verb of ['list', 'get', 'save', 'delete'] as const) {
      expect(targetProblem(verb, 'request')).toBeNull()
      expect(targetProblem(verb, 'environment')).toBeNull()
    }
  })
})

describe('the default target', () => {
  test('an omitted target is a REQUEST — the common case costs no field', () => {
    expect(resolveTarget({})).toBe('request')
  })

  test('anything that is not the environment literal is a request', () => {
    // One place decides this, so the validator, the classifier and the body cannot disagree.
    expect(resolveTarget({ target: 'environment' })).toBe('environment')
    expect(resolveTarget({ target: 'nonsense' })).toBe('request')
  })
})

describe('pairs that mean nothing are refused with a way forward', () => {
  test.each(['send', 'import', 'export'] as const)('%s on an environment', (action) => {
    const problem = targetProblem(action, 'environment')
    expect(problem).not.toBeNull()
    // A refusal that does not say what to do instead is a dead end for a model.
    expect(problem).toContain('environment')
  })

  test('`use` on a request points at the environment form', () => {
    const problem = targetProblem('use', 'request')
    expect(problem).toContain('"target":"environment"')
  })

  test('every action is either legal somewhere or explained — no silent dead ends', () => {
    for (const action of API_ACTIONS) {
      const legal = (['request', 'environment'] as const).filter(
        (target) => targetProblem(action as ApiAction, target) === null,
      )
      expect(legal.length).toBeGreaterThan(0)
    }
  })
})

describe('the schema carries both subjects', () => {
  const schema = buildApiToolSchema(z)

  test('a request send parses', () => {
    expect(schema.safeParse({ action: 'send', url: 'https://api.dev/x' }).success).toBe(true)
  })

  test('an environment save parses', () => {
    const parsed = schema.safeParse({
      action: 'save',
      target: 'environment',
      name: 'staging',
      variables: [{ name: 'base_url', value: 'https://staging.api.dev' }],
    })
    expect(parsed.success).toBe(true)
  })

  test('an environment secret is part of the unified model-facing contract', () => {
    const parsed = schema.safeParse({
      action: 'save',
      target: 'environment',
      name: 'staging',
      variables: [{ name: 'token', value: 'literal-secret', secret: true }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.variables?.[0]?.secret).toBe(true)
  })

  test('the request fields survived the merge — they are not restated, they are composed', () => {
    // `requestFields` is the one owner of forty `.describe()` strings; if the spread ever breaks,
    // the model silently loses the ability to send anything but a bare url.
    const parsed = schema.safeParse({
      action: 'send',
      url: 'https://api.dev/x',
      method: 'POST',
      headers: [{ name: 'Accept', value: 'application/json' }],
      body: '{"a":1}',
      contentType: 'application/json',
      filter: '$.a',
    })
    expect(parsed.success).toBe(true)
  })

  test('multiple dependent requests fit in one ordered batch call', () => {
    const parsed = schema.safeParse({
      action: 'batch',
      operations: [
        {
          action: 'save',
          name: 'checks/health',
          url: 'https://api.dev/health',
        },
        { action: 'send', name: 'checks/health', filter: '$.status' },
      ],
    })
    expect(parsed.success).toBe(true)
  })
})
