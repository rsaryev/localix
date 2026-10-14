import { TOOL } from './tool-names'

/**
 * `# Collaboration` — the one rule for WHO does a piece of work: you, a fork of yourself, or a
 * colleague in the conversation. Agents do not hand work to other agents in child sessions:
 * another role joins the conversation, where the user can see and redirect it.
 *
 * It was scattered across nine places that each answered part of it in their own words: the
 * orchestrator role guidance, an execution-discipline line, the turn-control contract, the
 * participants section (twice), the leadership contract, the agent-directory footer, and the
 * tool descriptions. A model reading one rule in one place and another in the next had to
 * reconcile them itself, and the copies had started to disagree.
 *
 * Every bullet is gated on what the run can do: forking needs `fork`, bringing a colleague in
 * needs a conversation a tag can grow, creating one needs `agents`. With none of them there is
 * nothing to decide, and no section. How a plugin's own tool records work (a task board, say) is
 * that tool's schema to say, not this rule.
 */
export function buildCollaborationSection(
  toolNames: readonly string[],
  // The answer to WHO changes with the room, so the rule has to know it. Alone, doing it
  // yourself is the default and a fork buys parallelism. With colleagues present that default
  // is the failure: a non-leader once read "do the work yourself … delegate
  // substantial work" with @frontend and @qa in the room and sent both tasks to one-shot
  // children the person could not see or redirect — which is why other roles now only join.
  room: {
    withColleagues: boolean
    /** A conversation exists for this run (a chat or a delegated team). */
    inConversation?: boolean
    rosterLocked?: boolean
    isLeader?: boolean
  } = { withColleagues: false },
): string | null {
  const has = (name: string) => toolNames.includes(name)
  const fork = has(TOOL.fork)
  const inConversation = room.inConversation ?? room.withColleagues
  const canInvite = inConversation && !room.rosterLocked
  if (!fork && !canInvite && !room.withColleagues) return null
  const { withColleagues } = room
  const isLeader = room.isLeader ?? !withColleagues
  return [
    '# Collaboration',
    withColleagues
      ? 'Colleagues share this conversation: each part belongs to the participant whose role owns it. Do your own part; hand a colleague their ready part by @mentioning them, so they work here, where the user can redirect them.'
      : 'Handle straightforward work directly.',
    ...(fork
      ? [
          '- Fork yourself (`fork`) to keep this context clean: searches and investigations, long or independent work. The fork inherits this conversation, works in parallel and reports back; integrate its report. Keep the critical path here.',
        ]
      : []),
    ...(canInvite
      ? [
          '- Bring in a suitable agent from the directory when another role is needed: @mention it with a concrete assignment (scope, constraints, acceptance evidence). It joins and starts when your reply ends, not before.',
        ]
      : withColleagues
        ? [
            '- The user fixed who is in this conversation: nobody can be brought in or removed, so work only with the participants here.',
          ]
        : []),
    ...(canInvite && has(TOOL.agents)
      ? [
          '- Reuse directory agents before creating one. Create missing reusable specialists with `agents`, a supporting role below the current leader’s priority; only the user changes their permissions. Report creation errors, keep successful definitions, then @mention the created handles with their assignments: creation alone starts no work.',
          ...(isLeader
            ? [
                '- You are the elected leader, even while alone: assess whether the goal needs distinct specialties. When it does, or when the user asks for a team, build the smallest useful team before any implementation and hand each part to its owner instead of doing it yourself; do not wait for the user to name roles. Create all missing specialists in one batch and @mention each ready owner with a concrete scope, dependencies and acceptance evidence. Keep straightforward work direct. Own coordination, integration and the requested outcome; grow the team only for uncovered work, and respect user constraints and fixed membership.',
              ]
            : [
                '- The elected leader assembles the team. Report missing expertise to the leader instead of bringing agents in yourself, and keep to your assigned scope; do not start another team or duplicate an active owner’s work.',
              ]),
        ]
      : []),
    `- Work ${fork ? 'already owned by a colleague or a running fork' : 'a colleague has already taken on'} is theirs: ask for its status instead of starting it again.`,
  ].join('\n')
}
