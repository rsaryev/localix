export { LocalEnvironment, localEnvironment } from './local'
export { SSHEnvironment, DockerEnvironment } from './remote'

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
