import { TOOL } from './tool-names'

/**
 * `# Collaboration` — the one rule for WHO does a piece of work: you, a delegated child, or a
 * colleague invited into the conversation.
 *
 * It was scattered across nine places that each answered part of it in their own words: the
 * orchestrator role guidance, an execution-discipline line, the turn-control contract, the
 * participants section (twice), the leadership contract, the agent-directory footer, and the
 * tool descriptions. A model reading one rule in one place and another in the next had to
 * reconcile them itself, and the copies had started to disagree.
 *
 * Every bullet is gated on the tool it names, so a run is never told how to delegate with a
 * tool it does not hold. With neither tool there is nothing to decide, and no section. How a
 * plugin's own tool records work (a task board, say) is that tool's schema to say, not this rule.
 */
export function buildCollaborationSection(
  toolNames: readonly string[],
  // The answer to WHO changes with the room, so the rule has to know it. Alone, doing it
  // yourself is the default and a child buys isolation. With colleagues present that default
  // is the failure: a non-leader once read "do the work yourself … delegate
  // substantial work" with @frontend and @qa in the room and sent both tasks to one-shot
  // children the person could not see or redirect.
  // A room whose participants the person fixed still schedules its colleagues through
  // `conversation_control`; it just cannot grow, and a bullet teaching an invitation the
  // membership writer will refuse is advice the run can only fail at.
  room: { withColleagues: boolean; rosterLocked?: boolean } = { withColleagues: false },
): string | null {
  const has = (name: string) => toolNames.includes(name)
  const delegate = has(TOOL.agents)
  const invite = has(TOOL.conversation_control)
  if (!delegate && !invite) return null
  const { withColleagues } = room
  const canInvite = invite && !room.rosterLocked
  return [
    '# Collaboration',
    withColleagues
      ? `Colleagues share this conversation: each part belongs to the participant whose role owns it. Do your own part${invite ? '; hand a colleague their ready part with `conversation_control`, so they work here, where the user can redirect them' : ''}.`
      : 'Handle straightforward work directly; coordinate substantial work with suitable agents.',
    ...(delegate
      ? [
          withColleagues
            ? '- Delegate (`agents` action:"delegate") only when no participant here owns that role, or for parallel isolated work. Assignees join this conversation automatically; do not also schedule them here for the same task.'
            : '- Delegate (`agents` action:"delegate") when substantial work should keep its investigation out of this conversation: the child runs once, with only your brief, and reports back. Assignees join this conversation automatically; do not also schedule them here for the same task. Review the report before you call the work done.',
        ]
      : []),
    ...(delegate
      ? [
          '- A brief must separate the user’s requirements from your proposed choices, name the acceptance evidence, and carry the relevant instructions and references. A newer correction supersedes conflicting earlier choices: message the existing owner with what changed and what still applies.',
        ]
      : []),
    ...(canInvite
      ? [
          '- Invite a suitable colleague (`conversation_control`) when another role is needed. Publish a concrete assignment with scope, constraints and acceptance evidence, then put them in both invite and next; inviting alone does not start work. Remove them once their part is done.',
        ]
      : invite
        ? [
            '- The user fixed who is in this conversation: nobody can be invited or removed, so work only with the participants here.',
          ]
        : []),
    `- Work ${delegate ? 'already owned by a colleague or a delegated run' : 'a colleague has already taken on'} is theirs: ask for its status instead of starting it again.`,
  ].join('\n')
}
