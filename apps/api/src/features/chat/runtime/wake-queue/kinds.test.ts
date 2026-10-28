import { describe, expect, test } from 'bun:test'

import { defaultQueuePolicy } from '../queue-policy'
import { joinPoint, queueSourceOf, renderBatch, routeEvent } from './kinds'
import { entry, event, person, report } from './testing/test-entries'

const surface = { capabilities: ['workbench-ui'], catalogs: { 'workbench-ui': 'cat-1' } }

describe('where a running model may take an entry', () => {
  test("the person's message joins at the next boundary — whatever surface it came from", () => {
    expect(joinPoint(person('p').value)).toBe('boundary')
    // Every send from the app carries the workbench surface; it used to bar every interjection.
    expect(joinPoint(person('p', 'p', { toolSurface: surface }).value)).toBe('boundary')
  })

  test('an attachment, a hidden prompt or a command waits for its own turn', () => {
    const image = [{ kind: 'image', id: 'img' }] as never
    expect(joinPoint(person('p', 'p', { bindings: image }).value)).toBe('never')
    expect(joinPoint(person('p', 'p', { internal: true }).value)).toBe('never')
    expect(joinPoint(entry('c', { internal: false, command: {}, source: 'user-busy' }).value)).toBe(
      'never',
    )
  })

  test("a delegator's message joins its child's run; a report only after a tool turn", () => {
    expect(joinPoint(event('d', { source: 'delegator' }).value)).toBe('boundary')
    expect(joinPoint(report('r').value)).toBe('tool-turn')
    for (const source of ['loop', 'bg-job', 'external', 'mini-app', 'hook'] as const)
      expect(joinPoint(event(source, { source }).value)).toBe('never')
  })
})

describe('how a delivery is routed', () => {
  test("the person's words go by their text, a hidden webhook's included", () => {
    expect(routeEvent(person('p').value, '@qa look')).toEqual({
      kind: 'user-message',
      text: '@qa look',
    })
    const webhook = person('w', 'w', { internal: true, person: true, source: 'external' }).value
    expect(routeEvent(webhook, '@qa deploy')).toEqual({
      kind: 'user-message',
      text: '@qa deploy',
    })
  })

  test('a machine wake goes by the runtime rule, unless it carries the words of the person', () => {
    expect(routeEvent(event('e').value, 'x')).toEqual({ kind: 'runtime' })
    expect(routeEvent(report('r').value, 'x')).toEqual({ kind: 'runtime' })
  })
})

describe('what a delivered batch says', () => {
  test('one report reads as it did alone; several are numbered with the follow-up once', () => {
    const one = renderBatch([report('a').value])
    expect(one).toStartWith('[Subagent finished] a (id: a) finished.')
    const two = renderBatch([report('a').value, report('b').value])
    expect(two).toStartWith('[2 subagent replies]')
    expect(two).toContain('1. [Subagent finished] a (id: a)')
    expect(two).toContain('2. [Subagent finished] b (id: b)')
    expect(two.match(/To change or extend this work/g)).toHaveLength(1)
  })

  test('messages and stream wakes read in order', () => {
    expect(renderBatch([person('a', 'one').value, person('b', 'two').value])).toBe('one\n\ntwo')
  })
})

describe('the band an entry waits in', () => {
  test('the order the bands had before entries were typed', () => {
    const priority = (item: { value: Parameters<typeof queueSourceOf>[0] }) =>
      defaultQueuePolicy.priority(queueSourceOf(item.value))
    expect(priority(person('p'))).toBe(0)
    expect(priority(entry('c', { internal: false, command: {}, source: 'user-busy' }))).toBe(0)
    expect(priority(event('e'))).toBe(10)
    expect(priority(report('r'))).toBe(10)
    expect(priority(person('w', 'w', { internal: true, person: true, source: 'external' }))).toBe(
      10,
    )
  })
})
