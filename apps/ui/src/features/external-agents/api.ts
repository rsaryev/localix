import { client, unwrap } from '@/shared/api/internal'
import type { RosterQuery, StatsQuery } from '@localixai/api/external-agent-contracts'
import { toUiSession } from '@/shared/api/converters'

export const externalAgentsApi = {
  async linkAgent(sessionId: string, provider: string) {
    return toUiSession(
      await unwrap(
        await client.rpc['external-agents']['link-agent'].$post({ json: { sessionId, provider } }),
      ),
    )
  },
  async attachNative(key: string, projectId?: string) {
    return unwrap(
      await client.rpc['external-agents']['attach-native'].$post({ json: { key, projectId } }),
    )
  },
  async openOwned(sessionId: string) {
    return unwrap(await client.rpc['external-agents']['open-owned'].$post({ json: { sessionId } }))
  },
  async stats(query: StatsQuery) {
    return unwrap(
      await client.rpc['external-agents'].stats.$post({
        json: { ...query, providers: query.providers ? [...query.providers] : undefined },
      }),
    )
  },
  async providers() {
    return (await unwrap(await client.rpc['external-agents'].providers.$get())).providers
  },
  async roster(query: RosterQuery) {
    return unwrap(
      await client.rpc['external-agents'].roster.$post({
        json: {
          query: {
            ...query,
            providers: query.providers ? [...query.providers] : undefined,
            states: query.states ? [...query.states] : undefined,
          },
        },
      }),
    )
  },
  async resume(key: string) {
    return unwrap(await client.rpc['external-agents'].resume.$post({ json: { key } }))
  },
  async items(key: string, maxEvents?: number, tail?: boolean) {
    return unwrap(
      await client.rpc['external-agents'].items.$post({
        json: { key, maxEvents, tail },
      }),
    )
  },
}
