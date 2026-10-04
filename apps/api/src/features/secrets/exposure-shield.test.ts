import { describe, expect, test } from 'bun:test'

import { createSecretExposureShield, isRedactableSecret } from './exposure-shield'

/**
 * The floor exists because exact-substring redaction has no lower bound of its own. Every case
 * below was MEASURED against this shield before the gate was added — none is hypothetical — and
 * each is reachable input: provider credential fields validate as `z.string().min(1)`, and the
 * values a local-provider setup puts there are exactly these words.
 */
describe('a value too short to redact is not registered at all', () => {
  const corrupted: [string, string, string][] = [
    ['ollama', 'curl http://localhost:11434/api/tags # ollama', 'the key local providers require'],
    ['local', 'cd /Users/x/local/project', 'a path segment'],
    ['none', 'git commit -m "none of the tests changed"', 'an ordinary English word'],
    ['password', 'grep -rn password src/', 'the word a DB workbench transcript is full of'],
    [' ', 'a b c', 'every space in the text'],
  ]
  for (const [value, text, why] of corrupted) {
    test(`${JSON.stringify(value)} would have eaten ${why}`, () => {
      const shield = createSecretExposureShield()
      shield.remember('u1', value)
      expect(shield.redactText('u1', text)).toBe(text)
      expect(isRedactableSecret(value)).toBe(false)
    })
  }

  test('a real credential is still registered, and the boundary is exact', () => {
    expect(isRedactableSecret('sk-live-abcdef123456')).toBe(true)
    expect(isRedactableSecret('a'.repeat(12))).toBe(true)
    expect(isRedactableSecret('a'.repeat(11))).toBe(false)
    // Padding is not length: a short value wrapped in whitespace is still short.
    expect(isRedactableSecret(`   ${'a'.repeat(8)}   `)).toBe(false)
  })

  test('an all-lowercase passphrase is protected — the gate is length, not shape', () => {
    // A character-class rule would refuse this, which is the wrong trade: at 25 chars it cannot
    // collide with transcript text, and it is a real secret.
    const shield = createSecretExposureShield()
    shield.remember('u1', 'correcthorsebatterystaple')
    expect(shield.redactText('u1', 'echo correcthorsebatterystaple')).toBe('echo [vault-secret]')
  })
})

describe('Vault exposure shield', () => {
  test('redacts exact plaintext and common wire encodings from every result surface', () => {
    const shield = createSecretExposureShield()
    const secret = 'wallet seed phrase sentinel'
    shield.remember('alice', secret)

    const result = shield.redactResult('alice', {
      content: `body=${secret}`,
      details: {
        echoed: encodeURIComponent(secret),
        nested: [Buffer.from(secret).toString('base64')],
      },
    })

    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain(encodeURIComponent(secret))
    expect(JSON.stringify(result)).not.toContain(Buffer.from(secret).toString('base64'))
    expect(JSON.stringify(result)).toContain('[vault-secret]')
  })

  test('keeps values isolated by owner and scrubs thrown errors', () => {
    const shield = createSecretExposureShield()
    shield.remember('alice', 'alice-private-value')

    expect(shield.redactText('bob', 'alice-private-value')).toBe('alice-private-value')
    const error = shield.redactError('alice', new Error('upstream echoed alice-private-value'))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('upstream echoed [vault-secret]')
  })
})

describe('redactValue — a tool call ARGUMENTS and progress boundary', () => {
  test('redacts a credential inline in a command, at any depth', () => {
    // The gap this closes: results and errors passed the shield from the start, arguments
    // never did — so a bash invocation carrying an inline key was persisted into `agent_messages`
    // verbatim and streamed to every connected client.
    const shield = createSecretExposureShield()
    shield.remember('u1', 'sk-live-abc123')
    const shown = shield.redactValue('u1', {
      command: 'curl -H "X-Api-Key: sk-live-abc123" https://api.example.com',
      env: { nested: { deeper: 'sk-live-abc123' } },
      commands: ['echo sk-live-abc123'],
    }) as { command: string; env: { nested: { deeper: string } }; commands: string[] }
    expect(shown.command).not.toContain('sk-live-abc123')
    expect(shown.env.nested.deeper).not.toContain('sk-live-abc123')
    expect(shown.commands[0]).not.toContain('sk-live-abc123')
    // The surrounding command text survives — this is redaction, not deletion.
    expect(shown.command).toContain('https://api.example.com')
  })

  test('leaves a value with no remembered secret byte-identical', () => {
    const shield = createSecretExposureShield()
    const input = { command: 'ls -la', args: [1, 2, null, true] }
    expect(JSON.stringify(shield.redactValue('u1', input))).toBe(JSON.stringify(input))
  })

  test('is per-user: one user’s secret is not redacted from another’s args', () => {
    const shield = createSecretExposureShield()
    // Long enough to be registered at all — with a 5-char value this test passed for the wrong
    // reason (nothing was registered for EITHER user, so isolation was never exercised).
    shield.remember('u1', 'sk-u1-live-abcdef')
    const u1 = shield.redactValue('u1', { command: 'echo sk-u1-live-abcdef' }) as {
      command: string
    }
    expect(u1.command).not.toContain('sk-u1-live-abcdef')
    const other = shield.redactValue('u2', { command: 'echo sk-u1-live-abcdef' }) as {
      command: string
    }
    expect(other.command).toBe('echo sk-u1-live-abcdef')
  })

  test('a non-plain object is returned as-is rather than flattened', () => {
    // Same rule the result redactor follows: rebuilding a class instance would lose its identity.
    const shield = createSecretExposureShield()
    shield.remember('u1', 'sk-live-abc123')
    const date = new Date(0)
    expect(shield.redactValue('u1', date)).toBe(date)
  })
})

/**
 * THE SHIELD MUST NOT REWRITE DATA THAT IS NOT A SECRET.
 *
 * `redactValue` is not presentation-only: the shielded copy is what gets persisted, and
 * `itemsToWireMessages` rebuilds the next run's `tool_call.arguments` from it — so the model reads
 * this output as its OWN earlier call. A traversal guard that substitutes a STRING for a nested
 * object therefore changes the type of an argument the model already sent, and the same copy feeds
 * the HITL approval card, the run journal and a background job's label.
 *
 * The guard needs to exist — a cyclic object would recurse forever — but it was a bare `depth >= 8`,
 * and 8 is inside the range of ordinary payloads: MCP and plugin tool schemas are supplied by their
 * providers, and a
 * kubernetes manifest reaches `spec.template.spec.containers[].env[].valueFrom.secretKeyRef` at
 * depth 9. Measured for scale: the deepest JSON file tracked in this repo is 7 levels.
 */
describe('redactValue traversal guards do not corrupt real payloads', () => {
  /** `{a:{a:{…: leaf}}}` nested `levels` deep. */
  const nest = (levels: number, leaf: unknown): unknown =>
    levels === 0 ? leaf : { a: nest(levels - 1, leaf) }

  test('a payload nested past the old cap keeps its shape, and is still redacted down there', () => {
    const shield = createSecretExposureShield()
    shield.remember('u1', 'sk-live-abcdef123456')
    // 12 levels: the old cap replaced level 8 with the string '[truncated]', taking levels 9-12
    // with it — including the credential, which was "protected" by deleting the branch.
    const input = nest(12, { token: 'sk-live-abcdef123456', keep: 'https://api.example.com' })
    const shown = shield.redactValue('u1', input)
    expect(JSON.stringify(shown)).not.toContain('[truncated]')
    expect(JSON.stringify(shown)).not.toContain('sk-live-abcdef123456')
    // Shape preserved exactly: same keys, same nesting, only the secret substring rewritten.
    expect(JSON.stringify(shown)).toBe(
      JSON.stringify(nest(12, { token: '[vault-secret]', keep: 'https://api.example.com' })),
    )
  })

  test('a cycle terminates and is marked, rather than being followed forever', () => {
    const shield = createSecretExposureShield()
    shield.remember('u1', 'sk-live-abcdef123456')
    const node: Record<string, unknown> = { token: 'sk-live-abcdef123456' }
    node.self = node
    const shown = shield.redactValue('u1', { root: node }) as {
      root: { token: string; self: unknown }
    }
    // The reachable data is still redacted — the cycle guard must not skip the node's own fields.
    expect(shown.root.token).toBe('[vault-secret]')
    expect(shown.root.self).toBe('[cycle]')
  })

  test('a SHARED reference is not a cycle — both branches are still redacted', () => {
    // Cycle detection has to track the current PATH, not every object ever seen: a payload that
    // mentions the same object twice (a DAG) is ordinary, and a seen-set would mark the second
    // mention as a cycle and drop it.
    const shield = createSecretExposureShield()
    shield.remember('u1', 'sk-live-abcdef123456')
    const shared = { token: 'sk-live-abcdef123456' }
    const shown = shield.redactValue('u1', { left: shared, right: shared }) as {
      left: { token: string }
      right: { token: string }
    }
    expect(shown.left.token).toBe('[vault-secret]')
    expect(shown.right.token).toBe('[vault-secret]')
  })

  test('an exponentially shared structure terminates instead of hanging', () => {
    // The old depth cap bounded total work at 2^8 traversals by accident. Raising the depth limit
    // without a work budget turns a 40-level doubling DAG into 2^40 visits — reachable because
    // `event.details` and a HITL payload are host/plugin-constructed objects, not fresh JSON.
    const shield = createSecretExposureShield()
    let level: unknown = { leaf: true }
    for (let i = 0; i < 40; i++) level = { left: level, right: level }
    const started = Date.now()
    const shown = shield.redactValue('u1', level)
    // Measured: 5ms at the real budget, ~1000ms with the budget raised 250×. The bound has to be
    // tight enough that a later "let's allow deeper payloads" change is caught here, not in prod.
    expect(Date.now() - started).toBeLessThan(250)
    expect(JSON.stringify(shown)).toContain('[truncated]')
  })
})
