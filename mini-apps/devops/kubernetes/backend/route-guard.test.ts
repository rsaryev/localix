import { describe, expect, test } from 'bun:test'
import { KubeError } from './errors'
import { statusFor } from './route-guard'

describe('statusFor', () => {
  test('keeps setup/connectivity, RBAC, and missing resources distinct', () => {
    expect(statusFor(new KubeError('no_kubeconfig'))).toBe(503)
    expect(statusFor(new KubeError('command_timeout'))).toBe(503)
    expect(statusFor(new KubeError('permission_denied'))).toBe(403)
    expect(statusFor(new KubeError('not_found'))).toBe(404)
    expect(statusFor(new KubeError('invalid_context'))).toBe(400)
  })
})
