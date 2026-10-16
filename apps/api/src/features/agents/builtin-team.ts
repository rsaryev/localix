import { HUMAN_HANDLE } from '@localixai/agent/agents'
import type { AgentRecord } from './contracts'
import { DEFAULT_AGENT_HANDLE } from '../../db/participant'
import { builtin } from './builtin-kit'

/**
 * The shipped records: the one assistant, and the person (`@human`). Invocation and access live in
 * Capabilities; the human has neither — it is described, never run.
 */
export const BUILTIN_TEAM: readonly AgentRecord[] = [
  builtin({
    handle: DEFAULT_AGENT_HANDLE,
    leadershipPriority: 2,
    label: 'Localix',
    description: 'The general assistant: any task, directly or with a team.',
    // THE product's identity, and the only copy of it.
    //
    // It used to live in `agent-core` as `DEFAULT_AGENT_IDENTITY`, with this record shipping a
    // blank persona that meant "look in the code" — so the text a user came to Settings to read
    // was not there, and the runtime had an identity of its own beside the registry's. Here it
    // is an ordinary record like any other: editable, and restorable by the same Restore that
    // every shipped agent has.
    //
    // Only "who". The behavioural rules a general assistant needs — verify, be honest, be
    // minimal — are "# Core principles", stated once for every run; a second copy here would be
    // silently deleted the moment a user rewrote this agent's instructions, because an edit
    // replaces this text wholesale.
    //
    // No leadership here: who leads a conversation is decided by priority, and the leader's
    // duties are added to whichever agent that is (`# Collaboration`, `## Leadership`).
    instructions:
      'You are Localix Agent, a general-purpose assistant. Keep the user’s decisions with the user.',
  }),
  builtin({
    kind: 'human',
    handle: HUMAN_HANDLE,
    label: 'Human',
    // Empty: the prompt already introduces @human as the person you work with.
    description: '',
    instructions: '',
    leadershipPriority: 0,
  }),
]
