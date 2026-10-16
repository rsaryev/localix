import { describe, expect, test } from 'bun:test'

import { mapKubeError } from './errors'

describe('mapKubeError — typed signals before message wording', () => {
  test('a Status reason classifies even when its message reads like something else', () => {
    const err = {
      body: {
        kind: 'Status',
        reason: 'Forbidden',
        message: 'unable to connect: the admission webhook refused the request',
      },
    }
    expect(mapKubeError(err).code).toBe('permission_denied')
  })

  test('a NotFound Status whose message mentions a forbidden word stays not_found', () => {
    const err = { body: { kind: 'Status', reason: 'NotFound', message: 'forbidden-ns not found' } }
    expect(mapKubeError(err).code).toBe('not_found')
  })

  test('a system error code on the cause names an unreachable cluster', () => {
    const err = new Error('request to cluster failed', {
      cause: Object.assign(new Error('opaque'), { code: 'ECONNREFUSED' }),
    })
    expect(mapKubeError(err).code).toBe('context_unreachable')
  })

  test('a TLS error code is a certificate error', () => {
    const err = Object.assign(new Error('opaque'), { code: 'CERT_HAS_EXPIRED' })
    expect(mapKubeError(err).code).toBe('certificate_error')
  })

  test('kubectl text without structure still falls back to the wording rules', () => {
    expect(mapKubeError(new Error('Unable to connect to the server: dial tcp')).code).toBe(
      'context_unreachable',
    )
    expect(mapKubeError(new Error('some odd failure')).code).toBe('kube_error')
  })
})
