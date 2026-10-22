# Trading workbench

Trading Workspace is a bundled plugin that reads public exchange data and renders market research
surfaces. Use this page when changing its registered backend, public connection boundary, live-data
flow, resource references, agent tools, or workbench UI.

## Terminology

| Term             | Meaning                                                              | Boundary                                                        |
| ---------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| Public profile   | Ephemeral `public:<exchange>` connection configuration               | It carries no credentials and is never saved                    |
| Unified symbol   | Venue-normalized market identity such as `BTC/USDC:USDC`             | The selected venue remains part of the identity                 |
| Exchange backend | Venue-neutral public-read port implemented by the ccxt driver        | No write method exists on the registered port                   |
| Market stream    | Normalized ticker, candle, order-book, or public-trade update        | Account channels are not accepted by the WebSocket contribution |
| Trade resource   | `localix://resource/trade/...` reference to public market data       | Context Fabric accepts only public profiles                     |
| Chart command    | `manage_chart` request delivered through the session command channel | Chart changes affect Localix UI state, not an exchange account  |

## What you can do

| Operation                   | Mechanism                                                                   | Boundary                                                          |
| --------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Browse public markets       | Load the exchange catalog and a filtered, type-aware market roster          | Venue availability and public access remain external dependencies |
| Inspect a market            | Read ticker, candles, order book, public trades, funding, and open interest | Each field depends on the venue and market type                   |
| Work with charts            | Open chart tabs with candles, bars, line, or area rendering                 | Timeframes come from the venue's advertised set                   |
| Add technical analysis      | Compute indicators, ratings, pattern scans, drawings, and chart scale state | Results describe the supplied candle window                       |
| Attach market context       | Resolve public market resources into bounded message evidence               | Saved or credentialed connection ids fail the context gate        |
| Search a live roster        | Run the lazy Trading search provider over public markets                    | Search runs only when the Trading scope is selected               |
| Let an agent read markets   | Call `market_data` for public quotes, candles, depth, and calculations      | The registered roster contains only the default public venue      |
| Let an agent control charts | Call `manage_chart` to read or change Localix chart state                   | The tool requires the `workbench-ui` capability                   |

The visible workflow belongs to [Research public markets](../../features/trading.md). This page
keeps the maintainer contract for registration, ports, state ownership, and failure behavior.

## How it works

### Registered surface

[`register()`](../../../plugins/trading/backend/index.ts) returns one backend contribution and two
tools:

| Contribution | Registered mechanism                                | Invariant and failure mode                                                |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------- |
| Routes       | `/rpc/trading` public catalog and market-data reads | No credential, account, order, leverage, or cancellation route is mounted |
| Resources    | `localix://resource/trade` provider                 | Unknown grammar or a missing public profile returns a failed expansion    |
| Context      | `trading:public-context` adapter                    | Only `public:<exchange>` resources pass `accepts`                         |
| Search       | Lazy `trading` provider                             | A failed venue roster contributes no hits                                 |
| Streams      | `m` WebSocket frame contribution                    | Only ticker, OHLCV, order-book, and trade channels pass validation        |
| Tool         | `market_data`                                       | The port contains read methods only                                       |
| Tool         | `manage_chart`                                      | It changes Localix chart state and performs server-side public-data scans |

Files elsewhere in the plugin tree are not a product surface by themselves. The returned
contributions from `register()` determine what the host mounts and exposes.

### Public connection and driver lifecycle

```text
public:<exchange> id
  -> synthesize readonly connection config
  -> single-flight driver establishment and probe
  -> load and normalize venue market data
  -> short-lived read caches or pooled stream client
  -> route, resource, tool, or UI consumer
  -> close registry entries during plugin shutdown
```

[`public-connection.ts`](../../../plugins/trading/backend/public-connection.ts) parses public ids
and builds a configuration with `readonly: true` and `agentTrading: off`. It accepts exchange ids
made from letters, digits, underscores, and hyphens.

[`connection-registry.ts`](../../../plugins/trading/backend/connection-registry.ts) single-flights
first access per user and connection. A failed probe closes the half-open driver. `closeAll` evicts
read caches and settles every driver close during shutdown.

[`backend.ts`](../../../plugins/trading/backend/backend.ts) defines the venue-neutral read port. The
current implementation uses ccxt for request/response reads and ccxt.pro for optional streaming.
Normalization occurs before backend data crosses into the service or UI contracts.

### Reads, caches, and streams

[`service.ts`](../../../plugins/trading/backend/service.ts) composes the registry, cached reads, and
stream factory. It lazily loads one normalized market table per live driver; an explicit reload asks
the venue again.

The stream registry pools one client per connection and one loop per connection, channel, symbol,
and timeframe. The first subscriber starts a loop. The last subscriber starts a five-second idle
grace before teardown.

A loop reports `down` until data arrives or an 800-millisecond settle timer marks it live.
Unexpected ends retry with exponential backoff from one to fifteen seconds. Five consecutive
failures that never reach live stop retries until a fresh subscription.

UI hooks pause visibility-gated polling when their surface is hidden. A delivered WebSocket feed
pauses its REST fallback; a down or unavailable stream lets polling resume.

### Resource and context boundary

[`uri.ts`](../../../plugins/trading/backend/uri.ts) is the only parser and builder for trade
resources. The implemented tree is connection, market type, market, then one of these leaves:

| Leaf         | Expansion                                             |
| ------------ | ----------------------------------------------------- |
| `ticker`     | Current normalized quote                              |
| `candles`    | Bounded OHLCV window, optionally refined by timeframe |
| `orderbook`  | Bounded public depth snapshot                         |
| `trades`     | Recent public venue trades                            |
| `funding`    | Public funding rate and open interest when available  |
| `technicals` | Server-computed rating and market-analysis text       |

Unified symbols remain one encoded URI segment. Literal `.` and `..` segments, unknown leaves, and
malformed timeframe refinements are rejected.

[`context-provider.ts`](../../../plugins/trading/backend/context-provider.ts) applies the public-id
gate to support checks, estimation, and resolution. Its five-second timeout and 8,000-token quota
bound each captured contribution.

### Tools and UI state

`market_data` lists its connection roster, describes a venue, quotes one symbol or a basket, reads
candles and depth, computes indicators and pair statistics, and estimates visible-book slippage. It
cannot place or cancel an order because its injected port has no write method.

`manage_chart` is sequential. Most actions publish replayable chart commands that the UI routes to
the target chart tab. `snapshot` reads the last-known chart-state map. `detect` reads up to 200
candles server-side; `auto_draw` additionally publishes bounded drawing commands.

[`register.tsx`](../../../plugins/trading/ui/register.tsx) registers the root workspace,
`trading-chart`, and `trading-technicals` work items. It also owns the rail viewlet, lazy search
scope, resource anchors, and chart command listener.

## Configuration

| Control                    | Default or cap                       | Effect and boundary                                                                                            |
| -------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Plugin state               | Bundled and enabled by default       | A scoped disable removes that scope's UI and tools; the process backend remains while another scope enables it |
| Agent-tool public venue    | `public:hyperliquid`                 | Both tools receive this one registered connection                                                              |
| UI venue source            | Hyperliquid initially                | The market browser can select another catalog exchange                                                         |
| Market browser request     | At most 500 rows                     | Querying asks the server to search the full cached roster before applying the cap                              |
| Market browser reveal step | 60 rows                              | Additional rows are revealed client-side                                                                       |
| Chart timeframe            | Stored per connection; fallback `1h` | A remembered value must appear in the venue's offered list                                                     |
| Chart type                 | Candles                              | Stored per chart tab; bars, line, and area are alternatives                                                    |
| Initial candle history     | 300 bars                             | Older history backfills in pages up to 500                                                                     |
| Candle series cache        | 12 targets in memory                 | Entries are connection, symbol, and timeframe specific                                                         |
| `market_data` market list  | 60 markets                           | Output is token-bounded                                                                                        |
| `market_data` basket       | 20 symbols                           | Uses a scoped multi-symbol read                                                                                |
| `market_data` candles      | Default 30; maximum 200              | The requested window is the calculation input                                                                  |
| `market_data` indicators   | Maximum 12                           | Warm-up requirements still apply                                                                               |
| `market_data` depth        | Default 10; maximum 50 per side      | Slippage estimates cover only fetched depth                                                                    |
| Trading search             | 25 market hits per connection        | Results are scored before truncation                                                                           |

## Limits

- The registered plugin is public-data and exchange-read-only. It mounts no account, credential,
  balance, position, private-trade, order, leverage, or cancellation surface.
- Code for other historical or prospective trading concerns can exist in the directory without being
  registered. Do not infer availability from an unreturned module.
- `market_data` and `manage_chart` receive only `public:hyperliquid` from the backend registration.
  A venue selected in the UI is not automatically added to their connection roster.
- `manage_chart` requires `workbench-ui`, including its server-side `detect` action. Headless
  clients do not receive the tool.
- `manage_chart` supplies a per-call classifier: `snapshot` and plain `detect` are `read`;
  recognized chart changes and `detect` with `auto_draw: true` are `view`; unknown actions are
  `external`. Agent rules and conversation modes decide the permission result.
- A `snapshot` of an unmounted chart returns last-known state or stored preferences. Live viewport,
  candle, and computed-indicator values appear only while the chart is mounted.
- REST and WebSocket availability varies by venue, symbol, timeframe, and channel. Fallback polling
  does not guarantee tick-by-tick delivery.
- Missing price, funding, open interest, or feed data remains absent. The service does not convert
  an unavailable value to zero.
- Visible-book slippage stops at the fetched book depth. An unfilled remainder makes the result a
  lower bound, not an execution estimate.
- Technical indicators, ratings, patterns, and risk figures use bounded historical inputs. They do
  not verify execution availability or create an order instruction.
- Public context resolution has a five-second provider deadline. Cold venue startup or market-table
  loading can exceed it and produce a timed-out contribution.

## Related guides

- [Research public markets](../../features/trading.md)
- [Plugins](../../extending/plugins.md)
- [Workspace](../../features/workspace.md)
- [Message bindings](message-bindings.md)
- [Capabilities and permissions](../../features/capabilities.md)

## Source of truth

- [Chart action effect classifier](../../../plugins/trading/backend/manage-chart-class.ts)

- [Plugin manifest](../../../plugins/trading/.localix-app/app.json)
- [Backend registration](../../../plugins/trading/backend/index.ts)
- [Public connection contract](../../../plugins/trading/backend/public-connection.ts)
- [Exchange backend port](../../../plugins/trading/backend/backend.ts)
- [Connection registry](../../../plugins/trading/backend/connection-registry.ts)
- [Trading service](../../../plugins/trading/backend/service.ts)
- [Public HTTP routes](../../../plugins/trading/backend/routes.ts)
- [Market-data tool](../../../plugins/trading/backend/market-data.ts)
- [Chart-control tool](../../../plugins/trading/backend/manage-chart.ts)
- [Live stream registry](../../../plugins/trading/backend/stream.ts)
- [WebSocket frame contribution](../../../plugins/trading/backend/ws-frames.ts)
- [Resource URI grammar](../../../plugins/trading/backend/uri.ts)
- [Public context provider](../../../plugins/trading/backend/context-provider.ts)
- [Workbench registration](../../../plugins/trading/ui/register.tsx)
- [Chart tab](../../../plugins/trading/ui/TradingChartTab.tsx)
