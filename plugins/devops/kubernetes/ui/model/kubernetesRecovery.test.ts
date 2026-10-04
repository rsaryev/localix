import { describe, expect, test } from 'bun:test'
import {
  canAutoRetryKubernetes,
  isRetryableKubeIssue,
  KUBERNETES_AUTO_RETRY_LIMIT,
  kubernetesRecoveryDelay,
  kubernetesRecoveryKey,
  kubernetesRecoveryTarget,
} from './kubernetesRecovery'

describe('Kubernetes automatic recovery', () => {
  test('uses a bounded backoff for a remote cluster', () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(kubernetesRecoveryDelay)).toEqual([
      1_500, 3_000, 5_000, 8_000, 15_000, 30_000, 30_000,
    ])
    expect(canAutoRetryKubernetes(KUBERNETES_AUTO_RETRY_LIMIT - 1)).toBe(true)
    expect(canAutoRetryKubernetes(KUBERNETES_AUTO_RETRY_LIMIT)).toBe(false)
  })

  test('retries transient and unknown server failures, not setup/auth/RBAC failures', () => {
    expect(isRetryableKubeIssue({ code: 'context_unreachable', message: 'offline' })).toBe(true)
    expect(isRetryableKubeIssue({ code: 'command_timeout', message: 'slow' })).toBe(true)
    expect(isRetryableKubeIssue({ code: 'kube_error', message: 'temporary server error' })).toBe(
      true,
    )
    expect(isRetryableKubeIssue({ code: 'authentication_failed', message: 'login' })).toBe(false)
    expect(isRetryableKubeIssue({ code: 'permission_denied', message: 'forbidden' })).toBe(false)
    expect(isRetryableKubeIssue({ code: 'no_kubeconfig', message: 'configure' })).toBe(false)
  })

  test('rebuilds a broken root scope and re-lists partial collections in place', () => {
    expect(
      kubernetesRecoveryTarget({
        error: { code: 'context_unreachable', message: 'offline' },
        resourceErrors: {},
        unavailable: false,
        unreachable: true,
        activeNamespace: 'apps',
      }),
    ).toBe('bootstrap')
    expect(
      kubernetesRecoveryTarget({
        error: null,
        resourceErrors: { nodes: { code: 'context_unreachable', message: 'offline' } },
        unavailable: false,
        unreachable: false,
        activeNamespace: 'apps',
      }),
    ).toBe('resources')
  })

  test('does not hammer terminal partial failures', () => {
    expect(
      kubernetesRecoveryTarget({
        error: null,
        resourceErrors: { nodes: { code: 'permission_denied', message: 'forbidden' } },
        unavailable: false,
        unreachable: false,
        activeNamespace: 'apps',
      }),
    ).toBeNull()
  })

  test('recovery key changes with the collection, but not volatile transport detail', () => {
    const one = kubernetesRecoveryKey({
      error: null,
      resourceErrors: { nodes: { code: 'context_unreachable', message: 'offline', detail: 'a' } },
    })
    const two = kubernetesRecoveryKey({
      error: null,
      resourceErrors: { pods: { code: 'context_unreachable', message: 'offline', detail: 'b' } },
    })
    expect(one).not.toBe(two)
    expect(
      kubernetesRecoveryKey({
        error: null,
        resourceErrors: {
          nodes: { code: 'context_unreachable', message: 'offline', detail: 'request-2' },
        },
      }),
    ).toBe(one)
  })
})
