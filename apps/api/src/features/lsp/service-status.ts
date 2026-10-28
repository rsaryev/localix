import type { LspServiceDeps, OpenDoc } from './service-contract'

type ServerStates = Parameters<NonNullable<LspServiceDeps['publishStatus']>>[2]

/**
 * The server states each session was last sent, so a status bar sees installing → ready while
 * only the editor is open (an agent run sends its own, `stages/context.ts`). A session hears the
 * states once per change, however many of its files are open under the root.
 */
export function createStatusPublisher(publish: LspServiceDeps['publishStatus']) {
  const last = new Map<string, string>()
  return (docs: readonly OpenDoc[], states: ServerStates) => {
    if (!publish) return
    const payload = JSON.stringify(states)
    for (const doc of docs) {
      const session = `${doc.userId}\n${doc.sessionId}`
      if (last.get(session) === payload) continue
      last.set(session, payload)
      publish(doc.userId, doc.sessionId, states)
    }
  }
}
