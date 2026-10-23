import { describe, expect, test } from 'bun:test'
import { chartMessageContext } from './chartMessageContext'

describe('chartMessageContext', () => {
  test('replaces the broad market ref with one timeframe-specific candle ref', () => {
    expect(chartMessageContext('public:hyperliquid', 'BTC/USDC:USDC', '4h')).toEqual({
      strategy: 'replace',
      bindings: [
        {
          kind: 'context',
          source: 'mini-app',
          target: {
            kind: 'resource',
            token:
              '@resource:localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC/candles/4h',
            uri: 'localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC/candles/4h',
            label: 'BTC/USDC:USDC 4h candles',
          },
        },
      ],
    })
  })
})
