import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The vault shield only exists at runtime if the composition FORWARDS it, and a review proved that
 * forwarding was undetectably revertible: deleting the seven lines that pass `sanitizePayload` into
 * `createHitlRegistry` left all 6140 apps/api tests green, because every behavioural test supplies its
 * own sanitizer. The same is true of the three `sanitizeTool*` deps.
 *
 * A source assertion rather than a behavioural one, on purpose. Standing up the real graph needs a DB,
 * a runtime and a provider service; what actually breaks here is a DELETED LINE, and the cheapest
 * honest guard for a deleted line is to read the file — the same stance as this package's other
 * composition-root contracts (`realtime/composition-root-contract.test.ts`,
 * `lib/path-containment-contract.test.ts`).
 */
const read = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('the chat service graph forwards every vault-shield dep', () => {
  const graph = read('./service-graph.ts')

  test.each([
    ['sanitizeToolResult', 'a tool RESULT'],
    ['sanitizeToolError', 'a tool THROW'],
    ['sanitizeToolInput', "a tool call's ARGUMENTS and streaming details"],
    ['sanitizeText', 'a provider error MESSAGE'],
  ])('%s reaches the agent runner (%s)', (dep) => {
    expect(graph).toContain(`${dep}: deps.${dep}`)
  })

  test('the HITL registry is constructed WITH a payload sanitizer', () => {
    // Not just "the word appears": it must be wired from the dep, or the approval card goes back to
    // carrying the raw command to the wire, to every plugin hook, and to the reconnect list.
    expect(graph).toContain('sanitizePayload')
    expect(graph).toMatch(/sanitizePayload:\s*deps\.sanitizeToolInput/)
  })

  test('the HITL registry announces a request that ended without an answer', () => {
    // Same deleted-line risk: without this forward an expired or aborted request publishes nothing,
    // and its card plus its Event Center row stay "Respond" for a question nobody awaits.
    expect(graph).toMatch(
      /onClearedUnanswered:[\s\S]{0,120}streamRegistry\.publish[\s\S]{0,160}type: 'hitl\.resolved'/,
    )
  })

  test('bootstrap binds all of them to the shield, including the MCP observer', () => {
    const chatServiceDeps = read('../../../bootstrap/chat-service-deps.ts')
    for (const bound of [
      'sanitizeToolResult',
      'sanitizeToolError',
      'sanitizeToolInput',
      'sanitizeText',
    ]) {
      expect(chatServiceDeps).toMatch(
        new RegExp(`${bound}:\\s*\\(\\.\\.\\.args\\) => secretExposureShield`),
      )
    }
    // MCP credentials live in their own store and are registered through a module-level observer, so
    // dropping this ONE call silently makes every provider's `onSecretResolved` undefined.
    expect(read('../../../bootstrap/infra.ts')).toContain('observeMcpOAuthSecrets(')
  })
})
