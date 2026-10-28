# Lightweight Charts recipes

Return to the [guide](../guide.md) for version checks and API selection. These snippets illustrate
one feature at a time; supply their surrounding chart, data, and container.

### Realtime updates

```ts
import { createChart, CandlestickSeries } from 'lightweight-charts'

const chart = createChart(container, {})
const series = chart.addSeries(CandlestickSeries, {})
series.setData(initialBars) // full history once

ws.onmessage = (ev) => {
  const bar = JSON.parse(ev.data) // { time, open, high, low, close }
  series.update(bar) // appends if time > last; replaces if time === last
}
```

`update(point)` handles the latest bar by default. `update(point, true)` can replace an existing
historical point, at a higher cost. To insert missing historical points or prepend, rebuild the
array and call `setData`.

### Two price scales (left + right)

```ts
const right = chart.addSeries(LineSeries, { priceScaleId: 'right' })
const left = chart.addSeries(LineSeries, { priceScaleId: 'left' })
chart.applyOptions({
  leftPriceScale: { visible: true },
  rightPriceScale: { visible: true },
})
```

### Volume in its own pane

```ts
const price = chart.addSeries(CandlestickSeries, {}, 0)
const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' } }, 1)
chart.panes()[1].setHeight(120)
```

### Per-bar / per-point colors

Color individual bars by putting the color on the **data point**, not via a separate API:

```ts
import type { UTCTimestamp } from 'lightweight-charts'

// Candlesticks: per-point color / borderColor / wickColor override series defaults
candles.setData([
  {
    time: 1700000000 as UTCTimestamp,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    color: '#26a69a',
    borderColor: '#26a69a',
    wickColor: '#26a69a',
  },
  {
    time: 1700003600 as UTCTimestamp,
    open: 1.5,
    high: 1.8,
    low: 1.1,
    close: 1.2,
    color: '#ef5350',
    borderColor: '#ef5350',
    wickColor: '#ef5350',
  },
])

// Histogram (e.g. up/down volume): per-point color
volume.setData([
  { time: 1700000000 as UTCTimestamp, value: 100, color: 'rgba(38,166,154,0.5)' },
  { time: 1700003600 as UTCTimestamp, value: 80, color: 'rgba(239,83,80,0.5)' },
])
```

Line/Area points also take a per-point `color`. An omitted point color falls back to the series
option. Do not create extra series or use markers to recolor bars.

### Series markers

```ts
import { createSeriesMarkers } from 'lightweight-charts'
import type { UTCTimestamp } from 'lightweight-charts'

const markers = createSeriesMarkers(candles, [
  {
    time: 1700000000 as UTCTimestamp,
    position: 'aboveBar',
    color: '#e53935',
    shape: 'arrowDown',
    text: 'Sell',
  },
])

markers.setMarkers([
  {
    time: 1700003600 as UTCTimestamp,
    position: 'belowBar',
    color: '#43a047',
    shape: 'arrowUp',
    text: 'Buy',
  },
])
```

`color`, `position`, `shape`, and `time` are required. `text`, `size`, and `id` are optional.
`price` is required for `atPriceTop`, `atPriceBottom`, and `atPriceMiddle`; bar-relative positions
(`aboveBar`, `belowBar`, `inBar`) do not require it. Do not put marker objects into `setData()`
points. Do not call `series.setMarkers(...)` in v5.

### Timezone display

```ts
import { TickMarkType } from 'lightweight-charts'
import type { Time } from 'lightweight-charts'

const clock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const formatTime = (time: Time): string => {
  if (typeof time === 'number') return clock.format(new Date(time * 1000))
  if (typeof time === 'string') return time
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
}

chart.applyOptions({
  timeScale: {
    timeVisible: true,
    secondsVisible: true,
    tickMarkFormatter: (time: Time, kind: TickMarkType) =>
      typeof time === 'number' &&
      (kind === TickMarkType.Time || kind === TickMarkType.TimeWithSeconds)
        ? formatTime(time)
        : null,
  },
  localization: { timeFormatter: formatTime },
})
```

Keep date-level axis labels with the default formatter (`null`) rather than turning years and months
into clock times. Business-day values remain calendar dates, not timezone-shifted instants.

Do not invent `timeScale: { timezone: 'America/New_York' }`. If the user needs exchange-session
boundaries to generate in a local timezone, explain the trade-off of shifting source timestamps
separately from display formatting.

### Text watermark

```ts
import { createTextWatermark } from 'lightweight-charts'

createTextWatermark(chart.panes()[0], {
  horzAlign: 'center',
  vertAlign: 'center',
  lines: [{ text: 'DEMO', color: 'rgba(0, 0, 0, 0.25)', fontSize: 48 }],
})
```

The old `watermark` chart option is not the v5 API.

### Whitespace gaps

```ts
line.setData([
  { time: '2024-01-01', value: 10 },
  { time: '2024-01-02' }, // whitespace point: time only
  { time: '2024-01-03', value: 12 },
])
```

Do not use `value: null`, `undefined`, or `NaN` to create gaps.

### Sync separate charts or panes

```ts
let syncing = false

priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
  if (!range || syncing) return
  syncing = true
  try {
    indicatorChart.timeScale().setVisibleLogicalRange(range)
  } finally {
    syncing = false
  }
})

indicatorChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
  if (!range || syncing) return
  syncing = true
  try {
    priceChart.timeScale().setVisibleLogicalRange(range)
  } finally {
    syncing = false
  }
})
```

Logical indices align only when the charts share the same ordered time points. For different
datasets, synchronize visible time ranges instead and handle unavailable endpoints. Keep named
callbacks in a mounted wrapper and unsubscribe them during teardown.

For v5 panes inside one chart, prefer `chart.addSeries(SeriesType, options, paneIndex)` and
`chart.panes()[i].setHeight(px)`. If the original pane can move, keep the `IPaneApi` reference and
call `pane.paneIndex()` instead of assuming index `0` forever.

### Coordinate conversion

```ts
chart.subscribeClick((param) => {
  if (!param.point || param.time === undefined) return
  if (param.paneIndex !== series.getPane().paneIndex()) return

  const price = series.coordinateToPrice(param.point.y)
  const logical = chart.timeScale().coordinateToLogical(param.point.x)
  if (price === null || logical === null) return

  // Store { time: param.time, price } or convert logical back later:
  const x = chart.timeScale().logicalToCoordinate(logical)
  const y = series.priceToCoordinate(price)
})
```

Use the public conversion APIs for drawing tools and annotations. DOM canvas coordinates alone
cannot tell you the chart price/time.

### Next.js client-only component

```tsx
'use client'

import { createChart, LineSeries } from 'lightweight-charts'
import type { ISeriesApi, LineData, Time } from 'lightweight-charts'
import { useEffect, useRef } from 'react'

export function LwcChart({ data }: { data: LineData<Time>[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = createChart(ref.current, { autoSize: true })
    const series = chart.addSeries(LineSeries)
    seriesRef.current = series
    return () => {
      seriesRef.current = null
      chart.remove()
    }
  }, [])

  useEffect(() => {
    seriesRef.current?.setData(data)
  }, [data])

  return <div ref={ref} style={{ width: '100%', height: 320 }} />
}
```

For App Router, place the dynamic import in a separate Client Component; a Server Component can
render this wrapper. `ssr: false` is not supported directly in a Server Component:

```tsx
'use client'

import dynamic from 'next/dynamic'

const LwcChart = dynamic(() => import('./LwcChart').then((m) => m.LwcChart), {
  ssr: false,
})

export default LwcChart
```

### Plain HTML loading

Use the standalone IIFE build when there is no bundler:

```html
<div id="chart" style="width: 600px; height: 300px"></div>
<script src="https://unpkg.com/lightweight-charts@5.2.0/dist/lightweight-charts.standalone.production.js"></script>
<script>
  const chart = LightweightCharts.createChart(document.getElementById('chart'))
  const series = chart.addSeries(LightweightCharts.LineSeries)
</script>
```

Choose the loading shape by environment:

- **Bundler (Vite/webpack/Next):** bare `import { createChart } from 'lightweight-charts'`. The
  package `exports` select its ESM build; the installed 5.2.0 package is ESM-only.
- **Browser `<script>` (no bundler):** the standalone IIFE build above exposes the
  `LightweightCharts` global; there is no bare-specifier resolution.
- **Browser native ESM (`<script type="module">`):** import from a concrete `.mjs` URL (e.g. the
  standalone `.mjs`) or add an import map; a bare `'lightweight-charts'` specifier will not resolve.
- **SSR frameworks:** load client-only (see the Next.js recipe above) — never import at module top
  level in a server component.

### Plugin starter

```sh
npm create lwc-plugin@latest
```

Use the generated project and `plugin-examples/` as the base. Decide the extension type first:

- **Primitive** (`IPanePrimitive` / `ISeriesPrimitive`, attached via `attachPrimitive`) — for
  drawings, overlays, labels, bands, annotations, hit-testing. This is the default; reach for it
  unless you need real series behavior.
- **Custom series** (`ICustomSeriesPaneView`) — only when the extension needs its own data,
  autoscale, or price/time-scale integration. It is heavier; do not use it for decorations.

For draggable drawings, attach a primitive with `series.attachPrimitive(...)` or
`pane.attachPrimitive(...)`, then manage interaction with `subscribeClick` /
`subscribeCrosshairMove` and coordinate conversion APIs. Import renderer-only
`CanvasRenderingTarget2D` from `fancy-canvas`. The renderer interface is `IPrimitivePaneRenderer`
(not `IPanePrimitivePaneRenderer`).

### Non-financial data

```ts
import { createOptionsChart } from 'lightweight-charts'

const chart = createOptionsChart(container)
```

Decide first whether the horizontal axis is truly non-time:

- **True custom horizontal scale** (option chains, sensor sweeps by a non-time key): use
  `createOptionsChart` for a numeric x-axis, or `createChartEx` with a custom `IHorzScaleBehavior`
  (verify both in local typings).
- **Just non-financial y units** (temperature, load) on an ordinary time/category axis: keep the
  normal `createChart` series model and set `priceFormat` / `localization.priceFormatter` so labels
  match the domain.
- **Categorical x that is really ordered**: mapping categories to ascending `BusinessDay` strings is
  simpler than a custom scale — but say that the axis is then date-like, not truly categorical.

### Custom price formatter

```ts
chart.applyOptions({
  localization: {
    priceFormatter: (p: number) => `$${p.toFixed(2)}`,
  },
})
```

For per-series formatting, set `priceFormat: { type: 'custom', formatter, minMove }` in the series
options — the chart-level `priceFormatter` is the fallback.

### Minimal pane primitive

```ts
import type {
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'

class Overlay implements IPanePrimitive<Time> {
  paneViews(): IPanePrimitivePaneView[] {
    return [new View()]
  }
}
class View implements IPanePrimitivePaneView {
  renderer(): IPrimitivePaneRenderer {
    return new Renderer()
  }
}
class Renderer implements IPrimitivePaneRenderer {
  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.fillStyle = 'rgba(0,0,0,0.05)'
      context.fillRect(0, 0, mediaSize.width, mediaSize.height)
    })
  }
}

chart.panes()[0].attachPrimitive(new Overlay())
```

Working examples live under `plugin-examples/src/plugins/` — copy structure from there before
writing one from scratch.
