import { describe, expect, test } from 'bun:test'
import {
  buildK8sManifestUri,
  buildK8sNodeUri,
  buildK8sPodUri,
  buildK8sPodViewUri,
  buildK8sWorkloadUri,
} from './resourceLink'

describe('buildK8sManifestUri', () => {
  test('pod → ns-scoped manifest leaf', () => {
    expect(
      buildK8sManifestUri({ kind: 'pod', name: 'web-1', namespace: 'apps', context: 'prod' }),
    ).toBe('localix://resource/k8s/prod/apps/web-1/manifest')
  })
  test('deployment/service → kind-tagged leaf', () => {
    expect(
      buildK8sManifestUri({ kind: 'deployment', name: 'web', namespace: 'apps', context: 'prod' }),
    ).toBe('localix://resource/k8s/prod/apps/deployment/web/manifest')
    expect(
      buildK8sManifestUri({ kind: 'service', name: 'web-svc', namespace: 'apps', context: 'prod' }),
    ).toBe('localix://resource/k8s/prod/apps/service/web-svc/manifest')
  })
  test('node → cluster-scoped leaf (no namespace)', () => {
    expect(
      buildK8sManifestUri({ kind: 'node', name: 'node-1', namespace: '', context: 'prod' }),
    ).toBe('localix://resource/k8s/prod/node/node-1/manifest')
  })
  test('blank context falls back to a "current" marker', () => {
    expect(buildK8sManifestUri({ kind: 'pod', name: 'web-1', namespace: 'apps' })).toBe(
      'localix://resource/k8s/current/apps/web-1/manifest',
    )
  })

  test('dynamic segments are canonical and cannot collide with grammar markers', () => {
    expect(buildK8sPodUri({ context: 'prod/us', namespace: 'node', name: 'deployment' })).toBe(
      'localix://resource/k8s/prod%2Fus/%6Eode/%64eployment',
    )
    expect(
      buildK8sWorkloadUri({
        context: 'prod/us',
        namespace: 'apps team',
        kind: 'deployment',
        name: 'web/api',
      }),
    ).toBe('localix://resource/k8s/prod%2Fus/apps%20team/deployment/web%2Fapi')
    expect(buildK8sNodeUri({ context: 'prod/us', name: 'node/a' })).toBe(
      'localix://resource/k8s/prod%2Fus/node/node%2Fa',
    )
  })

  test('logs preserve the selected container and previous-container mode', () => {
    expect(
      buildK8sPodViewUri({
        context: 'prod',
        namespace: 'apps',
        name: 'web-1',
        view: 'logs',
        container: 'web/sidecar',
        previous: true,
      }),
    ).toBe('localix://resource/k8s/prod/apps/web-1/logs/container/web%2Fsidecar/previous')
  })
})
