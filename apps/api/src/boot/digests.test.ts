import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dir, './digests.ts'), 'utf8')
const rootChatsStart = source.indexOf('const listRootChatSessions = async')
const finalTextStart = source.indexOf('const finalAssistantText = async')
const rootChats = source.slice(rootChatsStart, finalTextStart)
const sessionDigestStart = source.indexOf('const loadSessionDigest = async')
const terminalDigestStart = source.indexOf('const loadTerminalDigest = async')
const sessionDigest = source.slice(sessionDigestStart, terminalDigestStart)
const finalText = source.slice(finalTextStart, sessionDigestStart)
const callDigestStart = source.indexOf('const loadCallDigest = async')
const projectDigestStart = source.indexOf('const loadProjectDigest = async')
const callDigest = source.slice(callDigestStart, projectDigestStart)
const messageDigestStart = source.indexOf('const loadMessageDigest = async')
const messageDigestEnd = source.indexOf('  /**\n   * Listing ports', messageDigestStart)
const messageDigest = source.slice(messageDigestStart, messageDigestEnd)
const chatNavPortsStart = source.indexOf('  const chatNavPorts =')
const chatNavPortsEnd = source.indexOf('\n\n  return {', chatNavPortsStart)
const chatNavPorts = source.slice(chatNavPortsStart, chatNavPortsEnd)

describe('digest loaders', () => {
  test('reads only the bounded active-branch session digest projection', () => {
    expect(sessionDigestStart).toBeGreaterThan(-1)
    expect(terminalDigestStart).toBeGreaterThan(sessionDigestStart)
    expect(sessionDigest).toContain('getSessionDigestMessages(')
    expect(sessionDigest).toContain('DIGEST_MAX_TURNS')
    expect(sessionDigest).not.toContain('listMessages(')
  })

  test('loads the project chat-nav roster through the scoped SQLite projection', () => {
    // This is a query-shape guard: result assertions cannot reveal whether the
    // loader hydrated every wide session row before filtering the same result.
    expect(rootChatsStart).toBeGreaterThan(-1)
    expect(finalTextStart).toBeGreaterThan(rootChatsStart)
    expect(rootChats).toContain('listProjectRootChatSessions(userId, projectId)')
    expect(rootChats).not.toContain('listSessions(userId)')
  })

  test("reads a worker's completion text without transcript hydration", () => {
    expect(finalText).toContain('getLatestAutonomousAssistantContentMessage(')
    expect(finalText).not.toContain('listMessages(')
  })

  test('scopes call refs to matching active-branch messages', () => {
    expect(callDigestStart).toBeGreaterThan(-1)
    expect(projectDigestStart).toBeGreaterThan(callDigestStart)
    expect(callDigest).toContain('listActiveBranchToolCallMessagesByPrefix(')
    expect(callDigest).not.toContain('getSession(')
    expect(callDigest).not.toContain('listMessages(')
  })

  test('expands an immutable message ref with one point read', () => {
    // This is a query-shape guard: a result-only test cannot distinguish an
    // indexed getMessage from loading and parsing every row in the transcript.
    expect(messageDigestStart).toBeGreaterThan(-1)
    expect(messageDigestEnd).toBeGreaterThan(messageDigestStart)
    expect(messageDigest).toContain('repo.getMessage(userId, sessionId, messageId)')
    expect(messageDigest).not.toContain('repo.getSession(')
    expect(messageDigest).not.toContain('repo.listMessages(')
  })

  test('uses a bounded active-branch page for chat-nav without a typed query', () => {
    expect(chatNavPortsStart).toBeGreaterThan(-1)
    expect(chatNavPortsEnd).toBeGreaterThan(chatNavPortsStart)
    expect(chatNavPorts).toContain('listRecentVisibleMessages(')
  })
})
