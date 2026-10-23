/**
 * What this mini app's UI can announce, and what its readers watch.
 *
 * One value both sides import, so a writer and a reader can never disagree about the name. The
 * protocol, the key semantics and the reasoning are in `mini-app-sdk/ui/resource-topics`.
 */
import { resourceTopic } from '@localixai/mini-app-sdk/ui/resource-topics'

/**
 * The saved environments and which one is active.
 *
 * App-global, so it is invalidated without a key: a machine has one set of them whichever chat is
 * on screen. Two writers reach it — the sidebar picker and the agent's `api_client` tool — and
 * before this they were two different signals, which is why switching by hand updated the picker
 * and left the titlebar naming the environment you had just left.
 */
export const API_ENVIRONMENTS = resourceTopic('api:environments')
