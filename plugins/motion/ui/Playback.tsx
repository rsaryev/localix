import { useMotionSessionId } from './scope'
import { useEffect, useRef, useState } from 'react'
import { Pause, Play, SkipBack } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { FilmCanvas } from './FilmCanvas'
import { framesOf, durationOf } from '../shared/timing'
import type { MotionDocument } from '../shared/schema'
import { mediaBlob } from './media'

export function Playback({
  document,
  frame,
  onFrame,
  active,
}: {
  document: MotionDocument
  frame: number
  onFrame: (frame: number) => void
  active: boolean
}) {
  const sessionId = useMotionSessionId()
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [audioError, setAudioError] = useState('')
  const total = framesOf(document)
  useEffect(() => {
    const abort = new AbortController()
    setAudioUrl('')
    setAudioError('')
    let url = ''
    if (document.soundtrackId)
      mediaBlob(document.soundtrackId, abort.signal, sessionId).then(
        (blob) => {
          if (!abort.signal.aborted) {
            url = URL.createObjectURL(blob)
            setAudioUrl(url)
          }
        },
        () => {
          if (!abort.signal.aborted)
            setAudioError('Soundtrack unavailable. Reattach it before exporting.')
        },
      )
    return () => {
      abort.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [document.soundtrackId, sessionId])
  useEffect(() => {
    if (!active) setPlaying(false)
  }, [active])
  useEffect(() => {
    if (!playing || !active) return
    const start = performance.now() - (frame / document.fps) * 1000
    let handle = 0
    const tick = (now: number) => {
      const next = Math.floor(((now - start) / 1000) * document.fps)
      if (next >= total) {
        onFrame(total - 1)
        setPlaying(false)
        return
      }
      onFrame(next)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
    // Frame updates must not restart the playback clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, active, total, document.fps, onFrame])
  useEffect(() => {
    const element = audio.current
    if (!element) return
    const time = frame / document.fps
    if (!playing || Math.abs(element.currentTime - time) > 0.2) element.currentTime = time
    const remaining = durationOf(document) - time
    element.volume = document.volume * Math.min(1, time / 0.15, remaining / 0.4)
    if (playing && active)
      void element
        .play()
        .catch(() =>
          setAudioError(
            'Audio playback was blocked. Press Play again or export to hear the soundtrack.',
          ),
        )
    else element.pause()
  }, [frame, playing, active, document.fps, document.volume, document, audioUrl])
  return (
    <div className="space-y-3" aria-label="Video playback">
      <div className="flex h-72 items-center justify-center overflow-hidden @3xl:h-[clamp(20rem,48dvh,34rem)]">
        <FilmCanvas document={document} frame={frame} />
      </div>
      <div className="flex items-center gap-2">
        <IconButton
          tooltip="Restart video"
          aria-label="Restart video"
          size="sm"
          onClick={() => {
            setPlaying(false)
            onFrame(0)
          }}
        >
          <SkipBack />
        </IconButton>
        <IconButton
          tooltip={playing ? 'Pause video' : 'Play video'}
          aria-label={playing ? 'Pause video' : 'Play video'}
          size="sm"
          disabled={!active}
          onClick={() => {
            if (frame >= total - 1) onFrame(0)
            setPlaying((value) => !value)
          }}
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <Input
          type="range"
          className="accent-foreground"
          aria-label="Video playhead"
          min={0}
          max={total - 1}
          value={frame}
          onChange={(event) => {
            setPlaying(false)
            onFrame(Number(event.target.value))
          }}
        />
        <span className="shrink-0 text-2xs tabular-nums text-text-faint">
          {(frame / document.fps).toFixed(1)} / {durationOf(document).toFixed(1)}s
        </span>
      </div>
      {audioUrl && (
        // Optional user audio has no supplied transcript. Its controls are the labeled transport.
        // oxlint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={audio}
          src={audioUrl}
          preload="auto"
          onError={() =>
            setAudioError('This browser cannot play the soundtrack. Try a WAV or MP3 file.')
          }
        />
      )}
      {audioError && (
        <p role="alert" className="text-xs text-status-error">
          {audioError}
        </p>
      )}
    </div>
  )
}
