import type { ExecutionEnvironment, ExecutionEnvironmentConfig } from '../environment'
import { localEnvironment } from './local'
import { SSHEnvironment, DockerEnvironment } from './remote'

export function createEnvironment(config: ExecutionEnvironmentConfig): ExecutionEnvironment {
  switch (config.kind) {
    case 'local':
      return localEnvironment
    case 'ssh':
      return new SSHEnvironment(config)
    case 'docker':
      return new DockerEnvironment(config)
  }
  return localEnvironment
}

/** Where a session's runs and file operations execute: locally, or on its ssh/docker backend. */
export function executionConfigFor(session: {
  executionBackend: string
  executionTarget: string | null
}): ExecutionEnvironmentConfig {
  return session.executionBackend === 'ssh'
    ? { kind: 'ssh', sshHost: session.executionTarget ?? '', sshPort: 22 }
    : session.executionBackend === 'docker'
      ? { kind: 'docker', containerName: session.executionTarget ?? '' }
      : { kind: 'local' }
}
