import { describe, expect, test } from 'bun:test'
import { runClientCommand, type ClientCommandActions } from './clientCommands'

/** Spies for every action, recording what a typed command ended up calling. */
function actions(overrides: Partial<ClientCommandActions> = {}) {
  const calls: unknown[][] = []
  const spy =
    <T>(name: string, result?: T) =>
    (...args: unknown[]) => {
      calls.push([name, ...args])
      return result as T
    }
  const all: ClientCommandActions = {
    newChat: spy('newChat', true),
    resumeChat: spy('resumeChat'),
    renameChat: spy('renameChat'),
    rewind: spy('rewind', true),
    planMode: spy('planMode'),
    showContext: spy('showContext'),
    copyReply: spy('copyReply'),
    openSettings: spy('openSettings'),
    usage: spy('usage'),
    ...overrides,
  }
  return { all, calls }
}

const run = (id: string, text: string, a: ClientCommandActions) =>
  runClientCommand({ command: { id }, text }, a)

describe('client slash commands', () => {
  test('/clear starts a new chat, and is left to the server where none can be started', () => {
    const ok = actions()
    expect(run('clear', '', ok.all)).toBe(true)
    expect(ok.calls).toEqual([['newChat']])
    const none = actions({ newChat: () => false })
    expect(run('clear', '', none.all)).toBe(false)
  })

  test('/resume opens the chosen chat, or the picker without one', () => {
    const a = actions()
    run('resume', 'chat-7 ', a.all)
    run('resume', '', a.all)
    expect(a.calls).toEqual([
      ['resumeChat', 'chat-7'],
      ['resumeChat', null],
    ])
  })

  test('/rename sets the title as typed and explains itself without one', () => {
    const a = actions()
    expect(run('rename', 'Fix the  login flow ', a.all)).toBe(true)
    expect(run('rename', '  ', a.all)).toBe(true)
    expect(a.calls).toEqual([
      ['renameChat', 'Fix the  login flow'],
      ['usage', 'Usage: /rename <title>'],
    ])
  })

  test('/rewind rolls back to the chosen message; none chosen is a usage line', () => {
    const a = actions()
    run('rewind', 'm2 ', a.all)
    run('rewind', '', a.all)
    expect(a.calls).toEqual([
      ['rewind', 'm2'],
      ['usage', 'Pick the message to rewind to: /rewind <message>'],
    ])
    expect(run('rewind', 'm2', actions({ rewind: () => false }).all)).toBe(false)
  })

  test('/plan switches to Plan mode and carries the task along', () => {
    const a = actions()
    run('plan', '', a.all)
    run('plan', ' map the  migration ', a.all)
    expect(a.calls).toEqual([
      ['planMode', ''],
      ['planMode', 'map the  migration'],
    ])
  })

  test('/copy takes the nth latest reply, the latest by default', () => {
    const a = actions()
    run('copy', '', a.all)
    run('copy', '2 ', a.all)
    run('copy', 'second', a.all)
    expect(a.calls).toEqual([
      ['copyReply', 1],
      ['copyReply', 2],
      ['usage', 'Pick which reply to copy: /copy <number>, 1 is the latest'],
    ])
  })

  test('/context, /permissions and /config go where they say', () => {
    const a = actions()
    run('context', '', a.all)
    run('permissions', '', a.all)
    run('config', '', a.all)
    expect(a.calls).toEqual([
      ['showContext'],
      ['openSettings', 'permissions'],
      ['openSettings', 'preferences'],
    ])
  })

  test('any other command is not this runner’s', () => {
    expect(run('model', 'x', actions().all)).toBe(false)
    expect(runClientCommand(null, actions().all)).toBe(false)
  })
})
