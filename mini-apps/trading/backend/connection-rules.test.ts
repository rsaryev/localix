import { describe, expect, test } from 'bun:test'
import { connectionRules, type ConnectionRulesView } from './connection-rules'

const conn = (over: Partial<ConnectionRulesView> = {}): ConnectionRulesView => ({
  readonly: false,
  risk: { agentTrading: 'confirm' },
  ...over,
})

describe('connectionRules — the rules an order is judged by, stated once', () => {
  test('a read-only connection stops there — no other rule can matter', () => {
    const line = connectionRules(
      conn({ readonly: true, risk: { agentTrading: 'on', maxOrderNotional: 500 } }),
    )
    expect(line).toBe('read-only — no orders, cancels or closes can be sent')
    // The caps are irrelevant on a connection that cannot send anything; naming them invites the
    // agent to plan an order it will never be allowed to place.
    expect(line).not.toContain('500')
  })

  test('an armed connection names its autonomy', () => {
    expect(connectionRules(conn({ risk: { agentTrading: 'off' } }))).toContain(
      'agent may not trade',
    )
    expect(connectionRules(conn({ risk: { agentTrading: 'confirm' } }))).toContain(
      'agent orders need human approval',
    )
    expect(connectionRules(conn({ risk: { agentTrading: 'on' } }))).toContain(
      'agent trades unattended',
    )
  })

  test('an ABSENT cap is unset — never rendered as unlimited', () => {
    const line = connectionRules(conn())
    expect(line).not.toContain('max')
    expect(line).not.toContain('unlimited')
    expect(line).not.toContain('undefined')
  })

  test('both caps are named with the unit they are enforced in', () => {
    const line = connectionRules(
      conn({ risk: { agentTrading: 'on', maxOrderNotional: 500, maxOpenNotional: 2000 } }),
    )
    expect(line).toContain('max 500 per order (quote currency)')
    expect(line).toContain('max 2000 total open exposure')
  })

  test('the fence says it covers cancels and closes, and refuses an account-wide sweep', () => {
    // An agent that reads only "allowed: BTC" would still try to cancel_all the account.
    const line = connectionRules(
      conn({ risk: { agentTrading: 'on', allowedSymbols: ['BTC/USDC:USDC'] } }),
    )
    expect(line).toContain('incl. cancel/close')
    expect(line).toContain('BTC/USDC:USDC')
    expect(line).toContain('account-wide cancel_all is refused')
  })

  test('an EMPTY allow-list is no fence', () => {
    expect(
      connectionRules(conn({ risk: { agentTrading: 'on', allowedSymbols: [] } })),
    ).not.toContain('only these markets')
  })
})
