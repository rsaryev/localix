/**
 * Connection vocabulary — how a trading source is configured, credentialed, and gated.
 *
 * Exchange-agnostic: a connection names a venue by `exchangeId`, never a driver. The
 * risk/autonomy fields here are the ones the order gate reads before any write.
 */
import { z } from 'zod'

// ── Connections ────────────────────────────────────────────────────────────────

/** Palette for the per-connection colour tag (pure metadata; mirrors the db workbench). */
export const CONNECTION_COLORS = ['slate', 'emerald', 'amber', 'rose', 'violet', 'cyan'] as const
export type ConnectionColor = (typeof CONNECTION_COLORS)[number]

/**
 * Every credential an exchange might require. All optional — a connection with none is a
 * PUBLIC connection (market data only). Which subset an exchange needs is reported by the
 * driver (`ExchangeInfo.requiredCredentials`), never hardcoded here.
 *
 * Any value may be a `${secret:KEY}` token, resolved server-side at use time against the
 * central vault through the generic mini app host seam.
 */
export const credentialsSchema = z.object({
  apiKey: z.string().optional(),
  secret: z.string().optional(),
  password: z.string().optional(),
  uid: z.string().optional(),
  /** EVM address — Hyperliquid & other on-chain venues. */
  walletAddress: z.string().optional(),
  /** EVM private key used to SIGN orders. Never leaves the server. */
  privateKey: z.string().optional(),
})
export type TradingCredentials = z.infer<typeof credentialsSchema>

/** The credential field names, for redaction + "which are set" reporting. */
export const CREDENTIAL_FIELDS = [
  'apiKey',
  'secret',
  'password',
  'uid',
  'walletAddress',
  'privateKey',
] as const
export type CredentialField = (typeof CREDENTIAL_FIELDS)[number]

/** Market kind a connection defaults to when a symbol is ambiguous. */
export const marketTypeSchema = z.enum(['spot', 'swap', 'future', 'margin', 'option'])
export type MarketType = z.infer<typeof marketTypeSchema>

/**
 * Which WORLD a connection's orders live in. `live` (the default) trades the venue's real
 * account with real funds; `paper` runs the full order lifecycle against a local simulator
 * (`paper-backend.ts`) that prices fills off the venue's REAL public book — no
 * credentials required, nothing real is ever spent. Distinct from `sandbox`, which routes to
 * the VENUE's own testnet endpoint and still needs that testnet's credentials.
 */
export const tradingEnvironmentSchema = z.enum(['paper', 'live'])
export type TradingEnvironment = z.infer<typeof tradingEnvironmentSchema>

/**
 * How much autonomy the AGENT has on this connection. `readonly` is the coarse gate (nobody
 * trades); this is the fine one (the human may trade while the agent may not).
 *
 * `confirm` is the DEFAULT: the agent may propose an order, but a human approves each one
 * through the standard HITL card. `on` lets it place unattended — still bounded by the
 * notional caps below, which is the only reason `on` is a defensible option at all.
 */
export const agentTradingSchema = z.enum(['off', 'confirm', 'on'])
export type AgentTrading = z.infer<typeof agentTradingSchema>

/**
 * Per-connection risk limits, enforced in the SERVICE — the one choke-point the route, the UI
 * and the agent tool all already pass through. These are guard-rails on top of the venue's own
 * margin rules, not a substitute for them.
 */
export const riskLimitsSchema = z.object({
  /** Reject an order whose `amount × price` exceeds this (quote currency). */
  maxOrderNotional: z.number().positive().optional(),
  /** Reject an order that would push total open exposure past this (quote currency). */
  maxOpenNotional: z.number().positive().optional(),
  /** Allow-list of unified symbols. Empty/absent ⇒ every market the venue lists. */
  allowedSymbols: z.array(z.string().min(1)).optional(),
  /**
   * Reject a place once this many orders were ACCEPTED today (UTC day, counted from the
   * workbench journal — only confirmed non-error places consume the budget; refusals and
   * venue rejects do not). An unreadable counter refuses (fail closed).
   */
  maxTradesPerDay: z.number().int().positive().optional(),
  agentTrading: agentTradingSchema.optional(),
})
export type RiskLimits = z.infer<typeof riskLimitsSchema>

export const tradingConnectionConfigSchema = z.object({
  /** Driver-resolved exchange id (e.g. `hyperliquid`, `binance`). */
  exchangeId: z.string().min(1),
  /**
   * `paper` = fills simulated locally against the venue's real public data; no credentials
   * needed, no real funds reachable. Absent ⇒ `live`. FIXED at creation — flipping a paper
   * connection live in place would relabel its history and inherit its armed state, so the
   * service refuses the edit (create a new connection for the other world).
   */
  environment: tradingEnvironmentSchema.optional(),
  credentials: credentialsSchema.optional(),
  /** Route to the venue's testnet/paper endpoint when it has one. */
  sandbox: z.boolean().optional(),
  /**
   * WRITE GUARD-RAIL (not a venue permission): when true the service refuses every
   * order-placing / cancelling call before it reaches the driver. Defaults to TRUE —
   * a trading connection is read-only until the user deliberately arms it.
   */
  readonly: z.boolean().optional(),
  /**
   * PANIC opt-in: when the halt kill-switch is tripped with panic, may the workbench also
   * FLATTEN this connection's open positions with market orders (after cancelling every
   * resting order first)? Defaults to FALSE — an automatic market exit is itself an
   * unauthorized trade unless the user opted into it ahead of time. Without the opt-in a
   * panic only halts and cancels; the positions stay for the user to close.
   */
  flattenOnHalt: z.boolean().optional(),
  risk: riskLimitsSchema.optional(),
  defaultType: marketTypeSchema.optional(),
  color: z.enum(CONNECTION_COLORS).optional(),
})
export type TradingConnectionConfig = z.infer<typeof tradingConnectionConfigSchema>

/** Client-facing connection summary — NEVER carries credential values. */
export interface TradingConnectionInfo {
  id: string
  name: string
  exchangeId: string
  /** Which world orders live in — echoed so a paper fill can never read as a real one (and
   *  vice versa). Absent ⇒ `live` (ephemeral public profiles predate the field). */
  environment?: TradingEnvironment
  sandbox: boolean
  readonly: boolean
  color?: ConnectionColor
  /** Which credential fields are populated (values redacted). */
  credentialFields: CredentialField[]
  /** True once the driver is live in this process. */
  connected: boolean
  /** Effective risk limits (with `agentTrading` defaulted). Contains no credentials. */
  risk: RiskLimits & { agentTrading: AgentTrading }
}
