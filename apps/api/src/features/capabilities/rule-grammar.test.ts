import { describe, expect, test } from 'bun:test'
import { ruleGrammar } from './rule-grammar'
import { ACTION_PREFIX } from './resolve'
import { EFFECTS } from '../agent-core/capability-rule'
import { RESOURCE_CLASSES, resourceClassOf } from '../agent-core/capability-resource-classes'

const grammar = ruleGrammar()

describe('the grammar describes what the engine actually does', () => {
  test('every action prefix is explained, and nothing else is', () => {
    // `ACTION_PREFIX` owns the list; this one must mirror it exactly, plus `invocation:`,
    // which is not a capability kind but is a prefix a rule can name. A prefix the editor
    // offers and cannot explain is how the column came to need a grep to understand.
    const explained = grammar.kinds.map((kind) => kind.prefix).sort()
    const expected = [...Object.values(ACTION_PREFIX), 'invocation:'].sort()
    expect(explained).toEqual(expected)
  })

  test('every effect is explained, in the order the engine defines them', () => {
    expect(grammar.effects.map((effect) => effect.value)).toEqual([...EFFECTS])
  })

  test('the classes are the class list itself, not a copy of it', () => {
    expect(grammar.classes.map((entry) => entry.value)).toEqual(
      RESOURCE_CLASSES.map((entry) => entry.value),
    )
    for (const entry of grammar.classes) {
      expect(entry.hint).toBe(resourceClassOf(entry.value)!.hint)
    }
  })

  test('nothing in it is empty, because an empty line explains nothing', () => {
    for (const kind of grammar.kinds) {
      expect(kind.hint.length).toBeGreaterThan(12)
      expect(kind.label.length).toBeGreaterThan(1)
    }
    for (const effect of grammar.effects) expect(effect.hint.length).toBeGreaterThan(8)
  })
})

describe('the worked examples', () => {
  test('each names a prefix the grammar explains', () => {
    const prefixes = grammar.kinds.map((kind) => kind.prefix)
    for (const example of grammar.examples) {
      const prefix = prefixes.find((candidate) => example.action.startsWith(candidate))
      expect({ action: example.action, known: Boolean(prefix) }).toEqual({
        action: example.action,
        known: true,
      })
    }
  })

  test('each resource is a real class or an ordinary pattern, never a class that was renamed', () => {
    // The failure this catches: a class is renamed, the matcher and the editor follow the
    // list, and an example keeps teaching the old spelling — a rule a reader copies by hand
    // and that then matches nothing.
    for (const example of grammar.examples) {
      const asClass = resourceClassOf(example.resource)
      const looksLikeClass =
        /^[a-z][a-z-]+$/.test(example.resource) && !example.resource.includes(' ')
      if (looksLikeClass) {
        expect({ resource: example.resource, declared: Boolean(asClass) }).toEqual({
          resource: example.resource,
          declared: true,
        })
      }
    }
  })

  test('a class example is only ever shown on a kind that class applies to', () => {
    for (const example of grammar.examples) {
      const entry = resourceClassOf(example.resource)
      if (!entry || entry.value === '*') continue
      const kind = example.action.slice(0, example.action.indexOf(':'))
      expect({
        example: example.action,
        resource: example.resource,
        ok: entry.appliesTo.includes(kind as never),
      }).toEqual({
        example: example.action,
        resource: example.resource,
        ok: true,
      })
    }
  })

  test('each effect is one the engine has', () => {
    for (const example of grammar.examples) expect(EFFECTS).toContain(example.effect)
  })

  test('every example carries a note saying what it is FOR', () => {
    for (const example of grammar.examples) expect(example.note.length).toBeGreaterThan(20)
  })
})
