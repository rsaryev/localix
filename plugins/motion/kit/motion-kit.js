/*
 * Localix Motion Kit — seek-safe building blocks for HyperFrames compositions.
 *
 * Every helper ADDS tweens to a paused GSAP timeline you pass in, at a position you choose. It
 * never plays anything, never reads a clock and never uses unseeded randomness, so any frame
 * renders the same in preview, snapshot and render. Build the end state in HTML/CSS, then call
 * these to animate into it. Prepare DOM (splitting, measuring) inside document.fonts.ready and
 * register the timeline only after every tween is added.
 *
 *   const tl = gsap.timeline({ paused: true })
 *   MK.revealLines(tl, '#hook-title', 0.2)
 *   window.__timelines['hook'] = tl
 */
;(function () {
  const q = (target, scope) =>
    typeof target === 'string' ? (scope || document).querySelector(target) : target
  const qa = (target, scope) =>
    typeof target === 'string' ? [...(scope || document).querySelectorAll(target)] : [target]

  /** A style knob from blocks/style.css (CSS custom property on :root). */
  const knob = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

  /**
   * The film's curves, set by its style (--mk-ease-*). enter: hero arrivals and line reveals;
   * soft: UI-scale arrivals; move: between two rests; exit: leave faster than you arrive; pop: one
   * landing per scene at most; drift: continuous camera drift.
   */
  const ease = {
    get enter() {
      return knob('--mk-ease-enter', 'expo.out')
    },
    get soft() {
      return knob('--mk-ease-soft', 'power3.out')
    },
    get move() {
      return knob('--mk-ease-move', 'power2.inOut')
    },
    get exit() {
      return knob('--mk-ease-exit', 'power3.in')
    },
    get pop() {
      return knob('--mk-ease-pop', 'back.out(1.6)')
    },
    drift: 'none',
  }
  /** Seconds scaled by the style's tempo (--mk-tempo): `MK.dur(0.8)`. */
  const dur = (seconds) => seconds * (Number(knob('--mk-tempo', '1')) || 1)

  /**
   * Clips are display:none until their time, and the runtime seeks before it shows them, so
   * layout must be read at BUILD time. `withLayout` lays out the hidden ancestors invisibly for the
   * duration of `read`, then restores them. Measure with offsets (`offsetWithin`), which ignore the
   * transforms that `fromTo` tweens apply immediately.
   */
  function withLayout(target, read) {
    const restored = []
    for (let node = q(target); node && node !== document.documentElement; node = node.parentElement)
      if (getComputedStyle(node).display === 'none') {
        restored.push([node, node.style.display, node.style.visibility])
        node.style.display = 'block'
        node.style.visibility = 'hidden'
      }
    try {
      return read()
    } finally {
      for (const [node, display, visibility] of restored) {
        node.style.display = display
        node.style.visibility = visibility
      }
    }
  }
  /** Position of `el`'s top-left inside `ancestor`, in untransformed CSS pixels. */
  function offsetWithin(target, ancestor) {
    let x = 0
    let y = 0
    const stop = q(ancestor)
    for (let node = q(target); node && node !== stop; node = node.offsetParent) {
      x += node.offsetLeft
      y += node.offsetTop
      if (node.offsetParent && !stop.contains(node.offsetParent)) break
    }
    const el = q(target)
    return { x, y, width: el.offsetWidth, height: el.offsetHeight }
  }

  /** Seeded PRNG (mulberry32): random-looking but identical on every render. */
  function random(seed) {
    let s = 2166136261
    if (typeof seed === 'number') s = seed >>> 0
    else
      for (let i = 0; i < String(seed).length; i++)
        s = Math.imul(s ^ String(seed).charCodeAt(i), 16777619)
    return () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** Wrap words (and optionally characters) of a text element in spans. Idempotent. */
  function split(target, by = 'words') {
    const el = q(target)
    if (!el) throw new Error(`MK.split: ${target} not found`)
    if (el.dataset.mkSplit === by) return el
    const text = el.dataset.mkText || el.textContent.trim().replace(/\s+/g, ' ')
    el.dataset.mkText = text
    el.dataset.mkSplit = by
    el.textContent = ''
    text.split(' ').forEach((word, index, words) => {
      const w = document.createElement('span')
      w.className = 'mk-word'
      if (by === 'chars')
        for (const char of word) {
          const c = document.createElement('span')
          c.className = 'mk-char'
          c.textContent = char
          w.append(c)
        }
      else w.textContent = word
      if (index < words.length - 1) w.classList.add('mk-spaced')
      el.append(w)
    })
    return el
  }

  /** Group split words into measured lines, each inside an overflow mask. Call after fonts load. */
  function splitLines(target) {
    return withLayout(target, () => splitLinesNow(target))
  }
  function splitLinesNow(target) {
    const el = split(target, 'words')
    if (el.dataset.mkLines) return [...el.querySelectorAll('.mk-line-inner')]
    const words = [...el.querySelectorAll('.mk-word')]
    const rows = []
    for (const word of words) {
      const top = Math.round(word.offsetTop)
      const row = rows.at(-1)
      if (row && Math.abs(row.top - top) < 4) row.words.push(word)
      else rows.push({ top, words: [word] })
    }
    el.textContent = ''
    el.dataset.mkLines = String(rows.length)
    return rows.map((row) => {
      const mask = document.createElement('span')
      mask.className = 'mk-line'
      // Lines wait below their mask before the reveal: intended overflow, not a layout bug.
      mask.setAttribute('data-layout-allow-overflow', '')
      const inner = document.createElement('span')
      inner.className = 'mk-line-inner'
      inner.textContent = row.words.map((w) => w.textContent).join(' ')
      mask.append(inner)
      el.append(mask)
      return inner
    })
  }

  /** Editorial line reveal: each line rises out of its own mask. 0.8 s per line, 0.22 s apart. */
  function revealLines(tl, target, at = 0, o = {}) {
    const lines = splitLines(target)
    const duration = o.duration ?? dur(0.85)
    const stagger = o.stagger ?? 0.22
    tl.fromTo(
      lines,
      { yPercent: 110 },
      { yPercent: 0, duration, ease: o.ease ?? ease.enter, stagger },
      at,
    )
    if (o.exitAt !== undefined)
      tl.to(
        lines,
        { yPercent: -110, duration: duration * 0.6, ease: ease.exit, stagger: stagger * 0.5 },
        o.exitAt,
      )
    return lines
  }

  /** Words fade up one by one (80–120 ms apart). */
  function revealWords(tl, target, at = 0, o = {}) {
    const words = [...split(target, 'words').querySelectorAll('.mk-word')]
    tl.fromTo(
      words,
      { opacity: 0, y: '0.35em' },
      {
        opacity: 1,
        y: 0,
        duration: o.duration ?? dur(0.6),
        ease: o.ease ?? ease.enter,
        stagger: o.stagger ?? 0.09,
      },
      at,
    )
    return words
  }

  /** Characters land one by one (30–50 ms apart); short words only. `seed` scrambles the order. */
  function revealChars(tl, target, at = 0, o = {}) {
    const chars = [...split(target, 'chars').querySelectorAll('.mk-char')]
    const ordered = [...chars]
    if (o.seed !== undefined) {
      const rng = random(o.seed)
      for (let i = ordered.length - 1; i > 0; i--) {
        const k = Math.floor(rng() * (i + 1))
        ;[ordered[i], ordered[k]] = [ordered[k], ordered[i]]
      }
    }
    tl.fromTo(
      ordered,
      { opacity: 0, y: '0.5em', rotate: o.rotate ?? 0 },
      {
        opacity: 1,
        y: 0,
        rotate: 0,
        duration: o.duration ?? dur(0.55),
        ease: o.ease ?? ease.enter,
        stagger: o.stagger ?? 0.035,
      },
      at,
    )
    return chars
  }

  /**
   * Typed text by string slicing (the caret follows the text), with a smooth caret blink. Add an
   * element with class `mk-caret` after the text element to show the caret.
   */
  function typewriter(tl, target, at = 0, o = {}) {
    const el = q(target)
    const text = el.dataset.mkText || el.textContent
    el.dataset.mkText = text
    const cps = o.cps ?? 24
    const state = { count: 0 }
    el.textContent = ''
    tl.to(
      state,
      {
        count: text.length,
        duration: text.length / cps,
        ease: 'none',
        onUpdate: () => (el.textContent = text.slice(0, Math.round(state.count))),
      },
      at,
    )
    return el
  }

  /** A number rolling up to its value, with tabular figures. */
  function counter(tl, target, at = 0, o = {}) {
    const el = q(target)
    const to = o.to ?? Number(el.dataset.value ?? el.textContent.replace(/[^\d.-]/g, ''))
    const decimals = o.decimals ?? 0
    const format = (v) =>
      `${o.prefix ?? ''}${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${o.suffix ?? ''}`
    const state = { v: o.from ?? 0 }
    el.textContent = format(state.v)
    tl.to(
      state,
      {
        v: to,
        duration: o.duration ?? dur(1.4),
        ease: o.ease ?? 'power3.out',
        onUpdate: () => (el.textContent = format(state.v)),
      },
      at,
    )
    return el
  }

  /** Cycle words in place inside a stable-width slot (no layout jump). */
  function wordCarousel(tl, target, words, at = 0, o = {}) {
    const el = q(target)
    const hold = o.hold ?? 1.1
    const move = o.duration ?? dur(0.45)
    el.textContent = ''
    el.classList.add('mk-carousel')
    const items = words.map((word) => {
      const span = document.createElement('span')
      span.className = 'mk-carousel-item'
      span.textContent = word
      el.append(span)
      return span
    })
    el.style.width = `${withLayout(el, () => Math.max(...items.map((i) => i.offsetWidth)))}px`
    items.forEach((item, index) => {
      const start = at + index * (hold + move)
      tl.fromTo(
        item,
        { yPercent: 100, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: move, ease: ease.enter },
        start,
      )
      if (index < items.length - 1)
        tl.to(
          item,
          { yPercent: -100, opacity: 0, duration: move, ease: ease.exit },
          start + move + hold,
        )
    })
    return items
  }

  /**
   * Move a cursor along points [{ x, y }] (px inside its positioned parent) on gentle curves,
   * settling before each stop. Returns the time it arrives.
   */
  function cursorPath(tl, target, points, at = 0, o = {}) {
    const el = q(target)
    const travel = o.travel ?? 0.7
    const pause = o.pause ?? 0.35
    // `points` may be a function that measures layout (it runs inside withLayout).
    const stops = typeof points === 'function' ? withLayout(el, points) : points
    tl.set(el, { x: stops[0].x, y: stops[0].y }, at)
    let t = at
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]
      const b = stops[i]
      const bend = (o.bend ?? 0.18) * (i % 2 ? 1 : -1)
      const cx = (a.x + b.x) / 2 - (b.y - a.y) * bend
      const cy = (a.y + b.y) / 2 + (b.x - a.x) * bend
      const curve = (k, p, c, q) => (1 - k) ** 2 * p + 2 * (1 - k) * k * c + k * k * q
      // A real property tween, so a seek that jumps past it still lands on its end pose.
      const p = { k: 0 }
      tl.to(
        p,
        {
          k: 1,
          duration: b.travel ?? travel,
          ease: 'power2.inOut',
          onUpdate: () =>
            gsap.set(el, { x: curve(p.k, a.x, cx, b.x), y: curve(p.k, a.y, cy, b.y) }),
        },
        t,
      )
      tl.set(el, { x: b.x, y: b.y }, t + (b.travel ?? travel))
      t += (b.travel ?? travel) + (b.pause ?? pause)
    }
    return t
  }

  /** A click: the cursor dips and a ripple ring spreads from its tip. */
  function click(tl, target, at = 0, o = {}) {
    const el = q(target)
    let ripple = el.querySelector('.mk-ripple')
    if (!ripple) {
      ripple = document.createElement('span')
      ripple.className = 'mk-ripple'
      el.append(ripple)
    }
    tl.to(
      el.querySelector('svg') || el,
      { scale: 0.86, duration: 0.08, ease: 'power2.out', transformOrigin: '0 0' },
      at,
    )
      .to(
        el.querySelector('svg') || el,
        { scale: 1, duration: 0.18, ease: 'power2.out' },
        at + 0.08,
      )
      .fromTo(
        ripple,
        { scale: 0, opacity: o.opacity ?? 0.55 },
        { scale: 1, opacity: 0, duration: 0.5, ease: 'power2.out' },
        at,
      )
    return at + 0.1
  }

  function roughPath(kind, w, h, seed) {
    const r = random(seed)
    const j = (n) => (r() - 0.5) * n
    if (kind === 'underline')
      return `M ${j(6)} ${h + 6 + j(4)} Q ${w / 2} ${h + 10 + j(6)} ${w + j(6)} ${h + 4 + j(4)}`
    if (kind === 'strike') return `M ${-4 + j(4)} ${h / 2 + j(4)} L ${w + 4 + j(4)} ${h / 2 + j(4)}`
    if (kind === 'circle') {
      const cx = w / 2
      const cy = h / 2
      const rx = w / 2 + 18
      const ry = h / 2 + 12
      let d = ''
      for (let i = 0; i <= 36; i++) {
        const a = (i / 36) * Math.PI * 2.15 - 0.4
        const k = 1 + j(0.06)
        d += `${i ? 'L' : 'M'} ${cx + Math.cos(a) * rx * k} ${cy + Math.sin(a) * ry * k} `
      }
      return d
    }
    // box
    const p = 8
    return `M ${-p + j(4)} ${-p + j(4)} L ${w + p + j(4)} ${-p + j(4)} L ${w + p + j(4)} ${h + p + j(4)} L ${-p + j(4)} ${h + p + j(4)} Z`
  }

  /**
   * Hand-drawn annotation around an element: underline, box, circle, strike or marker (a
   * highlighter swipe behind the text). Draws on over `duration`.
   */
  function annotate(tl, target, at = 0, o = {}) {
    const el = q(target)
    const kind = o.kind ?? 'underline'
    const color = o.color ?? 'var(--mk-accent)'
    // Wrap the target instead of writing into it, so text updates (counter, typewriter) keep it.
    const wrap = document.createElement('span')
    wrap.className = 'mk-annotated'
    el.replaceWith(wrap)
    el.classList.add('mk-annotated-text')
    wrap.append(el)
    if (kind === 'marker') {
      const mark = document.createElement('span')
      mark.className = 'mk-marker'
      mark.style.background = color
      wrap.prepend(mark)
      tl.fromTo(
        mark,
        { scaleX: 0 },
        { scaleX: 1, duration: o.duration ?? dur(0.45), ease: 'power2.out' },
        at,
      )
      return mark
    }
    const { w, h } = withLayout(wrap, () => ({ w: wrap.offsetWidth, h: wrap.offsetHeight }))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'mk-annotation')
    svg.setAttribute('viewBox', `-30 -30 ${w + 60} ${h + 60}`)
    svg.style.cssText = `left:-30px;top:-30px;width:${w + 60}px;height:${h + 60}px`
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', roughPath(kind, w, h, o.seed ?? 7))
    path.style.stroke = color
    path.style.strokeWidth = String(o.width ?? 5)
    svg.append(path)
    wrap.append(svg)
    drawPath(tl, path, at, o.duration ?? dur(0.55))
    return svg
  }

  /** Draw an SVG path on from its start, via stroke dash offset. */
  function drawPath(tl, target, at = 0, duration = 0.8, o = {}) {
    const path = q(target)
    const length =
      withLayout(path, () => (path.getTotalLength ? path.getTotalLength() : 1000)) || 1000
    path.style.strokeDasharray = `${length}`
    // Hidden until it starts: a round cap would otherwise show a dot at the start point.
    tl.set(path, { opacity: 0 }, 0)
    tl.set(path, { opacity: 1 }, at)
    tl.fromTo(
      path,
      { strokeDashoffset: length },
      { strokeDashoffset: 0, duration, ease: o.ease ?? 'power2.inOut' },
      at,
    )
    return path
  }

  /** Bars grow from the baseline with a stagger; height comes from each bar's --v (0..1). */
  function bars(tl, target, at = 0, o = {}) {
    const items = qa(`${target} .mk-bar-fill`)
    tl.fromTo(
      items,
      { scaleY: 0 },
      {
        scaleY: 1,
        duration: o.duration ?? dur(0.9),
        ease: ease.enter,
        stagger: o.stagger ?? 0.12,
        transformOrigin: '50% 100%',
      },
      at,
    )
    return items
  }

  /** A slow continuous push-in (2–5%) across a shot: the camera is never fully still. */
  function pushIn(tl, target, at, duration, o = {}) {
    return tl.fromTo(
      q(target),
      { scale: o.from ?? 1 },
      { scale: o.to ?? 1.04, duration, ease: ease.drift },
      at,
    )
  }

  /** Film grain held for a few frames at a time (12 fps by default), from a seeded turbulence. */
  function grain(tl, target, duration, o = {}) {
    // A scene's own root can be out of reach of a scoped query (the checker); the film has one
    // grain filter, so fall back to it rather than silently dropping the grain.
    const turbulence =
      q(target)?.querySelector('feTurbulence') ?? document.querySelector('feTurbulence')
    if (!turbulence) return null
    const steps = Math.max(1, Math.round(duration * (o.fps ?? 12)))
    return tl.fromTo(
      turbulence,
      { attr: { seed: 1 } },
      { attr: { seed: steps + 1 }, duration, ease: `steps(${steps})` },
      0,
    )
  }

  /**
   * Scene transitions on host slots or full-frame layers. Use one or two kinds per film.
   * wipe/iris reveal `incoming`; blur and zoom pass through a peak; flash cuts on white.
   */
  function transition(tl, kind, outgoing, incoming, at, o = {}) {
    const d = o.duration ?? dur(0.6)
    const a = q(outgoing)
    const b = q(incoming)
    if (kind === 'wipe') {
      // Every value carries a unit: GSAP cannot interpolate a bare 0 against 100%.
      const from = {
        left: 'inset(0% 0% 0% 100%)',
        right: 'inset(0% 100% 0% 0%)',
        up: 'inset(100% 0% 0% 0%)',
        down: 'inset(0% 0% 100% 0%)',
      }[o.direction ?? 'left']
      tl.fromTo(
        b,
        { clipPath: from },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: d, ease: 'power3.inOut' },
        at,
      )
    } else if (kind === 'iris') {
      tl.fromTo(
        b,
        { clipPath: 'circle(0% at 50% 50%)' },
        { clipPath: 'circle(75% at 50% 50%)', duration: d, ease: 'power3.inOut' },
        at,
      )
    } else if (kind === 'blur') {
      tl.to(a, { filter: 'blur(18px)', opacity: 0, duration: d, ease: 'power2.in' }, at)
      tl.fromTo(
        b,
        { filter: 'blur(18px)', opacity: 0 },
        { filter: 'blur(0px)', opacity: 1, duration: d, ease: 'power2.out' },
        at + d * 0.35,
      )
    } else if (kind === 'zoom') {
      tl.to(a, { scale: 1.25, opacity: 0, duration: d, ease: 'power2.in' }, at)
      tl.fromTo(
        b,
        { scale: 0.9, opacity: 0 },
        { scale: 1, opacity: 1, duration: d, ease: 'power3.out' },
        at + d * 0.3,
      )
    } else if (kind === 'slide') {
      const x = (o.direction ?? 'left') === 'left' ? -100 : 100
      tl.to(a, { xPercent: x, duration: d, ease: 'power3.inOut' }, at)
      tl.fromTo(b, { xPercent: -x }, { xPercent: 0, duration: d, ease: 'power3.inOut' }, at)
    } else if (kind === 'fade') {
      tl.fromTo(b, { opacity: 0 }, { opacity: 1, duration: d, ease: 'power1.inOut' }, at)
    } else throw new Error(`MK.transition: unknown kind ${kind}`)
    return at + d
  }

  window.MK = {
    ease,
    dur,
    knob,
    withLayout,
    offsetWithin,
    random,
    split,
    splitLines,
    revealLines,
    revealWords,
    revealChars,
    typewriter,
    counter,
    wordCarousel,
    cursorPath,
    click,
    annotate,
    drawPath,
    bars,
    pushIn,
    grain,
    transition,
  }
})()
