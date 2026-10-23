/**
 * What this mini app's UI can announce, and what its readers watch.
 *
 * One value both sides import, so a writer and a reader can never disagree about the name. The
 * protocol, the key semantics and the reasoning are in `mini-app-sdk/ui/resource-topics`.
 */
import { resourceTopic } from '@localixai/mini-app-sdk/ui/resource-topics'

/**
 * The saved connections, and which of them are live.
 *
 * App-global: a machine's databases do not belong to a conversation. Worth announcing rather than
 * polling because the fact the titlebar carries — a connection that is live AND writable, so a
 * generated `UPDATE` reaches real rows — is only true between two events this mini app itself
 * causes.
 */
export const DATABASE_CONNECTIONS = resourceTopic('database:connections')

/**
 * The ROWS of one connection's objects, keyed by connection id: a write moved data that an open
 * table page may be showing. Announced for the agent's writes (`databaseChanges.ts`) and for the
 * console's own; an open table page re-reads its current page, a hidden one when it is shown.
 */
export const DATABASE_DATA = resourceTopic('database:data')
