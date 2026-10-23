/**
 * The house number/time rules for agent-facing text. One copy, so every report line — detect
 * blocks, the snapshot read-back, indicator values — prints a level the same way.
 */

/** Four significant digits without exponent noise — RSI's 63.2 and a BTC price both read. */
export function toolNumber(value: number): string {
  return Math.abs(value) >= 1000 ? value.toFixed(1) : String(Number(value.toPrecision(4)))
}

/** A unix-seconds bar time as an ISO-8601 instant. */
export function isoFromUnixSeconds(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString()
}
