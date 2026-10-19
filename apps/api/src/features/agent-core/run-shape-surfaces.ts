import type { RunShape } from '@localixai/agent/agents'

/**
 * What each run SHAPE is made of — the data half of `run-shape.ts`.
 *
 * Split out so the derivation there stays readable as a derivation: this file answers "what
 * is an unattended run told, and which tool FEATURES does it lose", and `run-shape.ts`
 * answers "given this agent and this host, what is the surface". Neither is a roster of
 * agents — WHO is running is always the agent record (`features/agents`).
 *
 * WHICH tools a shape carries is not here any more either. Two per-shape allowlists
 * (`SUBAGENT_TOOLS`, `AUTOMATION_TOOLS`) used to live in this file, each a hand-kept second
 * answer to a question every tool now answers about itself through its catalog `exposure`
 * (`tool-names.ts`). The reasoning that justified each membership moved next to the tool it
 * was about.
 */

/**
 * Bash features turned off for every unattended run (sub-agents and scheduled
 * automations): `background` long-running jobs and the user `notify` action have no host
 * watching them, so they are disabled across the board.
 */
export const NON_INTERACTIVE_BASH_FEATURES = ['background', 'notify'] as const

/**
 * How the run works — the only prose a SHAPE owns.
 *
 * Never who the agent is: that is its record's `prompt`, which lands in the identity slot.
 * The two are separate slots precisely so a persona replacing the identity cannot take a
 * rule with it — the same agent in a chat and in a delegated child needs the same identity
 * and different rules.
 */
export const GUIDANCE: Record<RunShape, readonly string[]> = {
  chat: [
    // Role FRAMING only — this line must not NAME a tool (`run-shape.test.ts` pins that:
    // guidance survives a roster the tool is missing from); the capability line beside it is
    // derived from the roster (`prompt/sections/role.ts`).
    // WHEN work goes to a child or a colleague is `# Collaboration`'s one rule; this line used to
    // carry a second copy of it ("do trivial work inline"), which is how the two drifted. What
    // stays here is the exception to "do it yourself": a leader once built the whole game alone on
    // "let us do it as a team", then had the team rework its prototype, and the person spent the
    // session undoing it.
    // Every agent in a chat reads this, so it names no role: who leads is decided by priority and
    // said only to the leader (`# Collaboration`, `## Leadership`).
    'You work with the user in this session. Own your part through to a verified result; when colleagues share this conversation, leave their parts to them.',
  ],
  subagent: [
    // No word about the user: a child has no channel to them (no `ask`), and "never ask the
    // user", said here and again in execution discipline, described a channel it does not have.
    'Stay inside the assigned task. Work autonomously: decide conservatively, or report a concrete blocker to the parent.',
    // (tool-use cadence + no routine narration are in "# Core principles", not restated here.)
    // (the shell/verify rule and the REPORT the parent reads live in "# Execution
    //  discipline" — the report once, in `childReportLine`, not here as well.)
  ],
  automation: [
    'No human is watching this run — never ask questions; decide and act, or report the blocker.',
    // "run", not "job": a job is a background process (`jobs`), a loop is a schedule — the
    // prompt uses each word for one thing.
    'Keep the final reply a concise outcome summary — it is recorded as this run’s result. If you are blocked, say so there: there is no human to ask.',
  ],
}

export const DESCRIPTIONS: Record<RunShape, string> = {
  chat: 'Works with the user, with full project tools, forks and colleagues.',
  subagent: 'Executes a focused delegated task and reports back to the session that spawned it.',
  automation: 'Unattended scheduled run: no human in the loop.',
}
