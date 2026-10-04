import { describe, expect, test } from 'bun:test'
import { Bot, Cpu } from 'lucide-react'
import {
  titleFor,
  sessionTone,
  statusText,
  kindStyle,
  runtimeCountsLabel,
} from './runtimeSessionMeta'
import type { UiSession } from '@/shared/api/contracts'

const s = (o: Partial<UiSession>): UiSession => ({ ...o }) as UiSession

describe('titleFor', () => {
  test('a non-blank title wins, trimmed', () => {
    expect(titleFor(s({ title: '  Build the thing  ' }))).toBe('Build the thing')
  })

  test('blank/missing title falls back by kind', () => {
    expect(titleFor(s({ title: '   ', sessionKind: 'job' }))).toBe('Job')
    expect(titleFor(s({ title: '', sessionKind: 'subagent' }))).toBe('Subagent')
    expect(titleFor(s({ sessionKind: 'job' }))).toBe('Job') // undefined title
    expect(titleFor(s({}))).toBe('Subagent') // undefined kind → subagent
  })
})

describe('sessionTone', () => {
  test('maps runtime status to the leading-dot tone', () => {
    expect(sessionTone(s({ runtimeStatus: 'running' }))).toBe('running')
    expect(sessionTone(s({ runtimeStatus: 'completed' }))).toBe('done')
    expect(sessionTone(s({ runtimeStatus: 'failed' }))).toBe('error')
    expect(sessionTone(s({ runtimeStatus: 'stopped' }))).toBe('idle')
    expect(sessionTone(s({}))).toBe('idle') // unknown/idle → idle
  })
})

describe('statusText', () => {
  test('while running, shows the kind word', () => {
    expect(statusText(s({ runtimeStatus: 'running', sessionKind: 'job' }))).toBe('job')
    expect(statusText(s({ runtimeStatus: 'running', sessionKind: 'subagent' }))).toBe('subagent')
  })

  test('terminal states show their own label', () => {
    expect(statusText(s({ runtimeStatus: 'completed' }))).toBe('done')
    expect(statusText(s({ runtimeStatus: 'failed' }))).toBe('failed')
    expect(statusText(s({ runtimeStatus: 'stopped' }))).toBe('stopped')
  })

  test('idle/unknown falls back to the kind word', () => {
    expect(statusText(s({ sessionKind: 'job' }))).toBe('job')
    expect(statusText(s({ sessionKind: 'subagent' }))).toBe('subagent')
    expect(statusText(s({}))).toBe('subagent') // undefined kind → subagent
  })
})

// Reads the external tick snapshot, not the session: these counts are not roster state (see
// model/sessionActivityStore.ts).
describe('runtimeCountsLabel', () => {
  test('joins turns + tools with singular/plural', () => {
    expect(runtimeCountsLabel({ turnCount: 1, toolCount: 1 })).toBe('1 turn · 1 tool')
    expect(runtimeCountsLabel({ turnCount: 3, toolCount: 12 })).toBe('3 turns · 12 tools')
  })

  test('drops a missing or zero part', () => {
    expect(runtimeCountsLabel({ turnCount: 2 })).toBe('2 turns')
    expect(runtimeCountsLabel({ toolCount: 5 })).toBe('5 tools')
    expect(runtimeCountsLabel({ turnCount: 0, toolCount: 4 })).toBe('4 tools')
  })

  test('returns undefined when nothing is known', () => {
    expect(runtimeCountsLabel({})).toBeUndefined()
    expect(runtimeCountsLabel({ turnCount: 0, toolCount: 0 })).toBeUndefined()
  })
})

describe('kindStyle', () => {
  test('jobs use the Cpu icon + "job" label', () => {
    const k = kindStyle(s({ sessionKind: 'job' }))
    expect(k.icon).toBe(Cpu)
    expect(k.label).toBe('job')
  })

  test('everything else uses the Bot icon + "subagent" label', () => {
    const k = kindStyle(s({ sessionKind: 'subagent' }))
    expect(k.icon).toBe(Bot)
    expect(k.label).toBe('subagent')
    expect(kindStyle(s({})).label).toBe('subagent') // undefined kind → subagent
  })
})
