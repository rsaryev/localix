/**
 * The `manage_environment` fix-it guards.
 */

import { describe, expect, test } from 'bun:test'
import { manageEnvironmentProblem, type ManageEnvironmentInput } from './manage-environment-schema'

const input = (over: Partial<ManageEnvironmentInput>): ManageEnvironmentInput =>
  ({ action: 'list', ...over }) as ManageEnvironmentInput

describe('manageEnvironmentProblem', () => {
  test('list needs nothing', () => {
    expect(manageEnvironmentProblem(input({ action: 'list' }))).toBeNull()
  })

  test.each(['save', 'use', 'get', 'delete'] as const)('%s without a name is refused', (action) => {
    expect(manageEnvironmentProblem(input({ action }))).toContain('needs a "name"')
  })

  test('save without variables is refused, and points at delete', () => {
    const problem = manageEnvironmentProblem(input({ action: 'save', name: 'dev' }))
    expect(problem).toContain('needs "variables"')
    expect(problem).toContain('delete')
  })

  test('a complete save passes', () => {
    expect(
      manageEnvironmentProblem(
        input({
          action: 'save',
          name: 'dev',
          variables: [{ name: 'base_url', value: 'https://a.dev' }],
        }),
      ),
    ).toBeNull()
  })

  test('a blank variable name is refused — it is what `{{ name }}` refers to', () => {
    expect(
      manageEnvironmentProblem(
        input({ action: 'save', name: 'dev', variables: [{ name: '  ', value: 'x' }] }),
      ),
    ).toContain('"name"')
  })
})

describe('environment secrets use native Vault references', () => {
  test('an existing ${secret:} reference is accepted', () => {
    expect(
      manageEnvironmentProblem(
        input({
          action: 'save',
          name: 'dev',
          variables: [{ name: 'token', value: '${secret:GH_TOKEN}', secret: true }],
        }),
      ),
    ).toBeNull()
  })

  test('a value that merely mentions "secret" is fine', () => {
    expect(
      manageEnvironmentProblem(
        input({
          action: 'save',
          name: 'dev',
          variables: [{ name: 'base_url', value: 'https://secret.api.dev' }],
        }),
      ),
    ).toBeNull()
  })
})
