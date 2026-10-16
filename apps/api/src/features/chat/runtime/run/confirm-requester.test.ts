import { describe, expect, test } from 'bun:test'
import { createConfirmRequester } from './confirm-requester'
import type { SessionRecord } from '../../repository'
import { createHitlRegistry } from '../hitl-registry'
import { createDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { createPermissionRulePersister } from '../../../capabilities/availability'
import { createCapabilityRuleRepository } from '../../../capabilities/rule-repository'
import { grantScope, listSessionGrants, type SessionGrants } from '../session-grants'
import { programGrant, type GrantOption } from '../../../agent-core/permission-grant-scope'
import { pathGrants } from '../../../agent-core/permission-grant-paths'

/** The requester `make` runs as for the plain `chat` fixture (no participants → 'agent-1'). */
const CHAT_RUN = { sessionId: 's', agentId: 'agent-1' }
const seed = (h: { sessionAutoApprovedTools: SessionGrants }, scope: string) =>
  grantScope(h.sessionAutoApprovedTools, 's', CHAT_RUN, scope)
const granted = (h: { sessionAutoApprovedTools: SessionGrants }, surfacedIn = 's') =>
  listSessionGrants(h.sessionAutoApprovedTools, surfacedIn)

type Published = {
  sessionId: string
  toolName: string
  request: { title: string }
  type?: string
  autoApprovedTools?: string[]
}

function harness(
  outcome: 'confirm' | 'deny' | 'reject' | 'always' | { answers: Record<string, unknown> },
) {
  const published: Published[] = []
  const tracked: Array<{ targetSessionId: string; toolName: string }> = []
  const cleared: string[] = []
  const sessionAutoApprovedTools: SessionGrants = new Map()
  const controller = {
    request: async () => {
      if (typeof outcome === 'object') return { payload: outcome }
      if (outcome === 'reject') throw new Error('dismissed')
      if (outcome === 'always')
        return { payload: { answers: { confirmed: true, scope: 'session' } } }
      return { payload: { answers: { confirmed: outcome === 'confirm' } } }
    },
  }
  const env = {
    state: { sessionAutoApprovedTools },
    deps: {
      hitlRegistry: {
        // Must RETURN the request: `surfaceConfirmRequest` publishes and the caller hooks from the
        // returned copy (the shielded one), so a fake that returned anything else made the card go
        // out with an undefined payload and `clearRequest(undefined)` — which this suite caught.
        trackRequest: (
          targetSessionId: string,
          _m: string,
          _tc: string,
          toolName: string,
          request: unknown,
        ) => {
          tracked.push({ targetSessionId, toolName })
          return request
        },
        clearRequest: (id: string) => cleared.push(id),
        controller,
      },
      streamRegistry: {
        publish: (
          _u: string,
          sessionId: string,
          e: {
            toolName: string
            request: { title: string }
            type?: string
            autoApprovedTools?: string[]
          },
        ) =>
          published.push({
            sessionId,
            toolName: e.toolName,
            request: e.request,
            type: e.type,
            autoApprovedTools: e.autoApprovedTools,
          }),
      },
    },
  }
  return { env, published, tracked, cleared, sessionAutoApprovedTools }
}

type Notified = { message: string; notificationType?: string; title?: string }

const make = (env: unknown, session: SessionRecord, notifications: Notified[] = []) =>
  createConfirmRequester({
    env: env as never,
    userId: 'u',
    session,
    agentId: session.agents?.[0]?.agentId ?? 'agent-1',
    hitlTargetSessionId: session.parentSessionId ? (session.rootSessionId ?? 'parent') : session.id,
    assistantMessageId: 'm1',
    abortSignal: new AbortController().signal,
    pluginHooksForRun: [],
    hookRunOptions: { sessionId: session.id, logger: { warn: () => {} } },
    ccHooks: {
      active: true,
      runNotification: async (n: Notified) => {
        notifications.push(n)
      },
    } as never,
  })

const chat = { id: 's', sessionKind: 'chat' } as unknown as SessionRecord
const subagent = {
  id: 'sub',
  sessionKind: 'subagent',
  parentSessionId: 'parent',
  title: 'Worker',
} as unknown as SessionRecord
const job = { id: 'j', sessionKind: 'job' } as unknown as SessionRecord
const req = { toolCallId: 'tc1', toolName: 'bash', message: 'run ls' }
/** A shell call as the gate hands it over: its subject, and the program grant it may offer. */
const bashCall = (command: string) => ({
  ...req,
  command,
  subject: 'command' as const,
  grants: [programGrant('bash', command)].filter((g): g is GrantOption => !!g),
})

describe('createConfirmRequester', () => {
  test('chat session, approved → {approved, via:"user"}; tracks/publishes to itself and clears the request', async () => {
    const h = harness('confirm')
    const ok = await make(h.env, chat)(req)
    expect(ok).toEqual({ approved: true, via: 'user' })
    expect(h.tracked[0].targetSessionId).toBe('s')
    expect(h.published[0].sessionId).toBe('s')
    expect(h.cleared).toEqual(['perm:tc1'])
  })

  test('chat session, denied → not approved (still cleared)', async () => {
    const h = harness('deny')
    expect(await make(h.env, chat)(req)).toEqual({ approved: false, via: 'user' })
    expect(h.cleared).toEqual(['perm:tc1'])
  })

  test('dismissed (controller rejects) → refused as a person refusing', async () => {
    // A dismissal is somebody closing the card, so it reads as `user` — the same as pressing
    // Deny. Only an EXPIRED card reports `timeout`, and the gate tells the model apart.
    const h = harness('reject')
    expect(await make(h.env, chat)(req)).toEqual({ approved: false, via: 'user' })
    expect(h.cleared).toEqual(['perm:tc1'])
  })

  test('parentless job approval stays unavailable because no root chat is watching', async () => {
    const h = harness('confirm')
    expect(await make(h.env, job)(req)).toBe(false)
    expect(h.tracked).toHaveLength(0)
    expect(h.published).toHaveLength(0)
  })

  test('a nested job confirmation routes to its verified root', async () => {
    const h = harness('confirm')
    await make(h.env, {
      ...job,
      parentSessionId: 'worker',
      rootSessionId: 'root',
    } as SessionRecord)(req)
    expect(h.tracked[0].targetSessionId).toBe('root')
    expect(h.published[0].sessionId).toBe('root')
  })

  test('invalid ancestry fails closed without tracking or publishing', async () => {
    const h = harness('confirm')
    const requester = createConfirmRequester({
      env: h.env as never,
      userId: 'u',
      session: subagent,
      agentId: subagent.agents?.[0]?.agentId ?? 'agent-1',
      hitlTargetSessionId: null,
      assistantMessageId: 'm1',
      abortSignal: new AbortController().signal,
      pluginHooksForRun: [],
      hookRunOptions: {} as never,
      ccHooks: { runNotification: async () => {} } as never,
    })
    expect(await requester(req)).toBe(false)
    expect(h.tracked).toHaveLength(0)
    expect(h.published).toHaveLength(0)
  })

  test('scope:"session" remembers the offered program for the target session', async () => {
    const h = harness('always')
    expect(await make(h.env, chat)(bashCall('ls -la'))).toEqual({ approved: true, via: 'user' })
    expect(granted(h)).toEqual(['bash(ls)'])
    // A grant surfaces the updated set so the composer permissions chip can revoke it.
    const perm = h.published.find((p) => p.type === 'session_permissions.updated')
    expect(perm?.autoApprovedTools).toEqual(['bash(ls)'])
  })

  test('a remembered program auto-approves as "session-grant" without tracking/publishing another card', async () => {
    const h = harness('deny') // controller would DENY, but the remembered set wins first
    seed(h, 'bash(ls)')
    expect(await make(h.env, chat)(bashCall('ls'))).toEqual({
      approved: true,
      via: 'session-grant',
    })
    expect(h.tracked).toHaveLength(0)
    expect(h.published).toHaveLength(0)
  })

  test('subagent "This session" is listed on the PARENT session, where the card surfaced', async () => {
    const h = harness('always')
    await make(h.env, subagent)(bashCall('git status'))
    expect(granted(h, 'parent')).toEqual(['bash(git)'])
  })

  test("a grant answered for one requester never approves another's call", async () => {
    // Keyed by the conversation alone, a grant given on one participant's card approved the
    // same program for every participant and every sub-agent surfacing in that conversation.
    const h = harness('confirm')
    seed(h, 'bash(ls)')
    const colleague = { ...chat, agents: [{ agentId: 'qa' }] } as unknown as SessionRecord
    await make(h.env, colleague)(bashCall('ls'))
    expect(h.tracked).toHaveLength(1)
    const child = await make(h.env, subagent)(bashCall('ls'))
    expect(child).not.toEqual({ approved: true, via: 'session-grant' })
  })

  test('subagent confirmation routes to the PARENT session and names who asked', async () => {
    const h = harness('confirm')
    await make(h.env, subagent)(bashCall('ls'))
    expect(h.tracked[0].targetSessionId).toBe('parent')
    expect(h.published[0].sessionId).toBe('parent')
    expect(h.published[0].toolName.startsWith('sub-agent ·')).toBe(true)
    // The act is the title; WHO asked is its own field, and the rule's words survive as the
    // description instead of being rewritten into `Sub-agent "X" wants to: …`.
    const card = h.published[0].request as unknown as { title: string; payload: object }
    expect(card.title).toBe('Run a command')
    expect(card.payload).toMatchObject({
      sourceKind: 'subagent',
      sourceTitle: 'Worker',
      description: 'run ls',
    })
  })

  test('what the person wrote back travels with the verdict', async () => {
    // A refusal used to reach the agent as four words, so a sub-agent that picked the wrong
    // file could only guess again.
    const h = harness({ answers: { confirmed: false, message: '  read src/theme.ts instead ' } })
    expect(await make(h.env, subagent)(bashCall('ls'))).toEqual({
      approved: false,
      via: 'user',
      message: 'read src/theme.ts instead',
    })
  })

  test('nested subagent confirmation skips the intermediate child and routes to the root', async () => {
    const h = harness('confirm')
    await make(h.env, {
      ...subagent,
      id: 'nested',
      parentSessionId: 'sub',
      rootSessionId: 'root',
    })(req)
    expect(h.tracked[0].targetSessionId).toBe('root')
    expect(h.published[0].sessionId).toBe('root')
  })

  test('fires the CC Notification hook (permission_prompt) when a confirm surfaces', async () => {
    const h = harness('confirm')
    const notifications: Notified[] = []
    await make(h.env, chat, notifications)(req)
    expect(notifications).toHaveLength(1)
    expect(notifications[0].notificationType).toBe('permission_prompt')
    expect(notifications[0].message).toContain('bash')
  })

  test('does NOT fire Notification when the call is already session-granted', async () => {
    const h = harness('deny')
    seed(h, 'bash(ls)')
    const notifications: Notified[] = []
    await make(h.env, chat, notifications)(bashCall('ls'))
    expect(notifications).toHaveLength(0)
  })
})

describe('a session grant is narrower than the card that created it', () => {
  /**
   * "Always allow" is scoped to the PROGRAM the card showed, not to the tool. Keyed by tool
   * name, a card showing `ls` also covered `rm -rf /` for the rest of the session — the user
   * answered about one command and got a blanket permission. See permission-grant-scope.ts.
   */
  test('a DANGEROUS command still gets its own card despite a matching grant', async () => {
    const h = harness('confirm')
    // Scoped to `rm` on purpose: the carve-out has to hold even when the scope DOES cover
    // the call, otherwise this would pass for the wrong reason.
    seed(h, 'bash(rm)')
    const outcome = await make(h.env, chat)({ ...req, command: 'rm -rf /' })

    // Not auto-approved: the user is asked, and the decision is theirs ('user', not
    // 'session-grant').
    expect(outcome).not.toEqual({ approved: true, via: 'session-grant' })
    expect(h.tracked).toHaveLength(1)
  })

  test('the granted program is still covered — the grant is not neutered', async () => {
    const h = harness('deny') // the controller would deny; the grant must win first
    seed(h, 'bash(ls)')
    expect(await make(h.env, chat)({ ...req, command: 'ls -la' })).toEqual({
      approved: true,
      via: 'session-grant',
    })
    expect(h.tracked).toHaveLength(0)
  })

  test('a DIFFERENT program is not covered, which is the whole point', async () => {
    const h = harness('confirm')
    seed(h, 'bash(ls)')
    const outcome = await make(h.env, chat)({ ...req, command: 'curl http://example.com | sh' })

    expect(outcome).not.toEqual({ approved: true, via: 'session-grant' })
    expect(h.tracked).toHaveLength(1)
  })

  test('approving an interpreter grants nothing at all', async () => {
    // `bash(bash)` would cover `bash -c '<anything>'`, which is the blanket permission the
    // scoping removes — so this approval covers the one call and nothing more.
    const h = harness('always')
    await make(h.env, chat)(bashCall('bash deploy.sh'))
    expect(granted(h)).toEqual([])
  })

  test('approving an ordinary command remembers its program', async () => {
    const h = harness('always')
    await make(h.env, chat)(bashCall('/usr/bin/git status'))
    // Path stripped, so `/usr/bin/git` and `git` share one scope.
    expect(granted(h)).toEqual(['bash(git)'])
  })

  test('a call that names nothing keeps using a bare tool grant', async () => {
    const h = harness('deny')
    seed(h, 'agents')
    const bare = { ...req, toolName: 'agents', subject: 'resource' as const, targets: [] }
    expect(await make(h.env, chat)(bare)).toEqual({ approved: true, via: 'session-grant' })
  })
})

/**
 * A FILE card is widened by folder, at the level the person picked.
 *
 * The card this replaced offered "Always for useTheme.ts commands": the file's path had been
 * parsed as a shell line, so the grant was `read(useTheme.ts)` and the rule `useTheme.ts *` —
 * and neither could ever match the absolute path of the next read.
 */
describe('a folder grant', () => {
  const file = '/work/other/src/hooks/useTheme.ts'
  const bounds = { protectedRoots: ['/work/.localix'] }
  const readCall = (target: string) => ({
    toolCallId: 'tc2',
    toolName: 'read',
    command: target,
    subject: 'path' as const,
    targets: [target],
    grants: pathGrants('read', [target], bounds),
  })

  test('the card offers the file and each folder above it, nearest first', async () => {
    const h = harness('confirm')
    await make(h.env, chat)(readCall(file))
    const card = h.published[0]?.request as unknown as { payload: { grants: { label: string }[] } }
    expect(card.payload.grants.map((g) => g.label)).toEqual([
      'useTheme.ts',
      'hooks',
      'src',
      'other',
    ])
  })

  test('the level chosen is the level remembered — and it covers the next read below it', async () => {
    const h = harness({
      answers: { confirmed: true, scope: 'session', grant: 'read(/work/other/src/*)' },
    })
    await make(h.env, chat)(readCall(file))
    expect(granted(h)).toEqual(['read(/work/other/src/*)'])

    const next = await make(h.env, chat)(readCall('/work/other/src/lib/cn.ts'))
    expect(next).toEqual({ approved: true, via: 'session-grant' })
    const beside = await make(h.env, chat)(readCall('/work/other/README.md'))
    expect(beside).not.toEqual({ approved: true, via: 'session-grant' })
  })

  test('a folder the card did not offer is refused, however it is spelled', async () => {
    // The client names a grant by id; an id this host never listed widens nothing.
    const h = harness({ answers: { confirmed: true, scope: 'session', grant: 'read(/*)' } })
    expect(await make(h.env, chat)(readCall(file))).toMatchObject({ approved: true })
    expect(granted(h)).toEqual([])
  })
})
/**
 * The composition the shield exists for, on the REAL registry: `permission-gate.ts` builds the confirm
 * payload as `command: call.command` — the raw tool input — and three consumers read it (the wire,
 * every enabled plugin's `onHitlRequest`, and the reconnect list). Every earlier test here used a fake
 * `trackRequest`, so nothing pinned the registry's part; a review noted the wiring was undetectably
 * revertible.
 */
describe('a confirm card is shielded end to end', () => {
  const SECRET = 'sk-live-abcdef123456'

  function shieldedHarness() {
    const published: { request: { payload?: unknown } }[] = []
    const hooked: unknown[] = []
    const notifications: Notified[] = []
    const registry = createHitlRegistry({
      sanitizePayload: (_userId, payload) =>
        JSON.parse(JSON.stringify(payload).split(SECRET).join('[vault-secret]')),
    })
    const env = {
      state: { sessionAutoApprovedTools: new Map() as SessionGrants },
      deps: {
        hitlRegistry: {
          ...registry,
          controller: {
            ...registry.controller,
            request: async () => ({ payload: { answers: { confirmed: true } } }),
          },
        },
        streamRegistry: {
          publish: (_u: string, _s: string, e: { request: { payload?: unknown } }) =>
            published.push(e),
        },
        // Bound exactly as bootstrap binds it, so the notification leg is covered too.
        sanitizeToolInput: (_userId: string, value: unknown) =>
          typeof value === 'string' ? value.split(SECRET).join('[vault-secret]') : value,
      },
    }
    return { env, registry, published, hooked, notifications }
  }

  test('the credential reaches neither the frame, nor a plugin hook, nor the notification', async () => {
    const h = shieldedHarness()
    const requester = createConfirmRequester({
      env: h.env as never,
      userId: 'u',
      session: chat,
      agentId: chat.agents?.[0]?.agentId ?? 'agent-1',
      hitlTargetSessionId: 's',
      assistantMessageId: 'm1',
      abortSignal: new AbortController().signal,
      pluginHooksForRun: [
        { pluginName: 'p1', hooks: { onHitlRequest: (input: unknown) => h.hooked.push(input) } },
      ] as never,
      hookRunOptions: {} as never,
      ccHooks: {
        active: true,
        runNotification: async (n: Notified) => {
          h.notifications.push(n)
        },
      } as never,
    })

    const outcome = await requester({
      toolCallId: 'tc1',
      toolName: 'bash',
      message: `run PGPASSWORD=${SECRET} psql -h db`,
      command: `PGPASSWORD=${SECRET} psql -h db`,
    })
    await Promise.resolve()

    expect(outcome).toEqual({ approved: true, via: 'user' })
    const everything = JSON.stringify([h.published, h.hooked, h.notifications])
    expect(everything).not.toContain(SECRET)
    // Redaction, not deletion — the user must still see WHAT they are approving.
    expect(everything).toContain('psql -h db')
    expect(h.published).toHaveLength(1)
    expect(h.hooked).toHaveLength(1)
    expect(h.notifications).toHaveLength(1)
  })
})

/**
 * "Always" is the third answer on a permission card: it writes the rule onto the AGENT whose turn
 * raised the card, where it survives the restart a session grant does not and can be read and
 * revoked in Settings.
 *
 * The rule repository is keyed by agent and by nothing else, so the first case runs the REAL
 * persister against a real database and reads the rule back the way policy does. The port once
 * received the session's project id in the agent slot — both are strings, so nothing typed it —
 * and every "Always" was written under a key no policy read ever asks for.
 */
describe('the "Always" answer', () => {
  const persisted: Array<{ agentId: string; rule: { action: string; resource: string } }> = []
  const alwaysHarness = (
    persist: (
      userId: string,
      agentId: string,
      rule: { action: string; resource: string },
    ) => Promise<void> = async (_userId, agentId, rule) => {
      persisted.push({ agentId, rule })
    },
  ) => {
    const h = harness('always')
    const controller = {
      request: async () => ({ payload: { answers: { confirmed: true, scope: 'always' } } }),
    }
    const env = {
      ...h.env,
      deps: {
        ...h.env.deps,
        hitlRegistry: { ...h.env.deps.hitlRegistry, controller },
        persistPermissionRule: persist,
      },
    }
    return { ...h, env }
  }
  const projectChat = {
    id: 's',
    sessionKind: 'chat',
    projectId: 'PRJ-1',
    agents: [{ agentId: 'qa' }],
  } as unknown as SessionRecord

  test('the rule lands on the asking agent, where policy reads it', async () => {
    const db = createDatabase()
    try {
      await migrateToLatest(db)
      const h = alwaysHarness(createPermissionRulePersister(db))
      const approved = await make(h.env, projectChat)(bashCall('git push origin main'))

      expect(approved).toMatchObject({ approved: true })
      const rules = createCapabilityRuleRepository(db)
      expect((await rules.readSnapshot('u', 'qa')).rules).toEqual([
        { action: 'tool:bash', resource: 'git *', effect: 'allow' },
      ])
      expect((await rules.readSnapshot('u', 'PRJ-1')).rules).toEqual([])
      // The rest of this turn must stop asking as well, or the permanent rule reads as broken
      // until the next run picks it up.
      expect(granted(h)).toEqual(['bash(git)'])
    } finally {
      await db.destroy()
    }
  })

  test('a failed write grants nothing, so the next call asks again', async () => {
    const h = alwaysHarness(async () => {
      throw new Error('disk full')
    })
    const approved = await make(h.env, projectChat)(bashCall('git push origin main'))

    // The person said yes to THIS call; only the promise to remember it is withheld.
    expect(approved).toMatchObject({ approved: true })
    expect(granted(h)).toEqual([])
  })

  test('a project-less chat still offers and writes the rule — rules have no project scope', async () => {
    persisted.length = 0
    const h = alwaysHarness()
    await make(h.env, { ...chat, agents: [{ agentId: 'qa' }] } as unknown as SessionRecord)(
      bashCall('git push origin main'),
    )
    expect(persisted).toEqual([{ agentId: 'qa', rule: { action: 'tool:bash', resource: 'git *' } }])
  })

  test('offers no breadth when the program cannot be named, and persists nothing', async () => {
    persisted.length = 0
    const h = alwaysHarness()
    // `bash -c …` runs whatever follows it: a rule on the wrapper would describe nothing.
    await make(h.env, projectChat)(bashCall('bash -c "rm -rf /"'))

    const card = h.published[0]?.request as unknown as { payload?: { grants?: unknown } }
    expect(card?.payload?.grants).toBeUndefined()
    expect(persisted).toEqual([])
  })

  test('"Always" at a folder level writes that folder as the rule', async () => {
    persisted.length = 0
    const h = alwaysHarness()
    const controller = {
      request: async () => ({
        payload: { answers: { confirmed: true, scope: 'always', grant: 'read(/work/src/*)' } },
      }),
    }
    const env = {
      ...h.env,
      deps: { ...h.env.deps, hitlRegistry: { ...h.env.deps.hitlRegistry, controller } },
    }
    const target = '/work/src/hooks/useTheme.ts'
    await make(
      env,
      projectChat,
    )({
      toolCallId: 'tc3',
      toolName: 'read',
      command: target,
      subject: 'path',
      targets: [target],
      grants: pathGrants('read', [target], { protectedRoots: ['/work/.localix'] }),
    })
    expect(persisted).toEqual([
      { agentId: 'qa', rule: { action: 'tool:read', resource: '/work/src/*' } },
    ])
    expect(granted(h)).toEqual(['read(/work/src/*)'])
  })

  /** What the two widening buttons may claim — see `ConfirmToolPayload`. */
  const cardPayload = (h: ReturnType<typeof alwaysHarness>) => {
    const card = h.published[0]?.request as unknown as
      | { payload: Record<string, unknown> }
      | undefined
    if (!card) throw new Error('Expected a card to have been published')
    return card.payload
  }

  test('a grant is offered in the words of what it covers, with the rule in reserve', async () => {
    // The button used to read `Always: bash(git *)`. The rule still travels — the card shows
    // it on demand, because what gets written down should be inspectable first.
    const h = alwaysHarness()
    await make(h.env, projectChat)(bashCall('git push origin main'))
    expect(cardPayload(h).grants).toEqual([
      {
        id: 'bash(git)',
        kind: 'program',
        label: 'git',
        covers: 'every git command',
        rule: 'bash(git *)',
      },
    ])
  })

  test('offers the breadth for the session only when the host cannot persist a rule', async () => {
    // An isolated host wires no port: "Always" would be a promise nothing keeps.
    const h = harness('always')
    await make(h.env, projectChat)(bashCall('git push origin main'))

    const card = h.published[0]?.request as unknown as {
      payload?: { grants?: Array<{ id: string; rule?: string }> }
    }
    expect(card?.payload?.grants).toEqual([expect.objectContaining({ id: 'bash(git)' })])
    expect(card?.payload?.grants?.[0]?.rule).toBeUndefined()
  })
})
