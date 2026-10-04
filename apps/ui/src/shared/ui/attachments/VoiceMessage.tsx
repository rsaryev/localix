import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { barHeight, formatTime } from './voiceMessageFormat'

/**
 * Deterministic pseudo-waveform bar heights (no stored waveform data) — two slow
 * sines + a touch of hash jitter give a smooth, organic waveform shape.
 */
const BAR_COUNT = 28

/**
 * Compact voice message bubble: round play/pause button, pseudo-waveform
 * that fills with playback progress, and elapsed/total duration.
 */
export function VoiceMessage({
  src,
  durationMs,
  compact = false,
}: {
  src: string
  durationMs?: number
  compact?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  // Recorded webm often reports Infinity for duration — prefer the stored value.
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => setCurrentTime(audio.currentTime)
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration)
    }
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
    }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      void audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false))
    }
  }

  const seekTo = (seconds: number) => {
    const audio = audioRef.current
    if (!audio || duration <= 0) return
    const t = Math.min(duration, Math.max(0, seconds))
    audio.currentTime = t
    setCurrentTime(t)
  }
  const seekFromClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    seekTo(((e.clientX - rect.left) / rect.width) * duration)
  }

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0
  const barFull = compact ? 16 : 28
  const filled = Math.round(progress * BAR_COUNT)

  return (
    <div
      // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than the
      // composer/transcript this bubble sits on, so the player read as a black pill.
      className={`flex items-center gap-2.5 rounded-2xl border border-control-border bg-field-fill ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
    >
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        // Shared press recipe (Button / IconButton): the transition has to cover
        // `transform` or the press scale snaps, and reduced motion opts out of it.
        className={`flex shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-[opacity,transform] hover:opacity-90 active:scale-[0.97] motion-reduce:active:scale-100 cursor-pointer ${compact ? 'size-7' : 'size-9'}`}
      >
        {playing ? (
          <Pause className={compact ? 'size-3' : 'size-4'} fill="currentColor" strokeWidth={0} />
        ) : (
          <Play
            className={`${compact ? 'size-3' : 'size-4'} translate-x-px`}
            fill="currentColor"
            strokeWidth={0}
          />
        )}
      </button>
      <div className="flex min-w-0 flex-col gap-1">
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek voice message"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          onClick={seekFromClick}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              seekTo(currentTime + 5)
            }
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              seekTo(currentTime - 5)
            }
          }}
          className="flex cursor-pointer items-center gap-[2.5px] rounded-sm outline-none focus-ring"
          style={{ height: compact ? 14 : 18 }}
        >
          {Array.from({ length: BAR_COUNT }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className="w-[2.5px] rounded-full transition-colors"
              style={{
                height: `${Math.max(3, barHeight(i) * barFull)}px`,
                backgroundColor:
                  i < filled
                    ? 'var(--foreground)'
                    : 'color-mix(in oklch, var(--foreground), transparent 72%)',
              }}
            />
          ))}
        </div>
        <span className="text-2xs tabular-nums text-text-faint">
          {playing || currentTime > 0 ? `${formatTime(currentTime)} / ` : ''}
          {formatTime(duration)}
        </span>
      </div>
    </div>
  )
}
