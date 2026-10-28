/**
 * The CACHED half of the prompt catalog (`catalog.ts`): every section of the system prompt, in
 * order. Each declares `tier: 'stable'` with the reason it never changes mid-turn.
 */
import type { PromptSection } from './section'
import { RUNTIME_CONTEXT_PROTOCOL } from './runtime-sections'
import { buildCorePrinciples } from './sections/discipline'
import { buildSelfSection } from './sections/self'

/**
 * ONE system prompt. The cached prefix is the agent's own instructions and what is the same for
 * every run: the core principles, the host, the protocol of the runtime context. Everything that
 * depends on the kind of run, its tools, its depth, its mode or its workspace is a `state`
 * section, carried in the conversation's runtime context as in Claude Code, so a subagent, a fork
 * or a run with fewer tools reads the same cached prefix (`system-prompt-one.test.ts`). The tools
 * are not listed here: their definitions are what the model receives.
 */
export const CACHED_SECTIONS: readonly PromptSection[] = [
  // Identity and standing instruction — byte-identical for the life of a deployment.
  //
  // WHO this run is arrives ONE way: on the profile, put there by `resolveRunProfile` from the
  // agent record the host dispatched with. Empty means no host passed an agent, which is a host
  // bug rather than a state to paper over: an agent's system prompt is required.
  { id: 'identity', tier: 'stable', render: (f) => f.profile.prompt.identity.trim() },
  {
    id: 'principles',
    tier: 'stable',
    heading: '# Core principles',
    render: () => buildCorePrinciples(),
  },
  {
    // The host application and its source: fixed for the life of a deployment.
    id: 'self',
    tier: 'stable',
    heading: '# About Localix',
    render: () => buildSelfSection(),
  },
  {
    // How to read the `<runtime-context>` rows the history carries — fixed text, never per turn.
    id: 'context-protocol',
    tier: 'stable',
    heading: '# Context protocol',
    render: () => RUNTIME_CONTEXT_PROTOCOL,
  },
]
