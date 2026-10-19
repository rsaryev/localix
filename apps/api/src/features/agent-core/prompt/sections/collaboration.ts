import { TOOL } from '../../tool-names'

/**
 * `# Collaboration` — the one rule for WHO does a piece of work: you, a child session you delegate
 * a bounded task to (yourself or a directory agent), or a colleague in the conversation. A role
 * that owns a part of the goal joins the conversation, where the user can see and redirect it; a
 * child session is for a self-contained task whose report is all the conversation needs.
 *
 * It was scattered across nine places that each answered part of it in their own words: the
 * orchestrator role guidance, an execution-discipline line, the turn-control contract, the
 * participants section (twice), the leadership contract, the agent-directory footer, and the
 * tool descriptions. A model reading one rule in one place and another in the next had to
 * reconcile them itself, and the copies had started to disagree.
 *
 * Every bullet is gated on what the run can do: delegating needs `delegate`, bringing a colleague
 * in needs a conversation a tag can grow, creating one needs `agents`. With none of them there is
 * nothing to decide, and no section. How a plugin's own tool records work (a task board, say) is
 * that tool's schema to say, not this rule.
 */
export function buildCollaborationSection(
  toolNames: readonly string[],
  // The answer to WHO changes with the room, so the rule has to know it. Alone, doing it
  // yourself is the default and delegation buys parallelism. With colleagues present that default
  // is the failure: a non-leader once read "do the work yourself … delegate
  // substantial work" with @frontend and @qa in the room and sent both tasks to one-shot
  // children the person could not see or redirect — which is why a colleague's part goes to them.
  room: {
    withColleagues: boolean
    /** A conversation exists for this run. */
    inConversation?: boolean
    membershipClosed?: boolean
    isLeader?: boolean
  } = { withColleagues: false },
): string | null {
  const has = (name: string) => toolNames.includes(name)
  const delegate = has(TOOL.delegate)
  const inConversation = room.inConversation ?? room.withColleagues
  const canInvite = inConversation && !room.membershipClosed
  if (!delegate && !canInvite && !room.withColleagues) return null
  const { withColleagues } = room
  const isLeader = room.isLeader ?? !withColleagues
  return [
    '# Collaboration',
    withColleagues
      ? 'Colleagues share this conversation: each part belongs to the participant whose role owns it. Do your own part; hand a colleague their ready part by @mentioning them, so they work here, where the user can redirect them.'
      : 'Handle straightforward work directly.',
    ...(delegate
      ? [
          '- Keep this context for deciding and doing. Broad investigation goes to `delegate`: sweeps across many files, repos or sources, comparisons, and checking work you did not do. Do a focused lookup yourself — a few calls, a status, a failure to diagnose, or details (ids, commands, paths) you act on next: a child starts cold and waiting on it adds latency. Give a child a precise, self-contained task, and check its conclusion against its evidence before relaying it. Long independent work goes to a child too; keep the critical path here.',
          '- The child runs as you unless `agent` names a directory agent whose role fits the task better. It sees only the task; add context:"conversation" only when the task truly depends on this chat. Leave wait off and keep working; set wait:true only when your very next step needs the report.',
        ]
      : []),
    ...(canInvite
      ? [
          '- Bring in a suitable agent from the directory when another role is needed: @mention it with a concrete assignment (scope, constraints, acceptance evidence). It joins and starts when your reply ends, not before.',
        ]
      : withColleagues
        ? ['- Nobody can be brought in or removed here, so work only with the participants here.']
        : []),
    ...(canInvite && has(TOOL.agents)
      ? [
          '- Reuse directory agents before creating one. Create missing reusable specialists with `agents`, a supporting role below the current leader’s priority; only the user changes their permissions. Report creation errors, keep successful definitions, then @mention the created handles with their assignments: creation alone starts no work.',
          ...(isLeader
            ? [
                `- You are the elected leader, even while alone: assess whether the goal needs distinct specialties. When it does, or when the user asks for a team, build the smallest useful team before any implementation and hand each part to its owner instead of doing it yourself; do not wait for the user to name roles. Create all missing specialists in one batch and @mention each ready owner with a concrete scope, dependencies and acceptance evidence. Keep straightforward work direct. Own coordination, integration and the requested outcome; grow the team only for uncovered work, and respect user constraints and fixed membership.`,
              ]
            : [
                // Any participant may bring an agent in (`conversation-invite.ts`); a member does it
                // for its own part. Telling it to leave staffing to the leader contradicted the
                // invite rule just above, and the host honours a member's tag either way.
                '- The elected leader coordinates the team; bring an agent in only for a role your own part needs. Keep to your assigned part, report its result with evidence to the leader, and do not start another team or duplicate an active owner’s work.',
              ]),
        ]
      : []),
    // Alone with no way to bring anyone in, the only other owner is a child the run delegated to.
    withColleagues || canInvite
      ? `- Work ${delegate ? 'already owned by a colleague or a running child' : 'a colleague has already taken on'} is theirs: ask for its status instead of starting it again.`
      : '- Work a running child already owns is theirs: ask for its status instead of starting it again.',
  ].join('\n')
}
