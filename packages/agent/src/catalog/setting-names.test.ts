import { describe, expect, test } from 'bun:test'

import { isSecretSettingName } from './setting-names'

describe('secret setting names', () => {
  test('keys, tokens, passwords and personal access tokens are secrets', () => {
    for (const name of [
      'OPENAI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'DB_PASSWORD',
      'CLARIFAI_PAT',
      'SNOWFLAKE_CORTEX_PAT',
      'X_AUTH',
      'SOME_BEARER',
      'PRIVATE_PEM',
    ])
      expect(isSecretSettingName(name)).toBe(true)
  })

  test('where a request goes is a setting', () => {
    for (const name of [
      'AWS_REGION',
      'AZURE_RESOURCE_NAME',
      'GOOGLE_VERTEX_PROJECT',
      'DATABRICKS_HOST',
      'SNOWFLAKE_ACCOUNT',
      'NEON_AI_GATEWAY_BASE_URL',
      'PATH_PREFIX',
    ])
      expect(isSecretSettingName(name)).toBe(false)
  })
})
