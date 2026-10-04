import { afterEach, describe, expect, test } from 'bun:test'

import { MONITOR_MAX_PER_SESSION, type MonitorSpec } from './contracts'
import { monitorHarness, settle } from './test-harness'

type Harness = Awaited<ReturnType<typeof monitorHarness>>
let h: Harness
afterEach(() => h?.close())

const watch = (over: Partial<MonitorSpec> = {}): MonitorSpec => ({
  description: 'CI 402356',
  cwd: '/tmp',
  watch: 'tail -f run.log',
  timeoutMs: 300_000,
  ...over,
})
const until = (over: Partial<NonNullable<MonitorSpec['until']>> = {}): MonitorSpec => ({
  description: 'pipeline',
  cwd: '/tmp',
  until: {
    check: 'status.sh',
    everySeconds: 30,
    when: { kind: 'regex', value: 'success|failed' },
    emit: 'once',
    ...over,
  },
  timeoutMs: 300_000,
})
const stored = (id: string) =>
  h.db.selectFrom('triggers').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
const onlyTrigger = () => h.engine.list({ userId: 'u1', action: 'monitor' })[0]!

describe('a polled wait (`until`)', () => {
  test('polls at once, and a met condition ends it with ONE wake keyed by its fire', async () => {
    h = await monitorHarness({ samples: [{ stdout: 'build: success' }] })
    const started = await h.start(until())
    expect(started).toEqual({ ok: true, id: 'mon-1', label: 'pipeline' })
    const trigger = onlyTrigger()
    expect(trigger).toMatchObject({ kind: 'poll', owner: { kind: 'agent', agentId: 'lead' } })

    await h.poll()
    expect(h.checks).toEqual(['status.sh'])
    expect(h.wakes).toHaveLength(1)
    expect(h.wakes[0]).toMatchObject({
      sessionId: 's1',
      source: 'bg-monitor',
      deliveryKey: `trg:${trigger.id}:1`,
      // The participant that started it answers.
      to: { participant: 'agent:lead' },
    })
    expect(h.wakes[0]!.content).toContain('[Monitor mon-1 ended: pipeline] the condition was met')
    expect(h.wakes[0]!.content).toContain('success')
    expect(await stored(trigger.id)).toMatchObject({ state: 'ended', end_reason: 'condition-met' })
  })

  test('quiet polls wake nothing; what a poll saw is counted on the WORK record', async () => {
    h = await monitorHarness({ samples: [{ stdout: 'running' }, { stdout: 'deploying' }] })
    const toolCallId = 'tc-1'
    await h.start(until({ emit: 'on_change', when: { kind: 'contains', value: 'done' } }), {
      toolCallId,
    })
    await h.poll()
    expect(h.wakes).toEqual([])
    h.clock.ms += 30_000
    await h.poll()
    expect(h.wakes).toHaveLength(1)
    expect(h.wakes[0]!.content).toContain('Still watching')
    expect(h.work.get(toolCallId)).toMatchObject({ eventCount: 1, lastEvent: 'deploying' })
  })

  test('its deadline ends it ON time and DOES wake — silence would read as still waiting', async () => {
    h = await monitorHarness({ samples: [{ stdout: 'running' }] })
    await h.start({ ...until(), timeoutMs: 45_000 })
    await h.poll()
    h.clock.ms += 30_000
    await h.poll()
    h.clock.ms += 15_000
    await h.poll()
    expect(h.checks).toHaveLength(2)
    expect(h.wakes.at(-1)!.content).toContain('reached its timeout')
  })

  test('a restart RESUMES it: the work stays running, and the next poll reports into it', async () => {
    h = await monitorHarness({ samples: [{ stdout: 'running' }, { stdout: 'failed' }] })
    await h.start(until(), { toolCallId: 'tc-9' })
    await h.poll()
    const lost = await h.restart()
    expect(lost).toEqual([])
    expect(h.work.get('tc-9')).toMatchObject({ displayId: 'mon-1', status: 'running' })

    h.clock.ms += 30_000
    await h.poll()
    expect(h.wakes.at(-1)!.content).toContain('[Monitor mon-1 ended')
    // No card writer survived the restart, so the ending settles the work and its item itself.
    expect(
      h.settled.map(({ record, reason }) => [record.toolCallId, record.status, reason]),
    ).toEqual([['tc-9', 'succeeded', 'condition-met']])
  })

  test('a check that cannot run ends the wait on the first poll', async () => {
    h = await monitorHarness({ samples: [{ exitCode: 127, stderr: 'gh: command not found' }] })
    await h.start(until())
    await h.poll()
    expect(h.wakes[0]!.content).toContain('it failed to run')
    expect(h.wakes[0]!.content).toContain('127')
  })
})

describe('a watch', () => {
  test('an event wakes with the lines, the id and what to do next', async () => {
    h = await monitorHarness()
    await h.start(watch(), { toolCallId: 'tc-w' })
    h.sources[0]!.event('test: failed')
    await settle()
    expect(h.wakes).toHaveLength(1)
    const content = h.wakes[0]!.content
    expect(content).toContain('mon-1')
    expect(content).toContain('CI 402356')
    expect(content).toContain('test: failed')
    // The turn must not read as "go poll me".
    expect(content).toContain('END your turn')
    expect(h.work.get('tc-w')).toMatchObject({ eventCount: 1, lastEvent: 'test: failed' })
  })

  test('its ending carries the final events in ONE wake, and ends the trigger', async () => {
    h = await monitorHarness()
    await h.start(watch())
    h.sources[0]!.end({ reason: 'exited', detail: 'exit 1' })
    await settle()
    expect(h.wakes).toHaveLength(1)
    expect(h.wakes[0]!.content).toContain('the watched command exited')
    expect(h.wakes[0]!.content).toContain('nothing will wake you for it again')
    expect(h.engine.list({ userId: 'u1' })).toEqual([])
  })

  test('a restart ENDS it — the process died — and tells the owner once', async () => {
    h = await monitorHarness()
    await h.start(watch(), { toolCallId: 'tc-r' })
    const lost = await h.restart()
    expect(lost.map((record) => [record.toolCallId, record.status])).toEqual([['tc-r', 'lost']])
    expect(h.wakes).toHaveLength(1)
    expect(h.wakes[0]!.content).toContain('the server restarted')
  })
})

describe('the service', () => {
  test('ids are per SESSION, and a label names the credential a watch uses', async () => {
    h = await monitorHarness({ resolveSecret: async () => 'tok' })
    expect(await h.start(watch())).toMatchObject({ ok: true, id: 'mon-1' })
    expect(await h.start(watch(), { sessionId: 's2' })).toMatchObject({ ok: true, id: 'mon-1' })
    expect(
      await h.start(watch({ watch: 'tail -f ${secret:MSGR_TOKEN}.log', description: 'authed' })),
    ).toEqual({ ok: true, id: 'mon-2', label: 'authed · uses Vault: MSGR_TOKEN' })
  })

  test('a monitor the USER stopped does not wake the agent', async () => {
    // The user is right there; waking the agent to tell it what they just did is noise.
    h = await monitorHarness()
    await h.start(watch())
    const trigger = onlyTrigger()
    expect(h.service.stop('u1', 's1', 'mon-1')).toBe(true)
    await settle()
    expect(h.sources[0]!.isClosed()).toBe(true)
    expect(h.wakes).toEqual([])
    expect(await stored(trigger.id)).toMatchObject({ state: 'ended', end_reason: 'killed' })
    // Idempotent: a second stop reports "nothing to stop" rather than ending it twice.
    expect(h.service.stop('u1', 's1', 'mon-1')).toBe(false)
  })

  test('the per-session cap refuses a new monitor and names the ones already running', async () => {
    h = await monitorHarness()
    for (let i = 0; i < MONITOR_MAX_PER_SESSION; i += 1)
      expect((await h.start(watch({ description: `watch ${i}` }))).ok).toBe(true)
    const refused = await h.start(watch({ description: 'one too many' }))
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error).toContain('mon-1')
      expect(refused.error).toContain('jobs action="stop"')
    }
    // A stopped monitor frees its slot.
    h.service.stop('u1', 's1', 'mon-1')
    await settle()
    expect((await h.start(watch({ description: 'now fits' }))).ok).toBe(true)
  })

  test('an unusable spec is refused at start rather than watching nothing', async () => {
    h = await monitorHarness()
    const badRegex = await h.start(until({ when: { kind: 'regex', value: '([' } }))
    expect(badRegex.ok).toBe(false)
    if (!badRegex.ok) expect(badRegex.error).toContain('Invalid regex')
    expect((await h.start(watch({ watch: undefined }))).ok).toBe(false)
    expect(h.engine.list({ userId: 'u1' })).toEqual([])
  })

  test('read returns the event log; every accessor is scoped to the OWNER', async () => {
    h = await monitorHarness()
    await h.start(watch())
    h.sources[0]!.event('line one')
    h.sources[0]!.event('line two')
    await settle()
    expect(h.service.read('u1', 's1', 'mon-1')?.text).toContain('line two')
    // `mon-1` is model-facing, so it is guessable.
    expect(h.service.read('u2', 's1', 'mon-1')).toBeNull()
    expect(h.service.stop('u2', 's1', 'mon-1')).toBe(false)
    expect(h.sources[0]!.isClosed()).toBe(false)
  })

  test('a deleted session takes its watches with it; shutdown kills every live one', async () => {
    h = await monitorHarness()
    await h.start(watch())
    await h.start(watch(), { sessionId: 's2' })
    h.service.stopAllForSession('s1')
    expect(h.sources.map((s) => s.isClosed())).toEqual([true, false])
    h.service.disposeAll()
    expect(h.sources[1]!.isClosed()).toBe(true)
    // Shutdown leaves the trigger for the next boot, which ends it and tells the owner.
    expect(h.engine.list({ userId: 'u1', sessionId: 's2' })).toHaveLength(1)
  })
})

describe('vault references', () => {
  const vault = { MSGR_TOKEN: 'tok-abc-123' }
  const redact = (_userId: string, text: string) =>
    text.split(vault.MSGR_TOKEN).join('[vault-secret]')
  const authed = (
    over: Partial<MonitorSpec> = {},
    poll: Partial<NonNullable<MonitorSpec['until']>> = {},
  ): MonitorSpec => ({
    ...until({
      check: 'curl -sf -H "Authorization: Bearer ${secret:MSGR_TOKEN}" https://msgr/api',
      when: { kind: 'contains', value: 'members' },
      ...poll,
    }),
    ...over,
  })

  test('the payload keeps the reference, never the value; the resolve names the MONITOR', async () => {
    const resolved: string[] = []
    h = await monitorHarness({
      resolveSecret: async (_userId, key, monitorId) => {
        resolved.push(`${key}@${monitorId}`)
        return vault.MSGR_TOKEN
      },
      samples: [{ stdout: 'running' }],
    })
    await h.start(authed())
    await h.poll()
    expect(JSON.stringify(onlyTrigger().payload)).toContain('${secret:MSGR_TOKEN}')
    expect(JSON.stringify(onlyTrigger().payload)).not.toContain(vault.MSGR_TOKEN)
    // Resolved once at start, not once per poll: each resolve is an audit entry.
    expect(resolved).toEqual(['MSGR_TOKEN@mon-1'])
    expect(h.checks[0]).not.toContain(vault.MSGR_TOKEN)
  })

  test('a missing key, or no vault at all, refuses the START and says why', async () => {
    h = await monitorHarness()
    const missing = await h.start(authed())
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('vault action:"create"')
    await h.close()
    h = await monitorHarness({ noVault: true })
    const none = await h.start(authed())
    if (!none.ok) expect(none.error).toContain('vault is unavailable')
    expect(none.ok).toBe(false)
  })

  test('a PERSISTENT watch may not hold a secret for the whole session', async () => {
    h = await monitorHarness({ resolveSecret: async () => 'tok' })
    const refused = await h.start(watch({ timeoutMs: null, watch: 'tail -f ${secret:MSGR_TOKEN}' }))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('persistent')
    expect((await h.start(authed({ timeoutMs: null }))).ok).toBe(true)
  })

  test('a value echoed back is redacted before it becomes a wake, a log or the work row', async () => {
    h = await monitorHarness({
      resolveSecret: async () => vault.MSGR_TOKEN,
      shield: redact,
      samples: [{ stdout: 'members: 12, auth tok-abc-123' }],
    })
    await h.start(authed({}, { emit: 'every' }), { toolCallId: 'tc-s' })
    await h.poll()
    expect(h.wakes[0]!.content).not.toContain(vault.MSGR_TOKEN)
    expect(h.wakes[0]!.content).toContain('[vault-secret]')
    expect(h.service.read('u1', 's1', 'mon-1')?.text).not.toContain(vault.MSGR_TOKEN)
    expect(h.work.get('tc-s')?.lastEvent).not.toContain(vault.MSGR_TOKEN)
    // The poll state kept on the row, for the next poll to diff against, carries no output.
    expect(JSON.stringify(h.engine.list({ userId: 'u1' })[0]!.payload)).not.toContain(
      vault.MSGR_TOKEN,
    )
  })

  test("an ending's own detail is redacted too", async () => {
    h = await monitorHarness({ resolveSecret: async () => vault.MSGR_TOKEN, shield: redact })
    await h.start(watch({ watch: 'tail -f ${secret:MSGR_TOKEN}' }))
    h.sources[0]!.end({ reason: 'error', detail: 'token tok-abc-123 rejected' })
    await settle()
    expect(h.wakes.at(-1)!.content).not.toContain(vault.MSGR_TOKEN)
  })
})
