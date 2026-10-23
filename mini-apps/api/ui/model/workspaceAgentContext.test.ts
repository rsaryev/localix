import { expect, test } from 'bun:test'
import { apiWorkspaceAgentStateContent } from './workspaceAgentContext'

test('API root explicitly reports an empty collection and absent selection/environment', () => {
  expect(
    apiWorkspaceAgentStateContent({
      requestsLoading: false,
      requestsError: null,
      requestCount: 0,
      managingEnvironments: false,
      environmentsLoading: false,
    }),
  ).toContain('Saved requests: No saved requests.')
  expect(
    apiWorkspaceAgentStateContent({
      requestsLoading: false,
      requestsError: null,
      requestCount: 0,
      managingEnvironments: false,
      environmentsLoading: false,
    }),
  ).toContain('no request selected')
})

test('API state identifies the selected request, active environment, and loading level', () => {
  const selected = apiWorkspaceAgentStateContent({
    requestsLoading: false,
    requestsError: null,
    requestCount: 3,
    selectedRequest: 'verified/create-post',
    managingEnvironments: false,
    environmentsLoading: false,
    activeEnvironment: 'staging',
  })
  expect(selected).toContain('Saved requests: 3.')
  expect(selected).toContain('selected request "verified/create-post"')
  expect(selected).toContain('Active environment: staging.')

  expect(
    apiWorkspaceAgentStateContent({
      requestsLoading: true,
      requestsError: null,
      requestCount: 0,
      managingEnvironments: true,
      environmentsLoading: true,
    }),
  ).toContain('Current level: environment management.')
})
