/**
 * Which side of the prompt-cache boundary each system-prompt section belongs on.
 *
 * `buildAgentSystemPrompt` emits `# Runtime context` as the marker splitting the prompt in
 * two, and the run path caches everything ABOVE it as a stable prefix. So a section's
 * position is not a layout choice, it is a cost decision:
 *
 *  - `stable`   — inside the cacheable prefix. Putting per-turn content here rewrites the
 *                 prefix every turn, and the whole system+tools prefix misses cache with it.
 *                 That is the most expensive mistake available in the prompt.
 *  - `volatile` — in the tail the run moves out of the cached prefix. Putting session-stable
 *                 content here is the cheap mistake: correct output, needlessly excluded
 *                 from the cross-session cache.
 *
 * This table exists because the invariant was previously pinned by a HAND-WRITTEN list of
 * headers inside one test. A new section could be added above the boundary and nothing
 * failed until somebody remembered to extend that list — the drift a plausible-looking
 * change never announces. Here the declaration is compared against a real render, so a new
 * section must be classified before it can ship, and a classification that disagrees with
 * where the section actually lands fails.
 *
 * Scope is exactly the sections this builder positions relative to the marker. Model-facing
 * text assembled elsewhere — a skill tool's result, the memory block injected into a spawned
 * agent — is not placed against this boundary and is deliberately absent.
 *
 * Token ceilings are NOT declared here. They are enforced where the content is assembled
 * (`capAggregatePromptContext`, `SKILL_LISTING_BUDGET`, `BACKGROUND_JOB_PROMPT_MAX_ITEMS`),
 * and a second, unenforced copy of that number would only be free to drift from it.
 */
export type PromptCacheTier = 'stable' | 'volatile'

export const PROMPT_SECTION_CACHE_TIERS: Readonly<Record<string, PromptCacheTier>> = {
  // Identity and standing instruction — byte-identical for the life of a deployment.
  '# Core principles': 'stable',
  '# Runtime role': 'stable',
  // Gated on the roster only: who may do the work changes when the tools do, never mid-turn.
  '# Collaboration': 'stable',
  '# Execution discipline': 'stable',
  '# Available tools': 'stable',

  // Mode guidance. One mode renders per run, and it holds for the whole run.
  // Workspace and project. Fixed per project, and shared by every session in it.
  '# Workspace': 'stable',
  '# Project context': 'stable',
  '# Project instructions': 'stable',
  // The conversation's plan: the mode's instruction (it holds for the whole run) and the plan the
  // person approved (it changes when they decide, never mid-turn).
  '# Plan mode': 'stable',
  '# Approved plan': 'stable',
  '# Channel': 'stable',
  // The turn protocol changes when a conversation goes from one agent to several, or its
  // leader changes — not when a colleague is invited or leaves (that is the roster, below).
  '# Conversation turn control': 'stable',

  // How the transcript renders an answer: fixed by the shape and the delivery, never per turn.
  '# Answer formatting': 'stable',
  // The session objective changes only when the topic owner sets a new one, so it closes the
  // cached prefix: a topic change rewrites the least of it.
  '# Session objective': 'stable',

  // Persistent memory belongs in the stable prefix.
  '# Memory context': 'stable',
  // How to read the `<runtime-context>` rows the history carries — fixed text, never per turn.
  '# Context protocol': 'stable',

  // Capability catalogs. These change when the deployment changes — installing a plugin,
  // adding a skill — not while a turn runs.
  '# Available skills': 'stable',
  '# Active skills (applied to this session)': 'stable',
  '# Plugins': 'stable',
  // The ledger's remediable withholds: a rule change moves them, a turn never does.
  '# Unavailable tools': 'stable',

  // The marker itself, and everything after it: state that moves under the agent's own feet.
  '# Runtime context': 'volatile',
  '# Scratch space': 'volatile',
  '# Active sub-agents': 'volatile',
  '# Background jobs': 'volatile',
  '# Loops': 'volatile',
  // Keyword-triggered skills: the trigger is this turn's message, so the content is too.
  '# Triggered skills': 'volatile',
  // Agents invite and remove each other mid-conversation; above the boundary every such change
  // rewrote the cached prefix of every participant.
  '# Conversation participants': 'volatile',
  // The registry: a rule edit or a colleague joining changes a row, with no turn boundary.
  '# Agent directory': 'volatile',
  // Marks placed since this agent last spoke — per turn by definition.
  '# Reactions since your last turn': 'volatile',
  // A fresh shallow tree, re-read every run: the agent itself changes it.
  '# Project structure': 'volatile',
  // MCP inventory reflects which servers are connected RIGHT NOW, including ones still
  // connecting — it changes without anything in the conversation changing.
  '# MCP servers': 'volatile',
  '# MCP server instructions': 'volatile',
}
