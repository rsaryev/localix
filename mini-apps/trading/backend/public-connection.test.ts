import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PUBLIC_EXCHANGE_ID,
  publicConnectionConfig,
  publicConnectionId,
  publicExchangeId,
} from './public-connection'

describe('public market-data profiles', () => {
  test('Hyperliquid is the default source and receives a stable ephemeral id', () => {
    expect(DEFAULT_PUBLIC_EXCHANGE_ID).toBe('hyperliquid')
    expect(publicConnectionId(DEFAULT_PUBLIC_EXCHANGE_ID)).toBe('public:hyperliquid')
  })

  test('parses only safe public profile ids', () => {
    expect(publicExchangeId('public:hyperliquid')).toBe('hyperliquid')
    expect(publicExchangeId('public:okx')).toBe('okx')
    expect(publicExchangeId('saved-connection')).toBeNull()
    expect(publicExchangeId('public:../../secrets')).toBeNull()
  })

  test('is permanently read-only and has no credentials', () => {
    expect(publicConnectionConfig('hyperliquid')).toEqual({
      exchangeId: 'hyperliquid',
      readonly: true,
      risk: { agentTrading: 'off' },
    })
  })
})
