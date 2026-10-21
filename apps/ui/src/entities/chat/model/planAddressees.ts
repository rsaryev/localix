/**
 * WHOM AN APPROVAL CAN HAND THE PLAN TO — "Any agent", then the root conversation's roster, then
 * Everyone.
 *
 * The defect it replaces: the addressee was a free-text note whose `@mentions` decided who
 * answered, so a typo or a handle from another chat silently reached the default answerer. A
 * choice from the roster cannot name someone absent.
 *
 * "Any agent" leads and is the default: it names nobody, so the conversation's own strategy picks
 * who answers exactly as for a message with no `@mention` — the approval behaves like everything
 * else said to the conversation unless the person decides otherwise. The plan's author comes next,
 * tagged, because the version is theirs; then the others; then Everyone (`@all`). A conversation
 * with ONE agent gets no rows at all: there is nobody to choose between, and offering that agent,
 * "any" and "everyone" would be three names for the same answer.
 */
import { useMemo } from 'react'
import { ALL_MENTION_HANDLE } from '@localixai/agent/agents'

import { findSessionInState } from './findSession'
import { useChatStore } from './store'

export interface PlanAddressee {
  kind: 'any' | 'agent' | 'everyone'
  /** What the approval sends as `to`: a participant's handle, `all`, or nothing (`null`, any). */
  to: string | null
  /** The participant that presented the version. */
  author: boolean
}

/** The plan's author, by agent id (a version's `authorAgentId`) or by handle (an attention item). */
export interface PlanAuthorRef {
  agentId?: string | null
  handle?: string | null
}

type Member = { agentId: string; handle: string }

export function planAddressees(members: readonly Member[], author: PlanAuthorRef): PlanAddressee[] {
  if (members.length < 2) return []
  const isAuthor = (member: Member) =>
    (author.agentId != null && member.agentId === author.agentId) ||
    (author.handle != null && member.handle === author.handle)
  const lead = members.find(isAuthor)
  const ordered = lead ? [lead, ...members.filter((member) => member !== lead)] : [...members]
  return [
    { kind: 'any', to: null, author: false },
    ...ordered.map((member) => ({
      kind: 'agent' as const,
      to: member.handle,
      author: member === lead,
    })),
    { kind: 'everyone', to: ALL_MENTION_HANDLE, author: false },
  ]
}

/** The roster of the ROOT session `ownerId`, as approval addressees; empty below two agents. */
export function usePlanAddressees(ownerId: string | null, author: PlanAuthorRef): PlanAddressee[] {
  // A string key, so an unrelated store change does not hand back a new array every render.
  const rosterKey = useChatStore((state) =>
    (findSessionInState(state, ownerId)?.agents ?? [])
      .map((member) => `${member.agentId}\u0001${member.handle}`)
      .join('\u0000'),
  )
  const { agentId, handle } = author
  return useMemo(() => {
    const members = rosterKey
      ? rosterKey.split('\u0000').map((entry) => {
          const [id = '', name = ''] = entry.split('\u0001')
          return { agentId: id, handle: name }
        })
      : []
    return planAddressees(members, { agentId, handle })
  }, [rosterKey, agentId, handle])
}
