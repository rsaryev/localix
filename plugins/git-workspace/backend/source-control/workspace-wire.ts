/**
 * Both halves of the `/workspace` wire rule, in one pure leaf the route and the
 * panel's client import alike (see {@link SourceControlWorkspaceWire}): the focused
 * repo's status rode the wire twice — once as its `repos` row, once as `status` —
 * so at 5,000 changed files a megabyte of JSON per poll was serialized, sent and
 * parsed for nothing. Two copies of this rule, one per side, would drift the way
 * the status copies did.
 */
import type { SourceControlWorkspace, SourceControlWorkspaceWire } from './contracts'

/** Leave `status` out when it IS the active repo's row. */
export function toWorkspaceWire(workspace: SourceControlWorkspace): SourceControlWorkspaceWire {
  const { status, ...rest } = workspace
  // The service reuses discovery's own status object for the focused repo; identity is the
  // proof that the row carries exactly this status, not merely an equal-looking one.
  const shared = rest.repos.some((repo) => repo.status === status && repo.root === rest.activeRepo)
  return shared ? rest : { ...rest, status }
}

/** Put the status back from the active repo's row — the same object, as the store expects. */
export function fromWorkspaceWire(wire: SourceControlWorkspaceWire): SourceControlWorkspace {
  if (wire.status) return wire as SourceControlWorkspace
  const row = wire.repos.find((repo) => repo.root === wire.activeRepo)
  if (!row) throw new Error('Workspace response names an active repo it does not carry')
  return { ...wire, status: row.status }
}
