import type { LspClientInfo } from './lsp-client'

/** Consecutive unanswered diagnostics waits before a project stops waiting on its server. */
export const SILENT_STRIKES = 2
/** How long the project skips the wait before giving the server another hearing. */
export const SILENT_COOLDOWN_MS = 2 * 60_000

type PushDiagnosticsDocument = <T>(
  filePath: string,
  projectRoot: string,
  push: (client: Pick<LspClientInfo, 'touchFileAndWait'>) => Promise<T>,
) => Promise<T | undefined>

/**
 * After repeated unanswered waits, keep pushing files but temporarily skip waiting for diagnostics.
 * The cooldown gives the server another chance; an answered wait clears the project mark.
 * Each call captures that mark before starting its push, including concurrent writes.
 */
export function createDiagnosticsWait(
  pushDocument: PushDiagnosticsDocument,
  silentCooldownMs: number,
) {
  const silentProjects = new Map<string, { strikes: number; until: number }>()
  return function touchAndWait(
    filePath: string,
    projectRoot: string,
  ): Promise<boolean | undefined> {
    const silent = silentProjects.get(projectRoot)
    const skipWait =
      silent !== undefined && silent.strikes >= SILENT_STRIKES && Date.now() < silent.until
    return pushDocument(filePath, projectRoot, async (c) => {
      const answered = await c.touchFileAndWait(filePath, !skipWait)
      if (skipWait) return undefined
      if (answered) silentProjects.delete(projectRoot)
      else {
        const strikes = (silent?.strikes ?? 0) + 1
        silentProjects.set(projectRoot, { strikes, until: Date.now() + silentCooldownMs })
      }
      return answered
    })
  }
}
