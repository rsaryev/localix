import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { useOnScreen } from './motion'

export const DEMO_SRC = '/films/demo.mp4'
export const DEMO_POSTER = '/films/demo.jpg'

/** Whether the film may start by itself: not with reduced motion, nor on a data-saving connection. */
function mayAutoplay() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return !connection?.saveData
}

/**
 * The product demo, where llx.sh replays its terminal: a silent recording of one workflows run,
 * cropped to the app window. It loads and plays once it scrolls into view and pauses while it is
 * away. A click on the frame pauses or resumes it, and a pause by hand holds until the next click.
 * With reduced motion or Save-Data it waits on its poster until asked.
 */
export function DemoFilm({ autoplay }: { autoplay?: boolean }) {
  const frame = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [held, setHeld] = useState(false)
  const visible = useOnScreen(frame, { margin: '120px', fallback: false })

  // Once on screen the film loads itself, unless the reader paused it or asked for less motion.
  useEffect(() => {
    if (visible && !held && (autoplay ?? mayAutoplay())) setStarted(true)
  }, [visible, held, autoplay])

  // Playback follows the state, after the source is committed: on screen and not held, it plays.
  useEffect(() => {
    const element = video.current
    if (!element || !started) return
    if (visible && !held) void element.play()?.catch(() => {})
    else element.pause()
  }, [started, visible, held])

  function toggle() {
    const element = video.current
    if (!element) return
    if (!started || element.paused) {
      setStarted(true)
      setHeld(false)
      // Within the click, so a browser that blocks autoplay still lets the reader start it.
      if (started) void element.play()?.catch(() => {})
    } else {
      setHeld(true)
    }
  }

  return (
    <div ref={frame} className="demo-film" data-playing={playing || undefined}>
      <video
        ref={video}
        className="demo-video"
        src={started ? DEMO_SRC : undefined}
        poster={DEMO_POSTER}
        aria-label="A /workflows prompt puts three cards on the board, agents build and test a dark 2048 game in the browser, and a Visual Feedback comment adds a light theme"
        width={1680}
        height={946}
        muted
        loop
        playsInline
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        type="button"
        className="demo-toggle focus-ring"
        aria-label={playing ? 'Pause demo' : 'Play demo'}
        onClick={toggle}
      />
      <div className="demo-cover" aria-hidden="true">
        <Button asChild variant="mono" size="xl" className="demo-play rounded-full">
          <span>
            <Play className="fill-current" />
            {started ? 'Resume' : 'Watch the demo'}
          </span>
        </Button>
      </div>
    </div>
  )
}
