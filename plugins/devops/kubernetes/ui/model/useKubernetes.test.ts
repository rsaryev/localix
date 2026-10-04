import { describe, expect, test } from 'bun:test'
import { ALL_NAMESPACES, type KubeContext, type KubeNamespace } from '../../backend/contracts'
import { collectionErrors } from './kubernetesCollections'
import { kubernetesScopeIsCurrent } from './kubernetesScope'
import { resolveActiveNamespace, resolveInitialContext } from './selection'
import { KubeApiError } from '../api/transport'

function ctx(name: string, current = false): KubeContext {
  return { name, cluster: 'c', namespace: '', current }
}
function ns(name: string): KubeNamespace {
  return { name, phase: 'Active' }
}

describe('resolveInitialContext', () => {
  const contexts = [ctx('prod'), ctx('staging', true), ctx('dev')]

  test('prefers the stored context when it still exists', () => {
    expect(resolveInitialContext('dev', contexts, 'staging')).toBe('dev')
  })

  test('falls back to current-context when the stored one is gone', () => {
    expect(resolveInitialContext('deleted', contexts, 'staging')).toBe('staging')
  })

  test('falls back to current-context when nothing is stored', () => {
    expect(resolveInitialContext(undefined, contexts, 'staging')).toBe('staging')
  })

  test('falls back to the first context when there is no current-context', () => {
    expect(resolveInitialContext(undefined, contexts, '')).toBe('prod')
  })

  test('returns empty string when there are no contexts', () => {
    expect(resolveInitialContext('dev', [], '')).toBe('')
  })
})

describe('resolveActiveNamespace', () => {
  const namespaces = [ns('default'), ns('kube-system'), ns('apps')]

  test('prefers the stored namespace when it still exists', () => {
    expect(resolveActiveNamespace('apps', 'default', namespaces)).toBe('apps')
  })

  test('ignores a stored namespace that was deleted, keeping the current one', () => {
    expect(resolveActiveNamespace('gone', 'kube-system', namespaces)).toBe('kube-system')
  })

  test('ignores both stored + current when absent, falling back to default', () => {
    expect(resolveActiveNamespace('gone', 'also-gone', namespaces)).toBe('default')
  })

  test('falls back to the first namespace when default is absent', () => {
    expect(resolveActiveNamespace(undefined, '', [ns('apps'), ns('kube-system')])).toBe('apps')
  })

  test('returns empty string when there are no namespaces', () => {
    expect(resolveActiveNamespace('apps', 'default', [])).toBe('')
  })

  test('stored namespace wins over a still-present current one', () => {
    expect(resolveActiveNamespace('apps', 'default', namespaces)).toBe('apps')
  })

  test('keeps the virtual all-namespaces scope', () => {
    expect(resolveActiveNamespace(ALL_NAMESPACES, 'default', namespaces)).toBe(ALL_NAMESPACES)
  })
})

describe('collectionErrors', () => {
  test('keeps failures attached to their resource kind', () => {
    const results: PromiseSettledResult<unknown>[] = [
      { status: 'fulfilled', value: [] },
      {
        status: 'rejected',
        reason: new KubeApiError('Access denied', 'permission_denied', 'deployments is forbidden'),
      },
      { status: 'fulfilled', value: [] },
      { status: 'rejected', reason: new Error('node request failed') },
      { status: 'fulfilled', value: [] },
    ]
    expect(collectionErrors(results)).toEqual({
      deployments: {
        code: 'permission_denied',
        message: 'Access denied',
        detail: 'deployments is forbidden',
      },
      nodes: { message: 'node request failed' },
    })
  })
})

describe('Kubernetes async scope guard', () => {
  test('accepts only the captured generation, context, and namespace', () => {
    const current = { context: 'prod', namespace: 'apps' }
    expect(
      kubernetesScopeIsCurrent(current, 4, {
        generation: 4,
        context: 'prod',
        namespace: 'apps',
      }),
    ).toBe(true)
    expect(
      kubernetesScopeIsCurrent(current, 5, {
        generation: 4,
        context: 'prod',
        namespace: 'apps',
      }),
    ).toBe(false)
    expect(
      kubernetesScopeIsCurrent(current, 4, {
        generation: 4,
        context: 'staging',
        namespace: 'apps',
      }),
    ).toBe(false)
    expect(
      kubernetesScopeIsCurrent(current, 4, {
        generation: 4,
        context: 'prod',
        namespace: 'default',
      }),
    ).toBe(false)
  })
})
