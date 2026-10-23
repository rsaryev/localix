/**
 * DOCKER search provider (agent-core search) — matches container names/images + image
 * repos over the host container engine. `lazy`: it shells out to the `docker` CLI, so
 * it runs ONLY when the Docker scope is explicitly selected and never stalls a default
 * query. Hit ids reuse the `localix://resource/docker` grammar.
 *
 * WHY IT ANSWERS `{ hits, problem }`. The two listings behind this provider fail
 * independently and for the same reason almost every time: the daemon is not running.
 * Catching both to `[]` made a stopped Docker indistinguishable from a query that
 * genuinely matched nothing — the person searching `nginx` was told "no results" while
 * their container sat there, stopped only in the sense that its engine was. Each catch
 * now keeps its partial answer AND states what was lost.
 *
 * The sentence is not written here: `mapDockerError` already owns the stderr→code
 * classification this workbench uses everywhere else (the resource tree mints its
 * notices from the same call), and `toErrorInfo` already puts the friendly sentence in
 * `message` with the CLI's raw words in `detail`. That IS the `Problem` shape.
 */
import type {
  SearchHit,
  SearchProvider,
  SearchProviderResult,
} from '@localixai/mini-app-sdk/backend'
import { bestFieldScore, buildResourceUri } from '@localixai/mini-app-sdk/backend'
import { mapDockerError, toErrorInfo } from './errors'
import { PROVIDER } from './resource-nodes'

export interface DockerSearchContainer {
  id: string
  name: string
  image: string
  state: string
}
export interface DockerSearchImage {
  id: string
  repository: string
  tag: string
}

export interface DockerSearchPort {
  listContainers(): Promise<DockerSearchContainer[]>
  listImages(): Promise<DockerSearchImage[]>
}

export function createDockerSearchProvider(port: DockerSearchPort): SearchProvider {
  return {
    id: 'devops:docker-search',
    title: 'Docker',
    tier: 'lazy',
    icon: 'container',
    async search(_userId, query): Promise<SearchProviderResult> {
      const failures: unknown[] = []
      const [containers, images] = await Promise.all([
        port.listContainers().catch((err: unknown) => {
          failures.push(err)
          return [] as DockerSearchContainer[]
        }),
        port.listImages().catch((err: unknown) => {
          failures.push(err)
          return [] as DockerSearchImage[]
        }),
      ])
      const hits: SearchHit[] = []
      for (const c of containers) {
        const score = bestFieldScore([c.name, c.image], query.text)
        if (score <= 0) continue
        hits.push({
          id: buildResourceUri(PROVIDER, [c.id]),
          domain: 'devops:docker-search',
          title: c.name,
          subtitle: `${c.state} · ${c.image}`,
          icon: 'container',
          score,
        })
      }
      for (const i of images) {
        const label = i.tag && i.tag !== '<none>' ? `${i.repository}:${i.tag}` : i.repository
        const score = bestFieldScore([i.repository, label], query.text)
        if (score <= 0) continue
        hits.push({
          id: buildResourceUri(PROVIDER, ['image', i.id]),
          domain: 'devops:docker-search',
          title: label,
          subtitle: 'image',
          icon: 'container',
          score,
        })
      }
      // Both listings fail together whenever the daemon is down, so the FIRST failure
      // is the whole story — two rows saying "Docker is not available" is noise.
      if (failures.length === 0) return { hits }
      const info = toErrorInfo(mapDockerError(failures[0]))
      return { hits, problem: { field: info.code, message: info.message, detail: info.detail } }
    },
  }
}
