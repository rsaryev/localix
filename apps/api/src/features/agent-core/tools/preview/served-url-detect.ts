/**
 * Agnostic, content-based dev-server URL detection. A dev server prints the URL it
 * serves on startup (Vite's "Local: http://localhost:5173/", a Python http.server
 * line, a Next.js banner). We scan that OUTPUT — never the COMMAND string
 * (`npm run dev`), which would couple us to specific stacks — and surface the best
 * advertised URL so the preview can open it.
 *
 * Two robustness rules a naive single regex misses (the source of the brittle
 * "wrong/truncated localhost" detection):
 *  1. PTY output arrives in raw byte chunks, and BOTH a URL and an ANSI escape can
 *     straddle a chunk boundary — so we cannot strip-and-scan one chunk at a time.
 *     The stateful {@link createServedUrlScanner} accumulates bytes and finalizes
 *     only at newline boundaries, then runs a stateless strip-and-scan on complete
 *     lines (a half-printed `http://localhost:51` never latches as port 51).
 *  2. A banner colors the URL (`http://localhost:\x1b[36m5173\x1b[39m/`) and may
 *     print several hosts (Local + Network + 127.0.0.1). We strip ANSI/OSC first,
 *     validate each candidate with `new URL()`, and SCORE hosts (custom DNS >
 *     loopback > private IP > public IP) so multiple matches resolve to the best
 *     origin, not merely the first.
 *
 * ── Why the private-range list is NOT shared with the SSRF guard ──────────────
 * `tools/web/net-safety.ts` has a near-identical list, and fusing them is tempting.
 * They stay apart on purpose, because they are the same DATA under OPPOSITE stakes:
 *
 *   - net-safety is a GUARD. A range it wrongly calls private is a blocked fetch
 *     (annoying). A range it wrongly calls public is an SSRF hole (severe). It must
 *     therefore OVER-include, forever.
 *   - this module is a DETECTOR. A range it wrongly calls private only widens what we
 *     offer to auto-open in the preview; a range it wrongly calls public is a dev
 *     server we silently never detect (the `127.0.0.2` bug). Mild, both ways.
 *
 * One shared owner would put a security boundary one careless edit away from a
 * convenience tweak: "make the preview also detect X" would become a change to the
 * SSRF list. It also does not fit — the guard exposes a BOOLEAN (`isPrivateAddress`),
 * while the detector needs a finer taxonomy (loopback OUTRANKS a LAN IP when scoring
 * which advertised host to open), so the detector would need its own loopback test on
 * top anyway and would share only half a list.
 *
 * So: two lists, one RATCHET. `served-url-detect.net-safety-parity.test.ts` asserts at
 * runtime that every address the GUARD calls private is non-public HERE — the detector
 * is pinned as a superset. That test can only go red if this list falls behind or if
 * someone narrows the guard; it can never pressure the guard to shrink.
 *
 * What IS shared is the stakes-NEUTRAL parsing MECHANISM (IPv6 → 16 bytes + embedded-v4
 * detection), owned by the backend SDK and re-exported through `../ip-literal`. That is not
 * policy — both want identical decoding. Each side still applies its OWN private-range
 * predicate on the bytes, so the "two lists" invariant is untouched.
 */

import { stripAnsi } from '../bash/output-filters/sanitize-ansi'
import { classifyHost, hostKindScore, isUnspecifiedHost, type HostKind } from './served-url-hosts'

export { classifyHost, isUnspecifiedHost, type HostKind } from './served-url-hosts'

// ── ANSI / control strippers ────────────────────────────────────────────────
// PTY output is raw bytes; this mirrors a terminal normalizer. The escape grammar itself is the
// server's one stripper (`stripAnsi`). The ONE thing this detector does differently, on purpose:
// a cursor-move CSI in a differential redraw is replaced with a URL-INVALID guard char BEFORE the
// strip, because two text fragments a real terminal keeps apart (`http://localhost:51` then a
// move, then `73`) would otherwise fuse into a fake URL. A plain strip deletes the move and
// cannot know it separated anything.
/* oxlint-disable no-control-regex -- these patterns match cursor-move CSIs and C0 controls; the control chars are the point */
const CURSOR_MOVE_PATTERN = /\x1b\[[0-?]*[ -/]*[CDGHf]/g
const CURSOR_MOVE_GUARD = '['
const CONTROL_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/g
/* oxlint-enable no-control-regex */

// Permissive candidate matcher — real validation is `new URL()` below. Stops at
// chars that cannot appear in a URL (whitespace, quotes, angle brackets, backtick).
const URL_CANDIDATE_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi
const URL_CANDIDATE_LIMIT = 2048

// Newline-finalized buffer cap: a banner line is short, so a few KB is ample, and
// bounding it keeps a chatty server from growing the buffer without limit.
const BUFFER_LIMIT = 8 * 1024

function stripTerminalControls(text: string): string {
  const guarded = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CURSOR_MOVE_PATTERN, CURSOR_MOVE_GUARD)
  return stripAnsi(guarded).replace(CONTROL_PATTERN, '')
}

interface ScoredUrl {
  /** The URL to open — origin + path, query/fragment dropped (a token-bearing
   *  callback line can't leak into the panel), bind-all hosts already rewritten. */
  url: string
  host: string
  hostKind: HostKind
  protocol: 'http' | 'https'
}

/** origin + pathname, minus a lone trailing slash, no search/hash. The browser
 *  treats `:5173` and `:5173/` identically; openPreviewCore re-normalizes anyway. */
function toOpenable(u: URL): string {
  const path = u.pathname === '/' ? '' : u.pathname
  return `${u.origin}${path}`.replace(/^(https?:\/\/)(?:0\.0\.0\.0|\[::\])/i, '$1localhost')
}

function scoreCandidates(cleaned: string): ScoredUrl[] {
  const out: ScoredUrl[] = []
  for (const match of cleaned.matchAll(URL_CANDIDATE_PATTERN)) {
    let candidate = match[0]
    if (candidate.length > URL_CANDIDATE_LIMIT) continue
    // Trailing sentence punctuation a banner/human text may have appended.
    while (candidate.length > 0 && /[.,;:!?)\]}>'"`]/.test(candidate.slice(-1)))
      candidate = candidate.slice(0, -1)
    let u: URL
    try {
      u = new URL(candidate)
    } catch {
      continue
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (!u.hostname || isUnspecifiedHost(u.hostname)) continue
    // A dev server always prints an explicit port. Requiring one rejects a bare
    // `http://localhost` mentioned in prose (which would open a dead port 80).
    if (!u.port) continue
    const hostKind = classifyHost(u.hostname)
    // Only surface LOCALLY-previewable hosts from the banner alone: loopback or a
    // private LAN IP. A `custom` DNS host (could be `example.com` from prose) or a
    // public IP is NOT trusted without a real local listener — that cross-check is
    // the OS port scanner's job (and is where custom-host enrichment will hook in).
    if (hostKind !== 'loopback' && hostKind !== 'private-ip') continue
    out.push({
      url: toOpenable(u),
      host: u.hostname,
      hostKind,
      protocol: u.protocol === 'https:' ? 'https' : 'http',
    })
  }
  return out
}

/** True when `candidate` is a better advertised URL than `existing`: higher host
 *  score wins; tie → https wins; tie → keep the existing (first-seen) one. */
function better(existing: ScoredUrl, candidate: ScoredUrl): boolean {
  const de = hostKindScore(existing.hostKind)
  const dc = hostKindScore(candidate.hostKind)
  if (dc !== de) return dc > de
  if (existing.protocol !== candidate.protocol) return candidate.protocol === 'https'
  return false
}

function bestOf(scored: ScoredUrl[]): ScoredUrl | undefined {
  let best: ScoredUrl | undefined
  for (const c of scored) if (!best || better(best, c)) best = c
  return best
}

/**
 * One-shot detection over a COMPLETE block of text (already-buffered output, a
 * test fixture). For streaming PTY output use {@link createServedUrlScanner},
 * which finalizes on newlines so a split URL never latches partially.
 */
export function detectServedUrl(text: string): string | undefined {
  return bestOf(scoreCandidates(stripTerminalControls(text)))?.url
}

/** Stateful, streaming detector for raw PTY chunks. */
export interface ServedUrlScanner {
  /** Feed a raw output chunk; returns the best advertised URL when it first
   *  appears OR improves (a higher-scored host shows up later), else undefined. */
  push(chunk: string): string | undefined
  /** The current best advertised URL, or undefined if none seen yet. */
  current(): string | undefined
}

export function createServedUrlScanner(): ServedUrlScanner {
  let raw = ''
  let best: ScoredUrl | undefined

  const finalize = (chunk: string): string => {
    raw += chunk
    if (raw.length > BUFFER_LIMIT) raw = raw.slice(-BUFFER_LIMIT)
    // Only scan up to the last line break — a partially-written URL stays buffered.
    let lastBreak = -1
    for (let i = raw.length - 1; i >= 0; i--) {
      const c = raw.charCodeAt(i)
      if (c === 0x0a || c === 0x0d) {
        lastBreak = i
        break
      }
    }
    if (lastBreak === -1) return ''
    const finalized = raw.slice(0, lastBreak + 1)
    raw = raw.slice(lastBreak + 1)
    return finalized
  }

  return {
    push(chunk) {
      const finalized = finalize(chunk)
      if (!finalized) return undefined
      const prevUrl = best?.url
      for (const c of scoreCandidates(stripTerminalControls(finalized)))
        if (!best || better(best, c)) best = c
      return best && best.url !== prevUrl ? best.url : undefined
    },
    current() {
      return best?.url
    },
  }
}
