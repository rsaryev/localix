import { describe, expect, test } from 'bun:test'
import { routeCanRun, routeReadiness, type RouteConnection } from './route-readiness'

const catalog = [
  { providerId: 'openrouter', id: 'deepseek/deepseek-v4.1-flash' },
  { providerId: 'openai', id: 'gpt-6-luna' },
  // The same bare id served by two providers (proxied catalogs).
  { providerId: 'openai', id: 'shared-model' },
  { providerId: 'azure', id: 'shared-model' },
]
const DEEPSEEK = 'openrouter/deepseek/deepseek-v4.1-flash'

const conn = (id: string, providerId: string, usable?: boolean): RouteConnection => ({
  id,
  providerId,
  ...(usable === undefined ? {} : { usable }),
})

describe('routeReadiness', () => {
  test('no model is not a route', () => {
    expect(routeReadiness({ modelId: '' }, [conn('or', 'openrouter')], catalog)).toEqual({
      status: 'no-model',
    })
    expect(routeReadiness({ modelId: null }, [], catalog).status).toBe('no-model')
  })

  test('the stored connection runs the route when it still exists and owns the model', () => {
    expect(
      routeReadiness(
        { modelId: DEEPSEEK, providerConnectionId: 'or' },
        [conn('or', 'openrouter')],
        catalog,
      ),
    ).toEqual({ status: 'ready', providerId: 'openrouter', connectionId: 'or', rebound: false })
  })

  test('a deleted connection rebinds to another account of the same provider', () => {
    // The reported bug: the old OpenRouter connection was deleted and a new one signed in.
    expect(
      routeReadiness(
        { modelId: DEEPSEEK, providerConnectionId: 'deleted' },
        [conn('openai-1', 'openai'), conn('or-new', 'openrouter')],
        catalog,
      ),
    ).toEqual({ status: 'ready', providerId: 'openrouter', connectionId: 'or-new', rebound: true })
  })

  test('a route stored with no connection at all binds the same way', () => {
    expect(
      routeReadiness(
        { modelId: DEEPSEEK, providerConnectionId: null },
        [conn('or', 'openrouter')],
        catalog,
      ),
    ).toMatchObject({ status: 'ready', connectionId: 'or', rebound: true })
  })

  test("with the provider's accounts all gone, the route waits for a connection", () => {
    expect(
      routeReadiness(
        { modelId: DEEPSEEK, providerConnectionId: 'deleted' },
        [conn('o', 'openai')],
        catalog,
      ),
    ).toEqual({ status: 'no-connection', providerId: 'openrouter' })
  })

  test('a connection without a usable key is skipped for one that has one', () => {
    const connections = [conn('or-broken', 'openrouter', false), conn('or-ok', 'openrouter')]
    expect(
      routeReadiness(
        { modelId: DEEPSEEK, providerConnectionId: 'or-broken' },
        connections,
        catalog,
      ),
    ).toMatchObject({ status: 'ready', connectionId: 'or-ok', rebound: true })
    expect(
      routeReadiness(
        { modelId: DEEPSEEK, providerConnectionId: 'or-broken' },
        [conn('or-broken', 'openrouter', false)],
        catalog,
      ),
    ).toEqual({ status: 'no-connection', providerId: 'openrouter' })
  })

  test('a stored connection of another provider does not carry the model across', () => {
    expect(
      routeReadiness(
        { modelId: DEEPSEEK, providerConnectionId: 'openai-1' },
        [conn('openai-1', 'openai'), conn('or', 'openrouter')],
        catalog,
      ),
    ).toMatchObject({
      status: 'ready',
      providerId: 'openrouter',
      connectionId: 'or',
      rebound: true,
    })
  })

  test('several accounts of one provider: the first usable one, in list order', () => {
    expect(
      routeReadiness(
        { modelId: 'gpt-6-luna', providerConnectionId: 'gone' },
        [conn('o-1', 'openai'), conn('o-2', 'openai')],
        catalog,
      ),
    ).toMatchObject({ status: 'ready', connectionId: 'o-1' })
  })

  test('a bare id two providers serve runs on the stored one while it lives', () => {
    expect(
      routeReadiness(
        { modelId: 'shared-model', providerConnectionId: 'az' },
        [conn('o', 'openai'), conn('az', 'azure')],
        catalog,
      ),
    ).toEqual({ status: 'ready', providerId: 'azure', connectionId: 'az', rebound: false })
  })

  test('a bare id two providers serve fails closed once the stored connection is gone', () => {
    expect(
      routeReadiness(
        { modelId: 'shared-model', providerConnectionId: 'deleted' },
        [conn('o', 'openai'), conn('az', 'azure')],
        catalog,
      ),
    ).toEqual({ status: 'ambiguous', providerIds: ['azure', 'openai'] })
  })

  test('a live model the catalog does not list belongs to the provider its id is namespaced by', () => {
    expect(
      routeReadiness(
        { modelId: 'openrouter/vendor/brand-new', providerConnectionId: 'gone' },
        [conn('or', 'openrouter')],
        catalog,
      ),
    ).toMatchObject({ status: 'ready', providerId: 'openrouter', connectionId: 'or' })
  })

  test('an unknown bare id has no owner and does not run', () => {
    expect(
      routeReadiness(
        { modelId: 'mystery', providerConnectionId: 'or' },
        [conn('or', 'openrouter')],
        catalog,
      ),
    ).toEqual({ status: 'no-connection', providerId: null })
  })

  test('routeCanRun is exactly the ready status', () => {
    const connections = [conn('or', 'openrouter')]
    expect(
      routeCanRun({ modelId: DEEPSEEK, providerConnectionId: null }, connections, catalog),
    ).toBe(true)
    expect(routeCanRun({ modelId: DEEPSEEK }, [], catalog)).toBe(false)
    expect(routeCanRun({ modelId: '' }, connections, catalog)).toBe(false)
  })
})
