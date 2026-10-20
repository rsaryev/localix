import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { useOnScreen } from './motion'

export const DEMO_SRC = '/films/demo.mp4'
export const DEMO_POSTER = '/films/demo.jpg'

/**
 * The product demo: a silent recording of one workflows run, cropped to the app window. The
 * poster waits with a single centred action; the film loads only when the reader asks for it,
 * then loops without player chrome. A click on the frame pauses or resumes it, and it pauses on
 * its own while scrolled away.
 */
export function DemoFilm() {
  const frame = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const visible = useOnScreen(frame)

  useEffect(() => {
    if (started && !visible) video.current?.pause()
  }, [started, visible])

  function toggle() {
    const element = video.current
    if (!element) return
    if (!started) setStarted(true)
    // On the first click the source is set by this render, so play once it is in the DOM.
    requestAnimationFrame(() => {
      if (element.paused) void element.play()?.catch(() => {})
      else element.pause()
    })
  }

  return (
    <div ref={frame} className="demo-film" data-playing={playing || undefined}>
      <h2 className="sr-only">Localix demo</h2>
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
