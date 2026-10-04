# Trading Workspace plugin

The Trading Workspace plugin provides public exchange-market research inside Localix. It browses
venues and markets, opens live charts with indicators and drawings, shows order-book and public
trade data, computes technical reads, and exposes the same public data to agent sessions.

The registered implementation is read-only with respect to exchanges: it passes no credentials to
its REST driver, exposes no account routes, and registers no order-placement or cancellation tool.

## Contributions

| Surface          | Contribution                                                      | State and trust boundary                                                                          |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Agent tools      | `market_data` and `manage_chart`                                  | Public venue reads plus Localix chart-state control                                               |
| Workbench UI     | Trading Workspace, chart tabs, and technicals tabs                | Requires the desktop workbench UI contribution                                                    |
| Rail viewlet     | Trading Workspace entry in overflow                               | Opens the overview or public market browser                                                       |
| Backend routes   | `/rpc/trading`                                                    | Public exchange catalog, markets, quotes, candles, order book, trades, funding, and open interest |
| Live data        | `m` WebSocket frame contribution                                  | Public ticker, OHLCV, order-book, and trade streams                                               |
| Resources        | `localix://resource/trade/...`                                    | Read-only connection, market, ticker, candle, book, trade, funding, and technical references      |
| Context provider | `trading:public-context`                                          | Accepts only public-profile trade resources                                                       |
| Search           | Lazy `Trading` scope with `trade`, `market`, and `exchange` terms | Queries live public market rosters only when selected                                             |
| Skill            | `lightweight-charts`                                              | Agent instructions for the installed chart library's v5 API                                       |
| UI panels        | None                                                              | Workbench surfaces use native UI registration rather than manifest HTML panels                    |
| Commands         | None                                                              | No slash command is declared                                                                      |
| Roles            | None                                                              | No worker role is declared                                                                        |
| MCP servers      | None                                                              | No MCP process is started                                                                         |
| Hooks            | None                                                              | No lifecycle or tool hook is declared                                                             |

### Agent tool access

| Tool or action               | Actual effect                                                                                                                                                     | Host classification | Confirmation behavior                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `market_data`                | Reads connections, market metadata, tickers, candles, order books, funding, and open interest; can compute indicators, pair statistics, and visible-book slippage | Read-only           | No mutating-tool confirmation; a user rule may still target the tool name |
| `manage_chart` `snapshot`    | Reads the current Localix chart tab state                                                                                                                         | Read-only           | No confirmation                                                           |
| `manage_chart` `detect`      | Reads public market data; `auto_draw: true` also changes Localix chart drawings                                                                                   | Read-only           | No confirmation                                                           |
| Other `manage_chart` actions | Opens or changes a Localix chart tab, timeframe, indicators, chart type, viewport, drawings, or scale presentation                                                | Read-only           | No confirmation under the default mutating-tool policy                    |

`manage_chart` does not declare `mutates` or a per-call classifier. The host therefore treats every
call as read-only for permission rules, including chart-changing calls and `detect` with
`auto_draw: true`. These calls change only Localix UI state and cannot place an exchange order.

## Default state

The bundled plugin is enabled by default. Disabling it makes its agent tools, backend subsystem,
resources, search scope, live stream contribution, and workbench surfaces unavailable.

## Requirements

| Requirement                      | Why it is needed                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Running Localix API              | Hosts `/rpc/trading`, the public-data service, resources, search, and agent tools |
| Localix workbench UI             | Required for Trading tabs and all `manage_chart` calls                            |
| Outbound venue access            | Public REST and WebSocket reads come from the selected exchange                   |
| Installed workspace dependencies | The plugin dynamically loads its bundled `ccxt` dependency                        |

No exchange credential, provider connection, API key, wallet key, trading account, or external
binary is required. Agent sessions still need their normal Localix provider connection to run.

## Configuration

The manifest defines no plugin configuration keys. Market and chart choices live in the workbench.

| Setting                    | Where                              | Behavior                                                                            |
| -------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| Plugin enabled state       | Plugins settings                   | Makes all Trading contributions available; enabled by default                       |
| Data source                | Trading Workspace market browser   | Selects an exchange from the installed catalog; the initial source is `hyperliquid` |
| Market filter and category | Market browser                     | Filters the live roster by text, favorites, market type, or third-party grouping    |
| Favorite markets           | Star control in the market browser | Persists a set per public connection in browser local storage                       |
| Chart timeframe            | Chart timeframe control            | Defaults to `1h` and persists per connection                                        |
| Chart presentation         | Chart controls or `manage_chart`   | Selects candles, line, area, or bars; indicators and drawings are local chart state |
| Technicals timeframe       | Technicals tab                     | Selects `5m`, `15m`, `1h`, `4h`, or `1d` for the displayed rating                   |

Public source ids use the `public:<exchange>` form. They are created lazily, are read-only, carry
`agentTrading: off`, and are not stored as credentialed connections.

## How data reaches the workspace

The backend loads a venue adapter through `ccxt`, normalizes its public responses, and serves the UI
through the plugin routes. Ticker, candle, and order-book views prefer public WebSocket streams.
After a stream delivers data, its REST fallback pauses; if the stream is unavailable or goes down,
the view resumes visibility-gated polling. The public trade tape has no REST fallback.

Hidden chart tabs pause their live reads. Candle history starts with 300 bars, can backfill in pages
of up to 500, and keeps a bounded in-memory session cache for recently viewed series.

## Limits

- This plugin performs market research only. It has no account, balance, position, private-trade,
  paper-trading, order, leverage, cancellation, or execution surface in its registered backend.
- `manage_chart` requires the `workbench-ui` capability. It is unavailable in headless clients,
  including its server-side `detect` action.
- Most `manage_chart` actions need a live UI command channel. `snapshot` also needs a UI reply;
  `detect` can run without an open chart unless `auto_draw` is requested.
- Chart-changing `manage_chart` calls are not marked as mutations and are not confirmation-gated.
- Market availability, symbols, timeframes, history depth, funding, open interest, order books, and
  streaming depend on the selected venue's reported capabilities.
- Public data can be delayed, absent, rate-limited, or unreachable. Missing values remain absent;
  they are not converted to zero.
- `market_data` lists at most 60 markets, quotes at most 20 symbols per basket, reads at most 200
  candles, accepts at most 12 indicators, and shows at most 50 order-book levels per side.
- The market browser requests at most 500 roster entries for its active filter and initially reveals
  60 rows.
- Global search returns at most 25 matching markets per connected public source.
- A visible-book slippage estimate covers only the fetched depth. If the requested size exceeds that
  depth, the result is a lower bound rather than a full execution estimate.
- Technical analysis is computed from the requested candle window. Indicators without enough warm-up
  data abstain or remain unavailable.
- Technical output is research data, not an order instruction or an execution guarantee.

## Source of truth

- [Manifest](./plugin.json)
- [Plugin dependencies](./package.json)
- [Backend registration](./backend/index.ts)
- [Public market service](./backend/service.ts)
- [Public routes](./backend/routes.ts)
- [`market_data` tool](./backend/market-data.ts)
- [`manage_chart` tool](./backend/manage-chart.ts)
- [Public connection boundary](./backend/public-connection.ts)
- [Resource provider](./backend/resource-provider.ts)
- [Live stream registry](./backend/stream.ts)
- [UI registration](./ui/register.tsx)
- [Trading workbench](./ui/TradingWorkspace.tsx)
- [Chart tab](./ui/TradingChartTab.tsx)
- [Technicals tab](./ui/TechnicalsTab.tsx)
- [Chart skill](./skills/lightweight-charts/SKILL.md)

## Related guides

- [Plugins](../../docs/extending/plugins.md)
- [Workspace](../../docs/features/workspace.md)
- [Capabilities and permissions](../../docs/features/capabilities.md)
