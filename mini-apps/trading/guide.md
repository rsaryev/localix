_Use: Use when working with the lightweight-charts library — creating charts, adding series
(Line/Area/Bar/Candlestick/Histogram), configuring time and price scales, streaming realtime or
historical data, panes, markers, per-bar/per-point colors, tooltips, coordinate conversion, custom
plugins or primitives, non-financial horizontal scales, SSR/browser loading, or React/Vue/Web
Components wrappers. Covers v5 API conventions and the common time, scale, marker, plugin, and
wrapper foot-guns._

# Lightweight Charts

Works the same whether the project is a downstream npm consumer app or an upstream
`lightweight-charts` source checkout. Detect which one you are in (below) and resolve every API name
from whatever typings are locally available.

## Source lookup order

Do not assume you are inside the upstream source repository.

1. In a consumer app, inspect the installed package first:
   - `node_modules/lightweight-charts/package.json` for the actual version.
   - `node_modules/lightweight-charts/dist/typings.d.ts` for the API surface.
2. In the upstream repo, inspect `dist/typings.d.ts` first, then `src/` if generated output is
   unavailable.
3. Use official docs/examples as supporting evidence, but local typings win when they disagree.

Verify before answering (copy-paste):

```sh
node -p "require('./node_modules/lightweight-charts/package.json').version"
rg -n "createSeriesMarkers|addSeries|IPrimitivePaneRenderer|createImageWatermark|createOptionsChart" node_modules/lightweight-charts/dist/typings.d.ts
# upstream checkout instead of a consumer app:
rg -n "createSeriesMarkers|IPrimitivePaneRenderer|createImageWatermark|createOptionsChart" dist/typings.d.ts src
```

If the relevant file is unavailable, say what could not be verified. Do not invent option names,
methods, exports, or wrapper behavior.

If the user's code imports `from lightweight_charts import ...` (underscore), uses pandas/asyncio,
or talks about a Python window wrapper, they are probably using the third-party Python wrapper
rather than the TypeScript package. Say that clearly before giving core `lightweight-charts` v5
JavaScript advice.

## Mental model

Eight layers, in dependency order. Most bugs come from confusing one for another:

1. **Chart** — `createChart(container, options)` returns an `IChartApi`. One chart per container
   element.
2. **Series** — added via `chart.addSeries(SeriesType, options, paneIndex?)`. Each call returns an
   `ISeriesApi`. v5 requires importing the series type explicitly.
3. **Scales** — `chart.timeScale()` (`ITimeScaleApi`), `chart.priceScale(id)` (`IPriceScaleApi`).
   Govern range, ticks, autoscale, visibility.
4. **Data model** — arrays of `{ time, … }` points. `Time = UTCTimestamp | BusinessDay | string`.
   `UTCTimestamp` is **seconds**, not milliseconds. In TypeScript, validate numeric timestamps and
   type them as `UTCTimestamp`; plain numbers do not satisfy the branded type. Times must be unique
   and ascending per series.
5. **Interaction** — `chart.subscribeCrosshairMove`, `chart.subscribeClick`,
   `timeScale.subscribeVisibleLogicalRangeChange`, etc.
6. **Layout** — `chart.panes()`, `chart.addPane()`. Adding a series with an out-of-range `paneIndex`
   auto-creates the pane.
7. **Extension** — pane primitives, series primitives, custom series, watermarks, custom renderers
   (canvas via `fancy-canvas`).
8. **Wrappers** — React/Vue/Web Components/iOS/Android. Lifecycle is the wrapper's responsibility;
   the core library is framework-agnostic.

## v5 essentials

The conventions that catch people copying older snippets:

```ts
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts'
import type { UTCTimestamp } from 'lightweight-charts'

const chart = createChart(container, {/* ChartOptions */})
const candles = chart.addSeries(CandlestickSeries, {/* options */})
candles.setData([{ time: 1700000000 as UTCTimestamp, open: 1, high: 2, low: 0.5, close: 1.5 }])
```

Key v5 changes versus older snippets:

- `chart.addSeries(SeriesType, options, paneIndex?)` replaces `addLineSeries` /
  `addCandlestickSeries` / …
- `createSeriesMarkers(series, markers)` replaces `series.setMarkers(...)`. The returned primitive
  owns `.setMarkers(...)` / `.markers()`.
- `createTextWatermark(pane, options)` and `createImageWatermark(pane, imageUrl, options)` replace
  the `watermark` chart option.
- Series types are tree-shaken — importing them is required for ESM.

If a snippet calls `addLineSeries` or `series.setMarkers`, it's v4 or older. Confirm the user's
version before forwarding it.

When the task targets v5, show the v5 API directly — do not hedge by mixing in v4 syntax.

## Triage (problem → API → avoid)

| User asks about    | First check                      | Answer with                                 | Avoid                                    |
| ------------------ | -------------------------------- | ------------------------------------------- | ---------------------------------------- |
| v5 series creation | package version + typings        | `chart.addSeries(SeriesType, options)`      | `addLineSeries` / `addCandlestickSeries` |
| markers            | `createSeriesMarkers` export     | marker primitive + required `color`         | `series.setMarkers`                      |
| timezone           | formatter need vs data semantics | `Intl.DateTimeFormat` in formatters         | fake `timeScale.timezone`                |
| realtime updates   | last-bar vs full replace         | `series.update(point)`                      | `setData` on every tick                  |
| panes              | `paneIndex` + `chart.panes()`    | v5 pane APIs, `pane.setHeight`              | private widget / DOM hacks               |
| per-bar colors     | data-point color fields          | `color`/`borderColor`/`wickColor` on points | extra series / markers to recolor        |
| plugins            | primitive vs custom series       | scaffold/examples + public coordinate APIs  | invented renderer names                  |

### v4 → v5 replacement matrix

Stale copy-pasted snippets are the most common failure. Map them directly:

| Old or wrong                          | v5 replacement                                           |
| ------------------------------------- | -------------------------------------------------------- |
| `chart.addLineSeries(options)`        | `chart.addSeries(LineSeries, options)`                   |
| `chart.addCandlestickSeries(options)` | `chart.addSeries(CandlestickSeries, options)`            |
| `series.setMarkers(markers)`          | `createSeriesMarkers(series, markers)`                   |
| chart `watermark` option              | `createTextWatermark(chart.panes()[0], options)`         |
| `createImageWatermark(pane, options)` | `createImageWatermark(pane, imageUrl, options)`          |
| `IPanePrimitivePaneRenderer`          | `IPrimitivePaneRenderer`                                 |
| `timeScale: { timezone }`             | label formatters using `Intl.DateTimeFormat`             |
| `time: Date.now()` (ms)               | `time: Math.floor(Date.now() / 1000)` for `UTCTimestamp` |

## Routing map (problem → where to look)

Use local typings first. The repo paths below exist only in the upstream `lightweight-charts`
checkout; in a consumer app, translate them to the installed package typings or official docs.

| Task                                       | Canonical sources                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| First chart / series                       | `website/docs/intro.mdx`, `website/tutorials/customization/`                                                                        |
| Time / range behavior                      | `website/docs/time-scale.md`, `website/docs/time-zones.md`                                                                          |
| Realtime / history                         | `website/tutorials/demos/realtime-updates.{mdx,js}`, `website/tutorials/demos/infinite-history.{mdx,js}`                            |
| Whitespace / gaps                          | `website/tutorials/demos/whitespace.{mdx,js}`                                                                                       |
| Price format / locale                      | `website/tutorials/customization/price-format.mdx`, `website/tutorials/demos/custom-locale.{mdx,js}`                                |
| Two scales / inverted                      | `website/tutorials/how_to/two-price-scales.{mdx,js}`, `website/tutorials/how_to/inverted-price-scale.{mdx,js}`                      |
| Panes / price + volume                     | `website/docs/panes.md`, `website/tutorials/how_to/panes.{mdx,js}`, `website/tutorials/how_to/price-and-volume.{mdx,js}`            |
| Markers / tooltips / legends               | `website/tutorials/how_to/series-markers.{mdx,js}`, `website/tutorials/how_to/tooltips.mdx`, `website/tutorials/how_to/legends.mdx` |
| Crosshair (programmatic)                   | `website/tutorials/how_to/set-crosshair-position*.js`                                                                               |
| Watermarks                                 | `website/tutorials/how_to/watermark.mdx`                                                                                            |
| Plugins / custom series / primitives       | `website/docs/plugins/`, `plugin-examples/src/plugins/`                                                                             |
| Coordinate conversion / hit-testing        | `dist/typings.d.ts` for `subscribeClick`, `coordinateToPrice`, `timeScale().coordinateToLogical`                                    |
| Non-time horizontal scales / options chart | `dist/typings.d.ts` for `createOptionsChart`, `createChartEx`, `IHorzScaleBehavior`                                                 |
| Pixel-perfect rendering                    | `website/docs/plugins/pixel-perfect-rendering/`                                                                                     |
| React / Vue / Web Components               | `website/tutorials/react/`, `website/tutorials/vuejs/`, `website/tutorials/webcomponents/`                                          |
| SSR / script loading / bundlers            | installed package `dist/` files, package `exports`, framework docs for client-only components                                       |
| iOS / Android wrappers                     | `website/docs/ios.md`, `website/docs/android.md`                                                                                    |
| Version migration                          | `website/docs/migrations/from-v2-to-v3.md`, `from-v3-to-v4.md`, `from-v4-to-v5.md`                                                  |

If these repo paths do not exist in the user's project, do not ask them to create or clone the
source tree just to answer a normal usage question. Use
`node_modules/lightweight-charts/dist/typings.d.ts` and concise v5 examples.

## Foot-guns (assertions, not categories)

### Time

- **`UTCTimestamp` is in seconds.** Use `Math.floor(Date.now() / 1000)`, never `Date.now()`.
- **There is no built-in `timeScale.timezone` option.** For display-only timezone conversion, use
  `timeScale.tickMarkFormatter` for axis labels and `localization.timeFormatter` (or your own
  tooltip formatter) for crosshair/hover labels. Use `Intl.DateTimeFormat(..., { timeZone })`,
  Luxon, or date-fns-tz for DST-safe IANA timezone formatting.
- **Pre-shifting timestamps changes chart semantics.** It can make ticks line up in a chosen
  timezone, but it also changes where bars sit on the UTC time scale. Prefer formatter-based display
  unless the user intentionally wants shifted data.
- **Series data must be strictly ascending by `time`, with unique values.** Do not rely on duplicate
  replacement in `setData`; validate full arrays before passing them to the library. Use `update` to
  replace the latest point.
- **One time format per series.** `BusinessDay` (`'YYYY-MM-DD'` string or `{ year, month, day }`) or
  `UTCTimestamp`, but do not mix within a single series.
- **Whitespace points carry `time` only** (no `value` / `open` / …). Use them to create gaps or
  align overlays; do not set values to `null`.
- **`setData` replaces the dataset and can reset the visible range. `update(point)` appends if
  `time > last` and replaces if `time === last`.** `update(point, true)` can update an existing
  historical point, but it is slower and does not insert missing old points. To prepend older
  history, build a new array and call `setData` again — there is no prepend method; save and restore
  the visible logical range to avoid the chart snapping.
- **`timeScale.setVisibleLogicalRange` is logical (bar indices), not time-based.** Use
  `setVisibleRange` for time bounds, or `fitContent()` to reset.

### Scales and panes

- **Two visible price scales** requires both assigning series with `priceScaleId: 'right'` /
  `'left'` and making the left scale visible. Use
  `chart.applyOptions({ leftPriceScale: { visible: true }, rightPriceScale: { visible: true } })` or
  `chart.priceScale('left').applyOptions({ visible: true })`.
- **Overlay series** (`priceScaleId: ''` or any custom id) get an autoscaled, hidden scale by
  default. Use the visible left or right scale if you need axis labels; do not assume a custom
  overlay scale can display an axis.
- **`autoscaleInfoProvider` runs on every layout pass.** Keep it cheap; do not allocate per call.
- **`addSeries(_, _, paneIndex)` creates the pane** if `paneIndex` is one past the current count.
  Pane order is creation order; sizes are controlled via `chart.panes()[i].setHeight(px)`.
- **Keep pane references if panes can move.** `const mainPane = chart.panes()[0]` remains the same
  `IPaneApi`; `mainPane.paneIndex()` gives its current index after `swapPanes` or moves.
- **Sync separate charts with public time-scale events.** Use `subscribeVisibleLogicalRangeChange`
  and `setVisibleLogicalRange`; avoid `_private__chartWidget`, `paneWidgets`, or DOM offset hacks.
- **Read scale width with `width()`.** Use the scale option `minimumWidth` to reserve room when
  aligning charts; the final rendered width can be larger.

### Markers and interaction

- **v5 markers are a primitive.**
  `const m = createSeriesMarkers(series, [...]); m.setMarkers([...])`. `series.setMarkers` does not
  exist on `ISeriesApi` in v5.
- **Use existing bar times for predictable marker placement.** In v5.2, marker indexing can use
  nearest-bar lookup; a mismatched time is not guaranteed to be dropped.
- **`subscribeCrosshairMove`** fires with `param.time === undefined` outside the data range. Always
  null-check before reading.
- **`param.seriesData.get(series)`** returns `undefined` between bars or before the first bar.
- **Click/crosshair coordinates need API conversion.** Use `series.coordinateToPrice(y)` /
  `series.priceToCoordinate(price)` and `chart.timeScale().coordinateToLogical(x)` /
  `logicalToCoordinate(logical)` / `timeToCoordinate(time)`; do not infer price/time from canvas DOM
  geometry.

### Plugins and custom rendering

- **Start plugins from the scaffold/examples.** Prefer `npm create lwc-plugin@latest` and
  `plugin-examples/` before writing a primitive from scratch.
- **Interactive drawing tools need two parts:** a primitive/custom series for rendering, and chart
  interaction handlers (`subscribeClick`, `subscribeCrosshairMove`, drag state) that convert
  coordinates with public APIs.
- **`CanvasRenderingTarget2D` is imported from `fancy-canvas`,** not from `lightweight-charts`.
- Use `target.useBitmapCoordinateSpace(scope => …)` for pixel-aligned strokes; use
  `target.useMediaCoordinateSpace(scope => …)` for CSS-pixel logic. Mixing them causes blur or
  sub-pixel jitter on HiDPI displays.
- **`IPanePrimitive` views render across the whole pane; `ISeriesPrimitive` views are clipped to the
  series.** Pick the right base.
- **The renderer interface is `IPrimitivePaneRenderer`, not `IPanePrimitivePaneRenderer`.** The view
  is `IPanePrimitivePaneView` and its `renderer()` returns `IPrimitivePaneRenderer | null` — the
  names are deliberately asymmetric. There is no `IPanePrimitivePaneRenderer` export; grep
  `dist/typings.d.ts` if unsure.
- **`ICustomSeriesPaneView` is heavier than a primitive** — only use it when you need a true series
  API (data, scales, autoscale). For decorations, use a primitive.

### Wrappers (React/Vue/etc.)

- **Create the chart once** in `useEffect` / `onMounted` and destroy it in cleanup with
  `chart.remove()`. Recreating on every render duplicates DOM and leaks listeners.
- **Resize can be automatic in v5** with `autoSize: true` when `ResizeObserver` is available. If you
  need manual control, subscribe a `ResizeObserver` to the container and call
  `chart.resize(width, height)` (or `applyOptions({ width, height })`).
- **Don't drive `setData` from props on every render.** Use `series.update(...)` for incremental
  changes; only call `setData` when the dataset truly replaces.
- **Next.js/SSR must be client-only.** Put chart code in a `'use client'` component, create it in
  `useEffect`, and import that component with `next/dynamic(..., { ssr: false })` from a Client
  Component when needed; a Server Component can render that client wrapper.
- **Plain HTML is not npm resolution.** The standalone `.js` build exposes
  `window.LightweightCharts`; ESM in the browser must import an actual `.mjs` URL or use an import
  map. `import { createChart } from 'lightweight-charts'` only works when a bundler/runtime resolves
  the package name.

## Recipe reference

Read [Canonical recipes](guide/recipes.md) (MiniAppGuide page "recipes") for the relevant
implementation only: realtime updates, scales, panes, markers, timezone labels, watermarks,
synchronization, coordinates, Next.js, HTML loading, custom plugins, and non-financial axes. Check
its example against the installed version before copying; examples assume the surrounding chart,
container, and data unless shown explicitly.

## Worked example

> _"My chart snaps to the right edge every time new data arrives."_

1. **Layers involved:** data model (4) and time scale (3).
2. **Suspect:** the code calls `series.setData(...)` on every tick instead of `series.update(...)`.
   `setData` can change the visible range depending on the dataset and scale options.
3. **Verify:** ask whether the call path is `setData` or `update`. If `setData`, ask whether the
   visible logical range is captured before and restored after — the v4-era workaround.
4. **Fix:** switch to `series.update(bar)` for incremental ticks; reserve `setData` for full-history
   replacement; only use `chart.timeScale().scrollToRealTime()` if the user explicitly wants
   follow-the-latest behavior.
5. **References:** `website/tutorials/demos/realtime-updates.js`, `website/docs/time-scale.md`.

## Code-generation rules

- **Default to v5.** Assume v5 APIs unless the user's installed package or prompt pins an older
  version. If they're on v4, explain the v5 migration point instead of mixing syntaxes.
- **Use real option names.** In consumer apps, grep
  `node_modules/lightweight-charts/dist/typings.d.ts`; in the upstream repo, grep
  `dist/typings.d.ts` or `src/api/options/`. Many similarly-named options exist across
  chart/series/scale — confirm which level owns the option.
- **Minimal snippets.** One feature per code block. Combining markers + watermark + custom pane
  primitive in one snippet hides which API does what.
- **Match the user's framework.** A React user wants the `useEffect` lifecycle; a vanilla user does
  not.
- **Don't invent.** If an API name does not appear in the installed typings or upstream source, it
  does not exist.

## Answer contract

When answering a lightweight-charts question:

1. Name the relevant v5 API.
2. Show one minimal snippet, not a mega-demo.
3. Call out the main foot-gun for that task.
4. Say what local source was checked (version/typings), or state that it could not be verified.

## Source references

- [v5.2 marker placement](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/plugins/series-markers/primitive.ts)
- [Price-scale options](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/PriceScaleOptions)
- [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading)

The local Trading dependency was checked at 5.2.0. Recheck the installed version for another
project.
