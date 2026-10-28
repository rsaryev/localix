import { describe, expect, test } from 'bun:test'

import {
  ACTIVATE_TOOLS_TOOL_NAME,
  BUILTIN_TOOL_CATALOG,
  BUILTIN_TOOL_NAMES,
  TOOL,
} from './tool-names'

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/

/**
 * One name per built-in tool: Claude Code's spelling (`Bash`, `Read`, `AskUserQuestion`). The
 * model is offered it, a hook and a skill's `allowed-tools` see it, a rule (`tool:Bash`), Settings
 * and the transcript show it. A roster therefore never mixes styles, and no second name exists.
 */
describe('the built-in tool catalog naming convention', () => {
  const entries = Object.entries(BUILTIN_TOOL_CATALOG) as [string, Record<string, unknown>][]

  test.each(entries as [string, Record<string, unknown>][])(
    '%s is its own PascalCase name, with no second name',
    (key, definition) => {
      expect(definition.name).toMatch(PASCAL_CASE)
      expect(key).toBe(definition.name as string)
      expect('modelName' in definition).toBe(false)
    },
  )

  test('every name the registry offers is PascalCase', () => {
    expect(BUILTIN_TOOL_NAMES.filter((name) => !PASCAL_CASE.test(name))).toEqual([])
    expect([...BUILTIN_TOOL_NAMES]).toEqual(Object.values(TOOL))
  })

  test('the tool loader is named the way Claude Code names it', () => {
    expect(ACTIVATE_TOOLS_TOOL_NAME).toBe('ToolSearch')
  })
})
