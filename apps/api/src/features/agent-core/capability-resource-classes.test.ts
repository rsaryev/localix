import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { CallEffect } from '@localixai/agent/agents'
import {
  RESOURCE_CLASSES,
  matchesResourceClass,
  resourceClassOf,
  type ClassifiedCall,
} from './capability-resource-classes'
import { matchesCapabilityCall } from './capability-call-match'
import { extractCallFacts, resourceOnlyCall } from './permission-facts'
import { trustFallback } from '../ext/trust'

/**
 * A call that answers "no" to every class — built by the REAL builder, never a literal.
 *
 * A hand-written baseline goes stale the day a class is added: the missing field reads as
 * `undefined`, the class quietly answers no, and the test that was supposed to notice passes.
 * The call's class (`effect`, `irreversible`, `needsHuman`) is the one part the builder cannot
 * know — it is the TOOL's answer, not the call's — so it is set to the class that says no to
 * every class question: a read that can be undone and waits on nobody.
 */
const CALL: ClassifiedCall = {
  ...resourceOnlyCall([]),
  effect: 'read',
  irreversible: false,
  needsHuman: false,
}

const EFFECTS = ['read', 'view', 'session', 'files', 'host', 'external'] as const

describe('the one list', () => {
  test('every class the matcher answers is in it, and vice versa', () => {
    // The property that makes this a source of truth rather than a description: a class the
    // engine understands but the list omits is one the editor can never suggest, and a class
    // listed but unmatched is a suggestion that silently does nothing.
    for (const entry of RESOURCE_CLASSES) {
      expect(resourceClassOf(entry.value)).toBe(entry)
    }
    expect(resourceClassOf('git *')).toBeUndefined()
    expect(resourceClassOf('/etc/hosts')).toBeUndefined()
  })

  /**
   * The positive control for the rule above.
   *
   * A guard that only reads the list proves nothing — it would pass if the matcher had a
   * fourth `if` nobody listed. So this reads the matcher's SOURCE and requires every string
   * it compares a resource against to be a class the list declares.
   */
  test('no matcher compares a resource against a name the list does not declare', () => {
    const sources = [
      '../agent-core/capability-call-match.ts',
      '../agent-core/permission-engine.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
    const declared = new Set<string>(RESOURCE_CLASSES.map((entry) => entry.value))
    for (const source of sources) {
      for (const [, literal] of source.matchAll(/(?:pattern|resource)\s*===\s*'([^']+)'/g)) {
        expect({ literal, declared: declared.has(literal) }).toEqual({ literal, declared: true })
      }
    }
  })

  test('a class is offered only where it could mean something', () => {
    const resourceClassesFor = (kind: string) =>
      RESOURCE_CLASSES.filter((entry) => (entry.appliesTo as readonly string[]).includes(kind))
    const toolClasses = resourceClassesFor('tool').map((entry) => entry.value)
    expect(toolClasses).toContain('dangerous')
    expect(toolClasses).toContain('outside-workspace')
    expect(toolClasses).toContain('mutates')
    expect(toolClasses).toContain('irreversible')
    expect(toolClasses).toContain('needs-human')
    for (const effect of EFFECTS) expect(toolClasses).toContain(`effect:${effect}`)
    // A plugin has no call, so a call class on it would be a suggestion that never matches.
    const pluginClasses = resourceClassesFor('plugin').map((entry) => entry.value)
    expect(pluginClasses).not.toContain('dangerous')
    for (const effect of EFFECTS) expect(pluginClasses).not.toContain(`effect:${effect}`)
    // …and an artifact's trust class is meaningless on a tool, which has no provenance.
    expect(toolClasses).not.toContain('untrusted')
  })

  test('every class carries a hint that stands on its own', () => {
    // It is the only thing a reader sees next to the value in the editor.
    for (const entry of RESOURCE_CLASSES) {
      expect(entry.hint.length).toBeGreaterThan(12)
      expect(entry.hint).not.toContain(entry.value)
    }
  })
})

describe('resolving a class', () => {
  test('a call class answers from the call, a trust class does not', () => {
    expect(matchesResourceClass('dangerous', { ...CALL, dangerous: true })).toBe(true)
    expect(matchesResourceClass('dangerous', CALL)).toBe(false)
    expect(matchesResourceClass('outside-workspace', { ...CALL, outsideWorkspace: true })).toBe(
      true,
    )
    expect(matchesResourceClass('mutates', { ...CALL, effect: 'files' })).toBe(true)
    // `undefined`, not `false`: the caller must fall through to pattern matching, because a
    // trust class arrives already resolved as the resource being looked up.
    expect(matchesResourceClass('untrusted', CALL)).toBeUndefined()
    expect(matchesResourceClass('git *', CALL)).toBeUndefined()
  })

  test('the live matcher resolves each class against real call facts', () => {
    const danger = extractCallFacts('bash', { command: 'rm -rf /tmp/x' }, '/repo')
    expect(matchesCapabilityCall('dangerous', 'ask', danger)).toBe(true)
    expect(
      matchesCapabilityCall('dangerous', 'ask', extractCallFacts('bash', { command: 'ls' })),
    ).toBe(false)

    const outside = extractCallFacts('read', { path: '/etc/hosts' }, '/repo')
    expect(matchesCapabilityCall('outside-workspace', 'ask', outside)).toBe(true)

    // The class is the tool's answer, not the call's, so it arrives as the extra argument.
    const write = extractCallFacts('write', { path: '/repo/a.txt' }, '/repo')
    expect(matchesCapabilityCall('mutates', 'ask', write, { effect: 'files' })).toBe(true)
    expect(matchesCapabilityCall('mutates', 'ask', write, { effect: 'read' })).toBe(false)
    // Absent is a caller with no tool in hand — a rule preview — judged as a read.
    expect(matchesCapabilityCall('mutates', 'ask', write)).toBe(false)
    expect(matchesCapabilityCall('effect:files', 'ask', write, { effect: 'files' })).toBe(true)
    expect(
      matchesCapabilityCall('irreversible', 'ask', write, { effect: 'files', irreversible: true }),
    ).toBe(true)
    expect(matchesCapabilityCall('irreversible', 'ask', write, { effect: 'files' })).toBe(false)
    expect(
      matchesCapabilityCall('needs-human', 'deny', write, { effect: 'host', needsHuman: true }),
    ).toBe(true)
    expect(matchesCapabilityCall('needs-human', 'deny', write, { effect: 'host' })).toBe(false)
  })

  test.each([...EFFECTS])('effect:%s matches that effect and no other', (effect: CallEffect) => {
    for (const other of EFFECTS) {
      expect({
        other,
        hit: matchesResourceClass(`effect:${effect}`, { ...CALL, effect: other }),
      }).toEqual({ other, hit: other === effect })
    }
  })

  test.each([...EFFECTS])(
    'mutates is every effect but read and view (%s)',
    (effect: CallEffect) => {
      const durable = effect !== 'read' && effect !== 'view'
      expect(matchesResourceClass('mutates', { ...CALL, effect })).toBe(durable)
    },
  )

  test('irreversible and needs-human answer from their own flag, not from the effect', () => {
    // An external call is not irreversible by being external, nor does it wait on a person:
    // each class is a separate statement the tool makes, so a rule about one never catches
    // the other.
    const external = { ...CALL, effect: 'external' as const }
    expect(matchesResourceClass('irreversible', external)).toBe(false)
    expect(matchesResourceClass('needs-human', external)).toBe(false)
    expect(matchesResourceClass('irreversible', { ...CALL, irreversible: true })).toBe(true)
    expect(matchesResourceClass('needs-human', { ...CALL, needsHuman: true })).toBe(true)
    expect(matchesResourceClass('needs-human', { ...CALL, irreversible: true })).toBe(false)
    expect(matchesResourceClass('irreversible', { ...CALL, needsHuman: true })).toBe(false)
  })

  test('inside-workspace is not the negation of outside-workspace', () => {
    // A call naming NO path at all is neither inside nor outside, and a rule allowing
    // "inside" must not cover it by accident — which a plain `!outsideWorkspace` would.
    const noPaths = extractCallFacts('agents', { action: 'runs' }, '/repo')
    expect(noPaths.paths).toEqual([])
    expect(noPaths.outsideWorkspace).toBe(false)
    expect(matchesCapabilityCall('inside-workspace', 'allow', noPaths)).toBe(false)

    // A shell call DOES name one — the directory it runs in — so it is inside when that is.
    const shell = extractCallFacts('bash', { command: 'echo hi' }, '/repo')
    expect(matchesCapabilityCall('inside-workspace', 'allow', shell)).toBe(true)

    const within = extractCallFacts('write', { path: '/repo/src/a.ts' }, '/repo')
    expect(matchesCapabilityCall('inside-workspace', 'allow', within)).toBe(true)
    const beyond = extractCallFacts('write', { path: '/etc/hosts' }, '/repo')
    expect(matchesCapabilityCall('inside-workspace', 'allow', beyond)).toBe(false)
  })

  test('catastrophic is a strict subset of dangerous', () => {
    // The property that keeps the two honest: a `dangerous` rule still covers everything a
    // `catastrophic` one does, so naming the narrower class can never be an escape hatch.
    const irreversible = ['rm -rf /', 'rm -rf ~', 'mkfs.ext4 /dev/sda1', 'dd if=x of=/dev/sda']
    for (const command of irreversible) {
      const call = extractCallFacts('bash', { command }, '/repo')
      expect({ command, catastrophic: call.catastrophic, dangerous: call.dangerous }).toEqual({
        command,
        catastrophic: true,
        dangerous: true,
      })
    }
    // Destructive but recoverable stays out: this is the line between "confirm" and "never".
    for (const command of ['rm -rf /repo/node_modules', 'git push --force', 'docker rm x']) {
      const call = extractCallFacts('bash', { command }, '/repo')
      expect({ command, catastrophic: call.catastrophic }).toEqual({ command, catastrophic: false })
    }
  })

  test('read-only answers about the whole line, and says no when there is nothing to judge', () => {
    expect(
      matchesCapabilityCall('read-only', 'allow', extractCallFacts('bash', { command: 'ls -la' })),
    ).toBe(true)
    // One writing segment is enough to lose it — the class is about the CALL, not its first command.
    expect(
      matchesCapabilityCall(
        'read-only',
        'allow',
        extractCallFacts('bash', { command: 'ls && rm x' }),
      ),
    ).toBe(false)
    // No command at all is not proof of safety.
    expect(
      matchesCapabilityCall('read-only', 'allow', extractCallFacts('write', { path: 'a' })),
    ).toBe(false)
  })

  test('secrets matches by path, wherever the credential lives', () => {
    const hits = ['/repo/.env', '/repo/.env.production', '/home/u/.ssh/id_rsa', '/repo/key.pem']
    for (const path of hits) {
      expect({ path, hit: extractCallFacts('read', { path }, '/repo').touchesSecret }).toEqual({
        path,
        hit: true,
      })
    }
    for (const path of ['/repo/src/environment.ts', '/repo/README.md']) {
      expect({ path, hit: extractCallFacts('read', { path }, '/repo').touchesSecret }).toEqual({
        path,
        hit: false,
      })
    }
  })

  test('every trust class has a fallback, and only the bundled one runs unprompted', () => {
    for (const entry of RESOURCE_CLASSES.filter((candidate) => candidate.test === null)) {
      const effect = trustFallback(entry.value as 'bundled' | 'opt-in' | 'untrusted')
      expect(effect === 'allow' || effect === 'ask').toBe(true)
      if (entry.value !== 'bundled') expect(effect).toBe('ask')
    }
  })
})
