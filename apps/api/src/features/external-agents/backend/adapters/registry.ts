/**
 * The provider registry.
 *
 * This array IS the provider support matrix. Adding `cursor` or `aider` means writing one
 * descriptor file and appending it here — there is no switch statement anywhere in the discovery,
 * roster, transcript, or context layers to also edit. Every one of those layers takes a
 * `ProviderAdapter` and calls its methods.
 *
 * `verified` is an honesty flag, not a feature flag. It is `true` only for adapters that were run
 * against real history on a real machine during development, and it is surfaced in the UI and in
 * `ProviderStatus`. Shipping an unverified adapter is allowed; shipping one that CLAIMS to be
 * verified is not.
 */

import type { ProviderAdapter } from './types'
import { claudeCodeAdapter } from './claude-code'
import { codexAdapter } from './codex'
import { geminiCliAdapter } from './gemini-cli'
import { githubCopilotAdapter } from './github-copilot'
import { hermesAdapter } from './hermes'
import { opencodeAdapter } from './opencode'

export const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
  geminiCliAdapter,
  githubCopilotAdapter,
  hermesAdapter,
]

const BY_ID = new Map(PROVIDER_ADAPTERS.map((a) => [a.id, a]))

export function adapterFor(provider: string): ProviderAdapter | undefined {
  return BY_ID.get(provider)
}

export function providerIds(): readonly string[] {
  return PROVIDER_ADAPTERS.map((a) => a.id)
}
