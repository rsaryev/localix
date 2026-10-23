import { afterEach, describe, expect, test } from 'bun:test'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'

import { DockerApiError, dockerApi } from '../docker/ui/dockerApi'
import { KubeApiError } from '../kubernetes/ui/api/transport'
import { get as kubeGet } from '../kubernetes/ui/api/transport'

let unbind: (() => void) | null = null

afterEach(() => {
  unbind?.()
  unbind = null
})

/** Answer every mini app request with `body` at `status`, recording what was asked. */
function answer(status: number, body: unknown) {
  const calls: Array<{ path: string; method: string }> = []
  unbind = bindMiniAppUiTransport({
    request: async (path, init) => {
      calls.push({ path, method: init?.method ?? 'GET' })
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
    url: (path) => path,
  })
  return calls
}

const failure = {
  error: 'Docker is not running',
  code: 'engine_unavailable',
  detail: 'socket closed',
}

describe('DevOps RPC errors', () => {
  test('a Docker failure becomes a typed DockerApiError naming its request', async () => {
    const calls = answer(503, failure)
    const error = await dockerApi.listContainers().catch((cause: unknown) => cause)
    expect(calls).toEqual([{ path: '/rpc/docker/containers', method: 'GET' }])
    expect(error).toBeInstanceOf(DockerApiError)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'DockerApiError',
      message: 'Docker is not running',
      code: 'engine_unavailable',
      detail: 'socket closed',
    })
    expect((error as DockerApiError).request?.method).toBe('GET')
  })

  test('a Kubernetes failure becomes a typed KubeApiError naming its request', async () => {
    answer(500, { ...failure, error: 'Cluster unreachable', code: 'kube_error' })
    const error = await kubeGet('/pods').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(KubeApiError)
    expect(error).toMatchObject({
      name: 'KubeApiError',
      message: 'Cluster unreachable',
      code: 'kube_error',
      detail: 'socket closed',
    })
    expect((error as KubeApiError).request?.method).toBe('GET')
  })

  test('an ok body with an `error` field is still a failure; a clean body is returned', async () => {
    answer(200, { error: 'half done' })
    await expect(kubeGet('/pods')).rejects.toBeInstanceOf(KubeApiError)
    answer(200, { containers: [] })
    expect(await dockerApi.listContainers()).toEqual([])
  })

  test('the errors stay constructible by hand, as the models and their tests build them', () => {
    const error = new DockerApiError('gone', 'engine_unavailable', undefined, {
      prerequisite: undefined,
    })
    expect(error).toMatchObject({ name: 'DockerApiError', message: 'gone' })
    expect(new KubeApiError('x', undefined, 'd').detail).toBe('d')
  })
})
