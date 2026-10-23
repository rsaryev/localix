import { describe, expect, test } from 'bun:test'
import type { BackendSubsystem } from '@localixai/mini-app-sdk/backend'

import { register } from './index'

describe('DevOps mini app registration', () => {
  test('owns both providers behind one mini app entrypoint', async () => {
    const contribution = await register()
    const backends: BackendSubsystem[] = Array.isArray(contribution.backend)
      ? contribution.backend
      : contribution.backend
        ? [contribution.backend]
        : []

    expect(backends.map((backend) => backend.id)).toEqual(['devops:docker', 'devops:kubernetes'])
    expect(backends.map((backend) => backend.routeMount?.path)).toEqual([
      '/rpc/docker',
      '/rpc/kubernetes',
    ])
    // The DevOps mini app contributes NO agent tools: `docker_inspect`, `kubernetes_get` and
    // `kubernetes_manage` wrapped verbs of CLIs the agent already drives through `bash`, at
    // ~1.1k tokens of schema per request. Asserted as EMPTY, not merely "not those three",
    // so a re-added tool has to come back through this test.
    expect(contribution.tools).toEqual([])

    for (const backend of backends) {
      await Promise.resolve(backend.onShutdown?.())
    }
  })
})
