/**
 * REST client for this plugin's own backend.
 *
 * `BASE` is the mount path declared in `backend/index.ts` (`routeMount.path`). The plugin's
 * directory was renamed to `external-agents` while the mount kept its original spelling, so the two
 * are deliberately not assumed to match — this constant is the single place the coupling lives.
 *
 * The backend answers failures as `{ error, detail? }` with a non-2xx status — the same shape the
 * database workbench uses. `error` is the sentence a surface shows; `detail` is the raw text of
 * whatever foreign directory would not be read, which belongs in the Event Center and nowhere else.
 */
import { pluginApiFetch, postPluginJson as postJson } from '@localixai/plugin-sdk/ui/transport'
import type {
  ExternalAgentStats,
  AgentItemsSlice,
  Bounded,
  ProviderStatus,
  RosterQuery,
  RosterRow,
} from '../model/types'

const BASE = '/rpc/agent-sessions'

/** A failed call, carrying the backend's own sentence and the raw text behind it. */
export class ExternalAgentsApiError extends Error {
  readonly detail?: string
  constructor(message: string, detail?: string) {
    super(message)
    this.name = 'ExternalAgentsApiError'
    this.detail = detail
  }
}

async function readOr<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; detail?: string })
    | null
  // A 200 that still carries `error` is treated as a failure: the backend uses the field as its
  // single failure channel, and trusting the status alone would render a half-empty success.
  if (!res.ok || (json && typeof json.error === 'string')) {
    throw new ExternalAgentsApiError(json?.error ?? `Request failed (${res.status})`, json?.detail)
  }
  return json as T
}

export const externalAgentsApi = {
  async providers(): Promise<ProviderStatus[]> {
    const res = await pluginApiFetch(`${BASE}/providers`, { method: 'GET' })
    return (await readOr<{ providers: ProviderStatus[] }>(res)).providers
  },

  /** One bounded page of the roster. Filtering happens server-side — see `useRoster`. */
  async roster(query: RosterQuery): Promise<Bounded<RosterRow>> {
    return await readOr<Bounded<RosterRow>>(await postJson(`${BASE}/roster`, { query }))
  },

  /**
   * One session's transcript, already projected onto our native item model.
   *
   * `/items` and not `/transcript`: the projection lives on the server
   * (backend/transcript/to-agent-items.ts), so the UI renders a foreign history through the
   * transcript stack it already has instead of learning a second event vocabulary.
   */
  /** Aggregates folded from the index — never a second disk scan. */
  async stats(input: {
    providers?: readonly string[]
    days?: number
    cwdPrefix?: string
  }): Promise<ExternalAgentStats> {
    return await readOr<ExternalAgentStats>(await postJson(`${BASE}/stats`, input))
  },

  async items(key: string, maxEvents?: number, tail?: boolean): Promise<AgentItemsSlice> {
    const res = await postJson(`${BASE}/items`, {
      key,
      ...(maxEvents === undefined ? {} : { maxEvents }),
      ...(tail === undefined ? {} : { tail }),
    })
    return await readOr<AgentItemsSlice>(res)
  },
}
