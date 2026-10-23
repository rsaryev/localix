/**
 * The RULES a connection will judge an order by, rendered for the agent — pure, no service.
 *
 * The tools that read and mutate an account never stated them. An agent could size an order past a
 * notional cap, pick a market outside the allow-list, or try to trade a read-only connection, and
 * learn all of it only from a rejection — after it had already asked a human to approve the order.
 * Worse, a cap it cannot see is a cap it cannot plan around: told "buy 1 BTC" against a
 * `maxOrderNotional: 500` connection, the honest move is to say so, not to submit and be refused.
 *
 * Rendered ONCE here and shared by the `portfolio` roster, the `manage_orders` roster and the
 * `localix://resource/trade` connection expansion, so the three can never drift into describing different rules.
 * Introspection only: nothing here is a credential.
 */

/** The subset of a connection the rules line reads. Structurally a `TradingConnectionInfo`. */
export interface ConnectionRulesView {
  readonly: boolean
  risk: {
    agentTrading: 'off' | 'confirm' | 'on'
    maxOrderNotional?: number
    maxOpenNotional?: number
    allowedSymbols?: string[]
  }
}

const AGENT_TRADING_NOTE: Record<ConnectionRulesView['risk']['agentTrading'], string> = {
  off: 'agent may not trade',
  confirm: 'agent orders need human approval',
  on: 'agent trades unattended',
}

/**
 * One compact line. A read-only connection stops there: no other rule can matter when nothing may
 * be sent. An ABSENT cap is genuinely unset, so it is simply not mentioned — the line states what
 * is true, and never invents an "unlimited" claim about money.
 */
export function connectionRules(conn: ConnectionRulesView): string {
  if (conn.readonly) return 'read-only — no orders, cancels or closes can be sent'

  const parts = [`armed (orders enabled) · ${AGENT_TRADING_NOTE[conn.risk.agentTrading]}`]
  if (conn.risk.maxOrderNotional !== undefined)
    parts.push(`max ${conn.risk.maxOrderNotional} per order (quote currency)`)
  if (conn.risk.maxOpenNotional !== undefined)
    parts.push(`max ${conn.risk.maxOpenNotional} total open exposure`)
  if (conn.risk.allowedSymbols?.length) {
    // The fence covers cancels and closes too, and refuses an unscoped `cancel_all` outright. An
    // agent that reads only "allowed: BTC" would still try to sweep the account.
    parts.push(
      `only these markets, for every action incl. cancel/close: ${conn.risk.allowedSymbols.join(', ')} (an account-wide cancel_all is refused)`,
    )
  }
  return parts.join(' · ')
}
