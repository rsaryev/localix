/**
 * CONNECTIONS SIGNED IN THROUGH AN ACCOUNT LOCALIX NO LONGER SUPPORTS.
 *
 * The vendored runtime signed in to Anthropic, Kimi Coding, Meta, xAI and Radius with an account;
 * the engine that replaced it signs in to OpenAI, Codex, OpenRouter and GitHub Copilot. A
 * connection made through one of the others still exists and still looks connected, and every run
 * on it fails with "reconnect it with an API key" — after the person has already waited for it.
 * So the set of such connections is reported where problems are listed (the Event Center), at boot
 * and whenever the connections change, and a connection replaced or removed settles its row.
 */
import type { ProviderConnection } from './contracts'

export interface RemovedSignInsDeps {
  listConnections(userId: string): Promise<{ connections: ProviderConnection[] }>
  /** The providers the engine can sign in to with an account (`catalog.oauthProviderIds`). */
  oauthProviderIds(): Promise<readonly string[]>
  report(userId: string, broken: { connectionId: string; label: string }[]): Promise<void>
}

/** The OAuth connections no sign-in serves any more, each with the name it is listed under. */
export function removedSignIns(
  connections: readonly ProviderConnection[],
  oauthProviderIds: readonly string[],
): { connectionId: string; label: string }[] {
  const supported = new Set(oauthProviderIds)
  return connections
    .filter(
      (connection) => connection.authType === 'oauth-pkce' && !supported.has(connection.providerId),
    )
    .map((connection) => ({
      connectionId: connection.id,
      label: connection.label || connection.providerName,
    }))
}

/** Read the connections and report the broken set; a failure to read reports nothing. */
export async function reportRemovedSignIns(
  deps: RemovedSignInsDeps,
  userId: string,
): Promise<void> {
  const [{ connections }, oauth] = await Promise.all([
    deps.listConnections(userId),
    deps.oauthProviderIds(),
  ])
  // An empty list means the catalog has not loaded yet, not that every sign-in is gone.
  if (oauth.length === 0) return
  await deps.report(userId, removedSignIns(connections, oauth))
}

/**
 * The report as the host runs it, over the services it reads: on demand (boot, every connection
 * change), never awaited, and a failure logged rather than thrown — a check worth less than the
 * change that triggered it.
 */
export function removedSignInsReporter(
  services: {
    connections: Pick<RemovedSignInsDeps, 'listConnections'>
    catalog: { getFullCatalog(): Promise<{ oauthProviderIds: readonly string[] }> }
    conditions: { signInsRemoved: RemovedSignInsDeps['report'] }
  },
  userId: string,
  warn: (message: string) => void,
): () => void {
  const deps: RemovedSignInsDeps = {
    listConnections: (...args) => services.connections.listConnections(...args),
    oauthProviderIds: async () => (await services.catalog.getFullCatalog()).oauthProviderIds,
    report: (...args) => services.conditions.signInsRemoved(...args),
  }
  return () =>
    void reportRemovedSignIns(deps, userId).catch((error: unknown) => warn(String(error)))
}
