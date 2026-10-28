import { describe, expect, it } from 'bun:test'
import { createChatCacheDiagnostics, createChatCacheSnapshot } from '@localixai/agent'
import { RUNTIME_CONTEXT_MARKER } from '@localixai/agent/chat-cache'
import { promptTexts } from '../../effective-config/prompt-texts'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import { computeCacheDiagnostics } from './cache-diagnostics'
import { routedAgent } from '../../../testing/session-fixture'

describe('computeCacheDiagnostics', () => {
  const msg = (id: string, content: string): PersistedMessage =>
    ({
      id,
      sessionId: 's',
      userId: 'u',
      payload: { id, role: 'user', content },
      createdAt: '',
      updatedAt: '',
    }) as PersistedMessage
  const session = {
    id: 's',
    agent: routedAgent({ modelId: 'opus', reasoningEffort: 'high' }),
  } as unknown as SessionRecord

  it('maps session/history/tools straight into the snapshot', () => {
    const { snapshot } = computeCacheDiagnostics({
      createDiagnostics: createChatCacheDiagnostics,
      session,
      agentId: session.agent!.agentId,
      historyMessages: [msg('a', 'hello'), msg('b', 'world')],
      systemPrompt: 'You are helpful.',
      providerId: 'anthropic',
      runtimeTools: { toolNames: ['read', 'write'] },
    })
    expect(snapshot.providerId).toBe('anthropic')
    expect(snapshot.modelId).toBe('opus')
    expect(snapshot.messageCount).toBe(2)
    expect(snapshot.toolNames).toEqual(['read', 'write'])
    expect(typeof snapshot.systemPromptHash).toBe('string')
    expect(typeof snapshot.toolNamesHash).toBe('string')
  })

  it('reads the model from the session agent route', () => {
    const second = {
      ...session.agent!,
      agentId: 'agent-second',
      name: 'second',
      modelId: 'sonnet',
      reasoningEffort: 'low' as const,
    }
    const multi = { ...session, agent: second }
    const { snapshot } = computeCacheDiagnostics({
      createDiagnostics: createChatCacheDiagnostics,
      session: multi,
      agentId: second.agentId,
      historyMessages: [],
      systemPrompt: 'Stable prompt',
      providerId: 'anthropic',
      runtimeTools: { toolNames: [] },
    })

    expect(snapshot.modelId).toBe('sonnet')
  })

  const args = (systemPrompt: string, history: PersistedMessage[] = [msg('a', 'hello')]) => ({
    createDiagnostics: createChatCacheDiagnostics,
    session,
    agentId: session.agent!.agentId,
    historyMessages: history,
    systemPrompt,
    providerId: 'anthropic',
    runtimeTools: { toolNames: ['read'] },
  })

  it('is deterministic for identical inputs', () => {
    expect(computeCacheDiagnostics(args('sys')).snapshot.systemPromptHash).toBe(
      computeCacheDiagnostics(args('sys')).snapshot.systemPromptHash,
    )
  })

  /**
   * Determinism alone is a TAUTOLOGY: `f(x) === f(x)` holds for every pure function, a constant
   * one included. The only property a cache-diagnostics hash HAS is that it changes when its
   * input changes — that is what "the cached prefix moved" means. Nothing pinned it: replacing
   * `systemPrompt: params.systemPrompt` with `systemPrompt: ""` in message-persistence.ts made
   * the snapshot blind to the entire system prompt (so a prompt rewrite would be reported as a
   * cache HIT) and all 853 chat tests stayed green. Verified by mutation.
   */
  it('the snapshot hash actually reads the system prompt — a different prompt hashes differently', () => {
    const a = computeCacheDiagnostics(args('You are helpful.')).snapshot.systemPromptHash
    const b = computeCacheDiagnostics(args('You are terse.')).snapshot.systemPromptHash
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(0) // …and neither is the empty string a constant hasher returns
  })

  it('the snapshot reads the history too — a changed turn moves the dynamic hash, not just the count', () => {
    const one = computeCacheDiagnostics(args('sys', [msg('a', 'hello')])).snapshot
    const two = computeCacheDiagnostics(args('sys', [msg('a', 'goodbye')])).snapshot
    // Same message COUNT, different content: a snapshot keyed only on the count cannot see this.
    expect(two.messageCount).toBe(one.messageCount)
    expect(one.dynamicSuffixHash).toBeTruthy()
    expect(two.dynamicSuffixHash).not.toBe(one.dynamicSuffixHash)
  })
})

describe('the text retained behind each hash', () => {
  const msg = (id: string, content: string): PersistedMessage =>
    ({
      id,
      sessionId: 's',
      userId: 'u',
      payload: { id, role: 'user', content },
      createdAt: '',
      updatedAt: '',
    }) as PersistedMessage
  const session = {
    id: 's',
    agent: routedAgent({ modelId: 'opus', reasoningEffort: 'high' }),
  } as unknown as SessionRecord

  it('re-hashes to the hash it was stored under', () => {
    /**
     * The invariant the store exists for: a diff is only trustworthy if the text keyed by a
     * hash is the text that PRODUCED it. Re-hashing is self-checking — it catches any wrong
     * text, not just the one a hand-written expectation happened to think of. (A mutation that
     * stored the wrong text under the stable-prefix hash passed every other test here.)
     */
    const systemPrompt = [
      'You are helpful.',
      RUNTIME_CONTEXT_MARKER,
      'Conversation date: 2026-08-20',
    ].join('\n')
    const { snapshot } = computeCacheDiagnostics({
      createDiagnostics: createChatCacheDiagnostics,
      session,
      agentId: session.agent!.agentId,
      historyMessages: [msg('a', 'hello')],
      systemPrompt,
      providerId: 'anthropic',
      runtimeTools: { toolNames: ['read'] },
    })

    for (const hash of [
      snapshot.systemPromptHash,
      snapshot.stablePrefixHash,
      snapshot.dynamicSuffixHash,
    ]) {
      if (!hash) continue
      const text = promptTexts.get(hash)
      expect(text).toBeDefined()
      // Re-hashed through the PUBLIC snapshot builder rather than the private hash functions:
      // the two prompt halves hash as a system prompt, the suffix as a suffix, so feeding the
      // retrieved text back through the same builder must reproduce the hash it was filed
      // under. No test-only export needed to check it.
      const asPrompt = createChatCacheSnapshot({
        modelId: 'x',
        systemPrompt: text as string,
        messageCount: 0,
      }).systemPromptHash
      const asSuffix = createChatCacheSnapshot({
        modelId: 'x',
        systemPrompt: '',
        dynamicSuffix: text as string,
        messageCount: 0,
      }).dynamicSuffixHash
      expect(asPrompt === hash || asSuffix === hash).toBe(true)
    }
  })

  it('keeps the stable prefix, not the whole prompt, under the prefix hash', () => {
    // They are different texts and different questions: the prefix is what the provider
    // caches, and conflating them would make every diff show the volatile tail as a change.
    const systemPrompt = ['stable half', RUNTIME_CONTEXT_MARKER, 'volatile half'].join('\n')
    const { snapshot } = computeCacheDiagnostics({
      createDiagnostics: createChatCacheDiagnostics,
      session,
      agentId: session.agent!.agentId,
      historyMessages: [msg('a', 'hi')],
      systemPrompt,
      providerId: 'anthropic',
      runtimeTools: { toolNames: ['read'] },
    })

    expect(promptTexts.get(snapshot.stablePrefixHash)).not.toContain('volatile half')
    expect(promptTexts.get(snapshot.systemPromptHash)).toContain('volatile half')
  })
})
