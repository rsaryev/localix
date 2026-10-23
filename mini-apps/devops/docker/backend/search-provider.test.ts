import { describe, expect, test } from 'bun:test'
import { createDockerSearchProvider, type DockerSearchPort } from './search-provider'

/**
 * The one thing worth pinning here is the distinction the provider exists to make: a
 * daemon that is not running and a query that matched nothing must not produce the same
 * answer. Everything else about the provider (scoring, uri grammar) is covered by the
 * shared search-match tests.
 */
const port = (over: Partial<DockerSearchPort> = {}): DockerSearchPort => ({
  listContainers: async () => [],
  listImages: async () => [],
  ...over,
})

const search = (p: DockerSearchPort) =>
  createDockerSearchProvider(p).search('u', { text: 'nginx' }) as Promise<{
    hits: unknown[]
    problem?: { message: string; detail?: string; field?: string }
  }>

describe('docker search provider', () => {
  test('a healthy engine with no match reports nothing', async () => {
    const out = await search(port())
    expect(out.hits).toEqual([])
    expect(out.problem).toBeUndefined()
  })

  test('a dead daemon is a classified sentence, not an empty list', async () => {
    const raw = 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock'
    const out = await search(
      port({
        listContainers: async () => {
          throw new Error(raw)
        },
        listImages: async () => {
          throw new Error(raw)
        },
      }),
    )
    expect(out.hits).toEqual([])
    expect(out.problem?.field).toBe('engine_unavailable')
    expect(out.problem?.message).toBe(
      'Docker is not available — is Docker installed and the daemon running?',
    )
    // The raw CLI text is kept, and kept OUT of the sentence.
    expect(out.problem?.detail).toBe(raw)
    expect(out.problem?.message).not.toContain('unix://')
  })

  test('one failing listing keeps the other listing’s hits', async () => {
    const out = await search(
      port({
        listContainers: async () => [
          { id: 'c1', name: 'nginx', image: 'nginx:1', state: 'running' },
        ],
        listImages: async () => {
          throw new Error('boom')
        },
      }),
    )
    expect(out.hits).toHaveLength(1)
    expect(out.problem).toBeDefined()
  })
})
