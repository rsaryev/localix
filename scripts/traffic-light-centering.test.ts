import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The macOS traffic lights stay centered in the titlebar strip the UI draws.
 *
 * Two layers own one alignment. Rust positions the native button cluster
 * (`traffic_light_position`), CSS decides how tall the strip under it is
 * (`--titlebar-height`). Neither file mentions the other, so retuning the strip — a one-token edit,
 * exactly the kind this repo encourages — silently leaves the lights off-center, and the only way to
 * notice is to look at a Mac.
 *
 * So the Rust constant is pinned to its DERIVATION rather than to itself: half the space left over
 * once a 12pt light is placed in the strip. Change the token and this fails, naming the value the
 * new strip needs.
 *
 * A note on precision. The shipped `y` is 11 where arithmetic over the 12pt VISIBLE circle says 12,
 * and the one-pixel gap now has a mechanism behind it rather than a shrug. wry does not position
 * the buttons vertically at all: `inset_traffic_lights` (wkwebview/class/wry_web_view_parent.rs)
 * sets the title-bar container's height to `close_rect.size.height + y` and only rewrites each
 * button's `origin.x`. So `y` is measured against the BUTTON'S FRAME, which AppKit makes taller
 * than the circle it draws — a 14pt frame centres at exactly 11 in a 36px strip.
 *
 * The frame height is AppKit's and cannot be read from this repo, so the tolerance stays: it is
 * what lets the guard protect the relationship without hard-coding a number nobody here can check.
 * What it no longer does is describe the pixel as unexplained.
 *
 * The horizontal axis is guarded too, and for a sharper reason: the UI strip has to RESERVE room
 * for a cluster it does not draw, and that reservation used to be a bare `padding-left: 78px`.
 * Nothing tied it to the inset the Rust side sets, so moving the cluster left the strip's content
 * where it was — the breadcrumb sitting crooked against the lights.
 */

const repoRoot = resolve(import.meta.dir, '..')
const RUST = 'apps/desktop-tauri/src-tauri/src/lib.rs'
const CSS = 'packages/kit/styles/chrome.css'

/**
 * Diameter of a macOS window button, in points. Fixed by AppKit, not by us — the one number in the
 * formula that is chosen by the platform rather than read from our own tokens.
 */
const MACOS_WINDOW_BUTTON_DIAMETER = 12

/** Optical bias tolerated between the derived centering and the shipped value. See the header. */
const TOLERATED_BIAS = 1

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

/** `.traffic_light_position(LogicalPosition::new(19.0, 11.0))` → `{ x: 19, y: 11 }`. */
function shippedPosition(source: string): { x: number; y: number } {
  const match =
    /traffic_light_position\(LogicalPosition::new\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)\)/u.exec(source)
  if (!match)
    throw new Error(`${RUST}: no traffic_light_position call found — did the builder move?`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** `--titlebar-height: 36px` → `36`. */
function titlebarHeight(css: string): number {
  const match = /--titlebar-height:\s*(\d+)px/u.exec(css)
  if (!match) throw new Error(`${CSS}: --titlebar-height is gone — the derivation has no input`)
  return Number(match[1])
}

/** Any `--name: <n>px` token, read by name so the derivation names its inputs. */
function pxToken(css: string, name: string): number {
  const match = new RegExp(`--${name}:\\s*(\\d+)px`, 'u').exec(css)
  if (!match) throw new Error(`${CSS}: --${name} is gone — the derivation has no input`)
  return Number(match[1])
}

describe('macOS traffic lights are centered in the titlebar strip', () => {
  const position = shippedPosition(read(RUST))
  const strip = titlebarHeight(read(CSS))

  // Positive control: a parser that matched nothing would make the assertion below vacuous, and
  // both readers throw rather than return a default, so this proves they found real values.
  test('both layers were actually read', () => {
    expect(strip).toBeGreaterThan(MACOS_WINDOW_BUTTON_DIAMETER)
    expect(position.x).toBeGreaterThan(0)
    expect(position.y).toBeGreaterThan(0)
  })

  test('the vertical offset is half the leftover space in the strip', () => {
    const centered = (strip - MACOS_WINDOW_BUTTON_DIAMETER) / 2
    const drift = Math.abs(position.y - centered)
    expect(
      drift,
      drift <= TOLERATED_BIAS
        ? ''
        : `traffic_light_position y=${position.y} is ${drift}px off center for a ${strip}px titlebar ` +
            `(a ${MACOS_WINDOW_BUTTON_DIAMETER}pt button centers at y=${centered}). Update ${RUST}, or ` +
            `--titlebar-height in ${CSS}, so the two agree.`,
    ).toBeLessThanOrEqual(TOLERATED_BIAS)
  })

  test('the UI strip reserves exactly the cluster the Rust side positions', () => {
    const css = read(CSS)
    const inset = pxToken(css, 'macos-traffic-light-inset')
    const diameter = pxToken(css, 'macos-window-button-diameter')
    const pitch = pxToken(css, 'macos-window-button-pitch')
    const gutter = pxToken(css, 'titlebar-gutter')

    // The CSS token is the Rust number, not a second opinion about it.
    expect(
      inset,
      `--macos-traffic-light-inset (${inset}) must mirror traffic_light_position x (${position.x}) in ${RUST}`,
    ).toBe(position.x)

    // AppKit's own measures, stated so the cluster width is derived rather than eyeballed.
    expect(diameter).toBe(MACOS_WINDOW_BUTTON_DIAMETER)
    expect(pitch).toBeGreaterThan(diameter)

    // And the reservation is that arithmetic, written as arithmetic — a literal here is the bug
    // this guard exists to catch.
    expect(css).toContain(
      'padding-left: calc(\n' +
        '    var(--macos-traffic-light-inset) + var(--macos-traffic-light-cluster) + var(--titlebar-gutter)\n' +
        '  );',
    )
    expect(css).toContain(
      '--macos-traffic-light-cluster: calc(\n' +
        '    var(--macos-window-button-diameter) + 2 * var(--macos-window-button-pitch)\n' +
        '  );',
    )

    // And it must actually clear the last button rather than merely being derived from it: the
    // reservation is the cluster's right edge plus a real gutter, never less.
    const clusterRight = inset + diameter + 2 * pitch
    const reserved = inset + diameter + 2 * pitch + gutter
    expect(gutter).toBeGreaterThan(0)
    expect(
      reserved,
      `the titlebar reserves ${reserved}px for a cluster ending at ${clusterRight}px`,
    ).toBeGreaterThan(clusterRight)
  })

  test('the horizontal inset is NOT a centering claim', () => {
    // Recorded so nobody derives it later and "fixes" it: x is the sidebar's own inset, not the
    // cluster centered in the rail. Centering a 3-button cluster in the 48px rail would put it far
    // left of where it sits, so the two numbers answer different questions.
    const railWidth = /--workbench-rail-width:\s*(\d+)px/u.exec(read(CSS))?.[1]
    expect(railWidth).toBeDefined()
    const clusterCentered = (Number(railWidth) - MACOS_WINDOW_BUTTON_DIAMETER * 3) / 2
    expect(position.x).not.toBe(clusterCentered)
  })
})
