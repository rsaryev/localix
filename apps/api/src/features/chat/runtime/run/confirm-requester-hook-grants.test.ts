/**
 * A PermissionRequest hook sees the card's widenings as `permission_suggestions` and may echo one
 * back as `updatedPermissions` (hooks.md, "Permission update entries"): a `session` entry remembers
 * the grant for the session, a settings entry also writes the "Always" rule.
 */
import { describe, expect, test } from 'bun:test'

import { INERT_CC_HOOKS, type PermissionRequestResult } from '../../../cc-hooks'
import { programGrant, type GrantOption } from '../../../agent-core/permission-grant-scope'
import type { SessionRecord } from '../../repository'
import { listSessionGrants, type SessionGrants } from '../session-grants'
import { createConfirmRequester } from './confirm-requester'

const chat = {
  id: 's',
  sessionKind: 'chat',
  agents: [{ agentId: 'qa' }],
} as unknown as SessionRecord
const bashCall = (command: string) => ({
  toolCallId: 'tc1',
  toolName: 'bash',
  command,
  subject: 'command' as const,
  grants: [programGrant('bash', command)].filter((g): g is GrantOption => !!g),
})

function harness(answer: (suggestions: unknown[]) => PermissionRequestResult) {
  const grants: SessionGrants = new Map()
  const persisted: unknown[] = []
  const seen: unknown[][] = []
  const env = {
    state: { sessionAutoApprovedTools: grants },
    deps: {
      hitlRegistry: {
        trackRequest: (_t: string, _m: string, _tc: string, _n: string, request: unknown) =>
          request,
        clearRequest: () => {},
        // The person never answers: the hook decides.
        controller: {
          request: (_r: unknown, signal: AbortSignal) =>
            new Promise((_, reject) =>
              signal.addEventListener('abort', () => reject(new Error('withdrawn'))),
            ),
        },
      },
      streamRegistry: { publish: () => {} },
      persistPermissionRule: async (_u: string, agentId: string, rule: unknown) => {
        persisted.push({ agentId, rule })
      },
    },
  }
  const request = createConfirmRequester({
    env: env as never,
    userId: 'u',
    session: chat,
    agentId: 'qa',
    hitlTargetSessionId: 's',
    assistantMessageId: 'm1',
    abortSignal: new AbortController().signal,
    miniAppHooksForRun: [],
    hookRunOptions: { sessionId: 's', logger: { warn: () => {} } },
    ccHooks: {
      ...INERT_CC_HOOKS,
      active: true,
      hasHooks: (event: string) => event === 'PermissionRequest',
      runPermissionRequest: async (
        _tool: unknown,
        _input: unknown,
        opts?: { suggestions?: unknown[] },
      ) => {
        seen.push(opts?.suggestions ?? [])
        return answer(opts?.suggestions ?? [])
      },
    } as never,
  })
  return { request, grants: () => listSessionGrants(grants, 's'), persisted, seen }
}

describe('PermissionRequest updatedPermissions', () => {
  test('the hook is offered the card’s widenings as permission_suggestions', async () => {
    const h = harness(() => ({ behavior: 'allow' }))
    await h.request(bashCall('git status'), { input: { command: 'git status' } })
    expect(h.seen[0]).toContainEqual({
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'git' }],
      behavior: 'allow',
      destination: 'session',
    })
  })

  test('echoing the session suggestion remembers the grant for the session', async () => {
    const h = harness((suggestions) => ({
      behavior: 'allow',
      updatedPermissions: suggestions.filter(
        (entry) => (entry as { destination: string }).destination === 'session',
      ),
    }))
    expect(await h.request(bashCall('git status'), { input: {} })).toMatchObject({ approved: true })
    expect(h.grants()).toEqual(['bash(git)'])
    expect(h.persisted).toEqual([])
  })

  test('echoing a settings suggestion also writes the Always rule', async () => {
    const h = harness((suggestions) => ({
      behavior: 'allow',
      updatedPermissions: suggestions.filter(
        (entry) => (entry as { destination: string }).destination === 'localSettings',
      ),
    }))
    await h.request(bashCall('git status'), { input: {} })
    expect(h.persisted).toHaveLength(1)
    expect(h.grants()).toEqual(['bash(git)'])
  })

  test('an entry that is none of the suggestions widens nothing', async () => {
    const h = harness(() => ({
      behavior: 'allow',
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    }))
    await h.request(bashCall('git status'), { input: {} })
    expect(h.grants()).toEqual([])
  })
})
