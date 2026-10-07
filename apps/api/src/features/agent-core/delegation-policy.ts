/** Only the original chat can create delegated work, regardless of its agent's tool list. */
export function isDelegationParent(session: {
  id: string
  sessionKind: string
  parentSessionId?: string | null
  rootSessionId?: string | null
  provenance: { kind: string }
}): boolean {
  return (
    session.sessionKind === 'chat' &&
    !session.parentSessionId &&
    (session.rootSessionId ?? session.id) === session.id &&
    session.provenance.kind === 'root'
  )
}
