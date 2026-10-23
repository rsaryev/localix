import { describe, expect, test } from 'bun:test'
import { createEnvironment } from './index'
import { SSHEnvironment, DockerEnvironment } from './remote'
import { LocalEnvironment, localEnvironment } from './local'
import type { ExecutionEnvironmentConfig } from '../environment'

/**
 * The three real kinds need no escape at all — they are ordinary
 * ExecutionEnvironmentConfig values, and a blanket `Record<string, unknown>` cast
 * helper was hiding that (it would have swallowed a genuinely malformed config too).
 *
 * The `default:` branch is the one input that CANNOT be typed: BackendKind is a closed
 * union, so no valid value reaches it — but `kind` is PERSISTED, so a stale row or a
 * hand-edited settings file can carry a kind this build no longer knows, and the
 * fallback-to-local is exactly the defence against that. Forge only that one value,
 * and name why.
 */
const persistedConfigWithUnknownKind = { kind: 'mystery' } as unknown as ExecutionEnvironmentConfig

describe('createEnvironment', () => {
  test('local kind returns the shared local singleton', () => {
    const env = createEnvironment({ kind: 'local' })
    expect(env).toBe(localEnvironment)
    expect(env).toBeInstanceOf(LocalEnvironment)
  })

  test('ssh kind constructs an SSHEnvironment carrying its config', () => {
    const env = createEnvironment({ kind: 'ssh', sshHost: 'host', sshPort: 22 })
    expect(env).toBeInstanceOf(SSHEnvironment)
    expect(env.config.kind).toBe('ssh')
  })

  test('docker kind constructs a DockerEnvironment', () => {
    const env = createEnvironment({ kind: 'docker', containerName: 'box' })
    expect(env).toBeInstanceOf(DockerEnvironment)
  })

  test('an unknown kind falls back to local', () => {
    expect(createEnvironment(persistedConfigWithUnknownKind)).toBe(localEnvironment)
  })
})
