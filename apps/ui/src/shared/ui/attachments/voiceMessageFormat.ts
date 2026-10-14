// Pure helpers for the voice-message bubble, extracted from VoiceMessage so the
// time formatting + waveform shape are testable.

/** Deterministic pseudo-waveform bar height for index `i` (bounded, decorative). */
export function barHeight(i: number): number {
  const wave = 0.5 + 0.5 * Math.sin(i * 0.55 + 0.8) * Math.sin(i * 0.23 + 2.1)
  const jitter = (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.18
  return 0.25 + wave * 0.6 + jitter
}

/** Clock-style m:ss from a second count (clamped at 0; minutes can exceed 59). */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
