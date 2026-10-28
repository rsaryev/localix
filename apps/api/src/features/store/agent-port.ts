import type { StoreService } from './service'

/**
 * What chat reaches the Store through: the agent's `Store` tool and the `/plugin` commands. Both
 * are people (or an agent acting for one) using the same service the Store screen uses, so the
 * port is that service's own methods, not a second vocabulary. `bootstrap/` hands it to chat
 * (A4); the Store is built after chat, so chat reads it through a forward holder.
 */
export type StoreAgentPort = Pick<
  StoreService,
  | 'listings'
  | 'detail'
  | 'plan'
  | 'install'
  | 'update'
  | 'remove'
  | 'setEnabled'
  | 'createFields'
  | 'create'
  | 'setConfig'
  | 'sources'
  | 'addSource'
>
