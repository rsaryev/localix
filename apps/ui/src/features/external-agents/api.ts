import { client, unwrap } from '@/shared/api/internal'
import type { RosterQuery, StatsQuery } from '@localixai/api/external-agent-contracts'

export const externalAgentsApi = {
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
  async items(key: string, maxEvents?: number, tail?: boolean) {
    return unwrap(
      await client.rpc['external-agents'].items.$post({
        json: { key, maxEvents, tail },
      }),
    )
  },
}
