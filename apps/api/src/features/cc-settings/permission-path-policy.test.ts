import { expect, test } from 'bun:test'
import { evaluateCcRules, type CcRule, type CcRuleCall } from './permission-rules'

const source = { scope: 'project' as const, path: '/project/settings.json' }

test('file allows cover every mutation target while deny and ask cover any target', () => {
  const rule: CcRule = {
    tier: 'allow',
    tool: 'Edit',
    raw: 'Edit(src/*.ts)',
    specifier: 'src/*.ts',
    source,
  }
  const call: CcRuleCall = {
    engineToolName: 'apply_patch',
    input: {},
    paths: ['/project'],
    filePaths: ['/project/src/a.ts', '/project/src/b.ts'],
    root: '/project',
  }
  expect(evaluateCcRules([rule], call)?.rule).toBe(rule)
  call.filePaths[1] = '/project/src/b.md'
  expect(evaluateCcRules([rule], call)).toBeUndefined()
  rule.tier = 'deny'
  expect(evaluateCcRules([rule], call)).toEqual({ action: 'deny', rule })
  rule.tier = 'ask'
  expect(evaluateCcRules([rule], call)).toEqual({ action: 'ask', rule })
  call.filePaths = []
  expect(evaluateCcRules([rule], call)).toBeUndefined()
  rule.specifier = '*'
  expect(evaluateCcRules([rule], call)).toEqual({ action: 'ask', rule })
})

test('path specifiers preserve literal whitespace while all-invocation markers are trimmed', () => {
  const rule: CcRule = {
    tier: 'deny',
    tool: 'Read',
    raw: 'Read( .env )',
    specifier: ' .env ',
    source,
  }
  const call: CcRuleCall = {
    engineToolName: 'read',
    input: {},
    paths: ['/project/.env'],
    filePaths: [],
  }
  expect(evaluateCcRules([rule], call)).toBeUndefined()
  call.paths = ['/project/ .env ']
  expect(evaluateCcRules([rule], call)?.rule).toBe(rule)
  rule.specifier = ' * '
  call.paths = []
  expect(evaluateCcRules([rule], call)?.rule).toBe(rule)
})
