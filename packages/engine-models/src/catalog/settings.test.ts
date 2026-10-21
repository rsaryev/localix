import { describe, expect, test } from 'bun:test'

import { fillTemplate, InvalidSettingError, MissingSettingError, settingsOf } from './settings'

describe("a provider's settings", () => {
  test('only what a request uses is asked for: an address names it, or a cloud reads it', () => {
    const names = (env: string[], addresses: string[] = []) =>
      settingsOf(env, addresses).map((setting) => setting.name)
    expect(names(['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_BEARER_TOKEN_BEDROCK'])).toEqual([
      'AWS_REGION',
    ])
    // A personal access token is the key itself, never a plain-text setting.
    expect(names(['CLARIFAI_PAT'], ['https://api.clarifai.com/v2/ext/openai/v1'])).toEqual([])
    expect(
      names(
        ['SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_CORTEX_PAT'],
        ['https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1'],
      ),
    ).toEqual(['SNOWFLAKE_ACCOUNT'])
    // Beside a fixed address, an endpoint variable is read by nothing.
    expect(
      names(['PRIVATEMODE_ENDPOINT', 'PRIVATEMODE_API_KEY'], ['http://localhost:8080/v1']),
    ).toEqual([])
    expect(
      settingsOf(['DATABRICKS_HOST'], ['https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1']),
    ).toEqual([
      {
        name: 'DATABRICKS_HOST',
        label: 'Databricks workspace host',
        placeholder: 'dbc-1234.cloud.databricks.com',
        required: true,
      },
    ])
  })
})

describe('filling an address', () => {
  const neon = '${NEON_AI_GATEWAY_BASE_URL}/v1'
  const databricks = 'https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1'
  const azure = 'https://${AZURE_RESOURCE_NAME}.openai.azure.com/openai/v1'
  const path = 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1'

  test('a variable that starts the address is a whole https address, kept as written', () => {
    expect(fillTemplate(neon, { NEON_AI_GATEWAY_BASE_URL: 'https://x.neon.tech/ai/' })).toBe(
      'https://x.neon.tech/ai/v1',
    )
    expect(fillTemplate(neon, { NEON_AI_GATEWAY_BASE_URL: 'http://127.0.0.1:8080' })).toBe(
      'http://127.0.0.1:8080/v1',
    )
    for (const value of [
      'http://x.neon.tech',
      'https://user:pass@x.neon.tech',
      'https://x.neon.tech/?a=b',
      'x.neon.tech',
      'javascript:alert(1)',
    ])
      expect(() => fillTemplate(neon, { NEON_AI_GATEWAY_BASE_URL: value })).toThrow(
        InvalidSettingError,
      )
  })

  test('a variable in the host is a host name: a pasted URL keeps its host, anything else is refused', () => {
    expect(fillTemplate(databricks, { DATABRICKS_HOST: 'dbc-1.cloud.databricks.com' })).toBe(
      'https://dbc-1.cloud.databricks.com/ai-gateway/mlflow/v1',
    )
    expect(
      fillTemplate(databricks, { DATABRICKS_HOST: 'https://dbc-1.cloud.databricks.com/' }),
    ).toBe('https://dbc-1.cloud.databricks.com/ai-gateway/mlflow/v1')
    for (const value of [
      'evil.test/x',
      'evil.test#',
      'a@evil.test',
      'evil.test:8443',
      'evil..test',
    ])
      expect(() => fillTemplate(databricks, { DATABRICKS_HOST: value })).toThrow(
        InvalidSettingError,
      )
  })

  test("a host's first label stays a single label, so the request stays under the address's domain", () => {
    expect(fillTemplate(azure, { AZURE_RESOURCE_NAME: 'Acme-1' })).toBe(
      'https://acme-1.openai.azure.com/openai/v1',
    )
    for (const value of ['evil.test', 'evil.test/', 'a b', '-acme'])
      expect(() => fillTemplate(azure, { AZURE_RESOURCE_NAME: value })).toThrow(
        'AZURE_RESOURCE_NAME must be a single name',
      )
  })

  test('a variable in the path is one encoded segment; a missing one names itself', () => {
    expect(fillTemplate(path, { CLOUDFLARE_ACCOUNT_ID: 'a/b?c' })).toBe(
      'https://api.cloudflare.com/client/v4/accounts/a%2Fb%3Fc/ai/v1',
    )
    expect(() => fillTemplate(path, {})).toThrow(MissingSettingError)
  })
})
