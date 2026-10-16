/** The Mermaid configuration a diagram is drawn with, and the identity it is cached under. */
export interface MermaidLook {
  key: string
  config: Record<string, unknown>
}

/**
 * Mermaid's own themes (`dark`, `neutral`) are fixed palettes: grey boxes and a grey label slab
 * that matched no theme of this app and clashed outright with a tinted one. So the diagram is
 * drawn with Mermaid's `base` theme, fed from the same tokens the transcript is painted with.
 *
 * Mermaid derives its shades with a colour library that cannot read `oklch()` or `color-mix()`,
 * which is how every token here is written. Each token is therefore resolved by the browser (a
 * probe element) and rasterized to sRGB hex on a 1×1 canvas. A "veil" — the foreground at a few
 * percent over the ground, the system's recipe for fills — is composited on that canvas too,
 * over `--background-solid`, since Mermaid needs an opaque colour where the app uses alpha.
 */
export function resolveMermaidLook(theme: 'dark' | 'light'): MermaidLook {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.append(probe)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })

  const computed = (token: string) => {
    probe.style.color = `var(${token})`
    return getComputedStyle(probe).color
  }
  /** `color` at `alpha` over the opaque `base`, as hex. */
  const over = (base: string, color: string, alpha = 1): string => {
    if (!context) return color
    context.globalAlpha = 1
    context.fillStyle = base
    context.fillRect(0, 0, 1, 1)
    context.globalAlpha = alpha
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  }
  // The ground a diagram actually sits on is `--background`: a tinted palette sets it and leaves
  // `--background-solid` (the near-black fallback) alone, and compositing over that fallback drew
  // black nodes on a navy transcript. It may carry alpha (glass), so it is laid over the solid
  // fallback once, and every veil below is mixed over that result.
  const ground = over(computed('--background-solid'), computed('--background'))
  const paint = (color: string, alpha = 1) => over(ground, color, alpha)
  const token = (name: string) => paint(computed(name))
  const fgColor = computed('--foreground')
  const veil = (alpha: number) => paint(fgColor, alpha)

  const bg = ground
  const fg = token('--foreground')
  const soft = token('--text-soft')
  const faint = token('--text-faint')
  const border = token('--border')
  const strong = token('--border-strong')
  const node = veil(0.06)
  const charts = Array.from({ length: 8 }, (_, index) => token(`--chart-${index + 1}`))
  const fontFamily = getComputedStyle(document.body).fontFamily
  probe.remove()

  const themeVariables = {
    darkMode: theme === 'dark',
    background: bg,
    fontFamily,
    fontSize: '13px',
    primaryColor: node,
    primaryTextColor: fg,
    // The fill already separates a node from the ground; the outline only has to hold its edge,
    // so it takes the ordinary border step rather than the strong one.
    primaryBorderColor: border,
    secondaryColor: veil(0.1),
    secondaryTextColor: fg,
    secondaryBorderColor: border,
    tertiaryColor: veil(0.03),
    tertiaryTextColor: fg,
    tertiaryBorderColor: border,
    lineColor: faint,
    textColor: fg,
    titleColor: fg,
    edgeLabelBackground: bg,
    clusterBkg: veil(0.03),
    clusterBorder: border,
    noteBkgColor: node,
    noteTextColor: fg,
    noteBorderColor: border,
    actorBkg: node,
    actorBorder: border,
    actorTextColor: fg,
    actorLineColor: border,
    signalColor: soft,
    signalTextColor: fg,
    labelBoxBkgColor: node,
    labelBoxBorderColor: border,
    labelTextColor: fg,
    loopTextColor: soft,
    activationBkgColor: veil(0.1),
    activationBorderColor: strong,
    sequenceNumberColor: bg,
    ...Object.fromEntries(charts.map((color, index) => [`pie${index + 1}`, color])),
    // Radar, treemap, mindmap and timeline use cScale, while git graphs use gitN. Leaving those
    // derived from neutral node fills gave data series indistinguishable grey colours.
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`cScale${i}`, charts[i % charts.length]]),
    ),
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`cScaleLabel${i}`, fg])),
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [
        `cScalePeer${i}`,
        paint(charts[i % charts.length], 0.16),
      ]),
    ),
    ...Object.fromEntries(charts.map((color, index) => [`git${index}`, color])),
    ...Object.fromEntries(charts.map((_, index) => [`gitBranchLabel${index}`, bg])),
    ...Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`quadrant${i + 1}Fill`, veil(0.03 + i * 0.02)]),
    ),
    ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`quadrant${i + 1}TextFill`, soft])),
    quadrantPointFill: charts[0],
    quadrantPointTextFill: fg,
    quadrantXAxisTextFill: soft,
    quadrantYAxisTextFill: soft,
    radar: {
      axisColor: border,
      axisLabelFontSize: 13,
      axisStrokeWidth: 1,
      graticuleColor: border,
      graticuleOpacity: 0.15,
      graticuleStrokeWidth: 1,
      curveOpacity: 0.14,
      curveStrokeWidth: 2,
      legendBoxSize: 10,
      legendFontSize: 13,
    },
    pieStrokeColor: bg,
    pieOuterStrokeColor: border,
    pieTitleTextColor: fg,
    pieSectionTextColor: bg,
    pieLegendTextColor: soft,
    xyChart: {
      // Mermaid paints this as a plot-sized slab; transparent lets the transcript show through.
      backgroundColor: 'transparent',
      titleColor: fg,
      xAxisLabelColor: soft,
      xAxisTitleColor: soft,
      xAxisTickColor: border,
      xAxisLineColor: border,
      yAxisLabelColor: soft,
      yAxisTitleColor: soft,
      yAxisTickColor: border,
      yAxisLineColor: border,
      plotColorPalette: charts.join(','),
    },
  }
  const config = {
    theme: 'base',
    // SVG labels avoid HTML measurement frames whose temporary 2000px boxes can enter layout.
    // The same vector geometry works in a transcript, an embedded board and the canvas viewer.
    htmlLabels: false,
    themeVariables,
    flowchart: { htmlLabels: false, curve: 'basis', padding: 12, nodeSpacing: 36, rankSpacing: 44 },
    sequence: { mirrorActors: false, messageFontSize: 13, actorFontSize: 13, noteFontSize: 12 },
  }
  // Keyed by the resolved colours, not the theme name: a palette change repaints every diagram
  // even when "dark" stays "dark".
  return { key: JSON.stringify(themeVariables), config }
}
