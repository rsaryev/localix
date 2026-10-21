import { evaluate, type Effect, type Rule, type Verdict } from '../agent-core/capability-rule'

export interface InvocationHost {
  id: string
  label: string
}

/** Hosts register execution surfaces; a definition cannot invent a host by naming one. */
export class InvocationRegistry {
  private readonly hosts = new Map<string, InvocationHost>()

  register(host: InvocationHost): () => void {
    if (!/^[a-z][a-z0-9.-]*$/.test(host.id) || this.hosts.has(host.id)) {
      throw new Error(`Invalid or duplicate invocation host: ${host.id}`)
    }
    const registered = Object.freeze({ ...host })
    this.hosts.set(host.id, registered)
    return () => {
      if (this.hosts.get(host.id) === registered) this.hosts.delete(host.id)
    }
  }

  list(): readonly InvocationHost[] {
    return [...this.hosts.values()]
  }

  verdict(rules: readonly Rule[], host: string, agentId: string): Verdict {
    if (!this.hosts.has(host)) return { effect: 'deny' }
    return evaluate(rules, `invocation:${host}`, agentId, 'deny')
  }

  availability(rules: readonly Rule[], agentId: string): Record<string, Effect> {
    return Object.fromEntries(
      this.list().map(({ id }) => [id, this.verdict(rules, id, agentId).effect]),
    )
  }
}

export function createInvocationRegistry(): InvocationRegistry {
  const registry = new InvocationRegistry()
  for (const host of [
    { id: 'chat', label: 'Chat session' },
    { id: 'delegation', label: 'Delegated session' },
    { id: 'automation', label: 'Scheduled automation' },
    { id: 'channel', label: 'Channel session' },
    { id: 'verification', label: 'Lifecycle verification' },
  ])
    registry.register(host)
  return registry
}
