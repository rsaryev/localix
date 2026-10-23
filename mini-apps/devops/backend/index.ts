/**
 * DevOps Workspace — the single bundled DevOps mini app entrypoint.
 *
 * Docker and Kubernetes remain separate provider modules because they have
 * different transports and lifecycle needs. They are deliberately composed here
 * into one mini app registration, one package boundary, and one enable/disable
 * decision. Keeping the provider subsystem ids and RPC paths stable avoids
 * breaking existing resource references, search hits, and saved integrations.
 */
import { register as registerDocker } from '../docker/backend'
import { register as registerKubernetes } from '../kubernetes/backend'
import type {
  AgentTool,
  BackendSubsystem,
  MiniAppRegistration,
} from '@localixai/mini-app-sdk/backend'

function backendsOf(registration: MiniAppRegistration): BackendSubsystem[] {
  if (!registration.backend) return []
  return Array.isArray(registration.backend) ? registration.backend : [registration.backend]
}

function toolsOf(registration: MiniAppRegistration): AgentTool[] {
  return registration.tools ? [...registration.tools] : []
}

export async function register(): Promise<MiniAppRegistration> {
  const [docker, kubernetes] = await Promise.all([registerDocker(), registerKubernetes()])

  return {
    backend: [...backendsOf(docker), ...backendsOf(kubernetes)],
    tools: [...toolsOf(docker), ...toolsOf(kubernetes)],
  }
}
