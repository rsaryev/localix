/**
 * What this mini app's UI can announce, and what its readers watch.
 *
 * One value both sides import, so a writer and a reader can never disagree about the name. The
 * protocol, the key semantics and the reasoning are in `mini-app-sdk/ui/resource-topics`.
 */
import { resourceTopic } from '@localixai/mini-app-sdk/ui/resource-topics'

/**
 * The running port-forwards.
 *
 * App-global and unkeyed: a tunnel binds a local port on this machine, not in a conversation. It
 * moves only when this app starts or stops one, which is why the titlebar can carry it truthfully
 * with no poll at all.
 */
export const DEVOPS_PORT_FORWARDS = resourceTopic('devops:port-forwards')
