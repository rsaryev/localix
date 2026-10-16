import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@localixai/kit/button'
import { FILMS, filmPoster, filmSrc, type Film } from './filmContent'
import { useMedia, useOnScreen } from './motion'

/**
 * The product films as one player: each film is a chapter, and the next one starts when the
 * current one ends, wrapping after the last. Under the frame, one row of chapter names doubles as
 * the progress bar: past chapters are full, the playing one fills as it plays, and a click or the
 * arrow keys jump to a chapter. The playing chapter's title and detail are the section heading;
 * every heading shares one grid cell, so the frame keeps its place when the text changes length.
 *
 * A single film loops and shows no chapter row. Only the playing chapter loads, and it plays only
 * while the player is on screen. A reader who asks for reduced motion gets the poster and the
 * native controls instead of autoplay.
 */
export function ChapterFilm({ films = FILMS }: { films?: readonly Film[] }) {
  const video = useRef<HTMLVideoElement>(null)
  const chapters = useRef<(HTMLButtonElement | null)[]>([])
  const fills = useRef<(HTMLSpanElement | null)[]>([])
  const [index, setIndex] = useState(0)
  const near = useOnScreen(video, { margin: '200px 0px' })
  const visible = useOnScreen(video, { margin: '-15% 0px' })
  const still = useMedia('(prefers-reduced-motion: reduce)')
  const film = films[index]

  useEffect(() => {
    const element = video.current
    if (!element || still) return
    if (visible) {
      // Autoplay of a muted video can still be refused (power saving); the poster stays.
      void element.play()?.catch(() => {})
    } else {
      element.pause()
    }
  }, [visible, still, index])

  // Fills are written outside React (below), so a chapter change resets them here as well.
  useEffect(() => {
    fills.current.forEach((fill, at) => {
      if (fill) fill.style.transform = `scaleX(${at < index ? 1 : 0})`
    })
  }, [index])

  // The playing chapter's fill follows the video frame by frame, outside React, while on screen.
  useEffect(() => {
    const element = video.current
    if (!element || !visible || typeof requestAnimationFrame === 'undefined') return
    let frame = 0
    const paint = () => {
      const fill = fills.current[index]
      if (fill && element.duration > 0) {
        fill.style.transform = `scaleX(${element.currentTime / element.duration})`
      }
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [index, visible])

  if (!film) return null

  function jump(next: number, keyboard = false) {
    const target = (next + films.length) % films.length
    setIndex(target)
    const chapter = chapters.current[target]
    chapter?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    if (keyboard) chapter?.focus()
  }

  function onKeyDown(event: KeyboardEvent, at: number) {
    const positions: Partial<Record<string, number>> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: films.length - 1,
    }
    const next = positions[event.key]
    if (next === undefined) return
    event.preventDefault()
    jump(next, true)
  }

  return (
    <div className="chapter-film">
      <div className="film-headings">
        {films.map((entry, at) => (
          <h2
            key={entry.key}
            className="section-heading section-title film-heading"
            aria-hidden={at !== index || undefined}
            data-current={at === index || undefined}
          >
            {entry.title} <span className="text-text-faint">{entry.detail}</span>
          </h2>
        ))}
      </div>
      <div className="film-frame">
        <video
          ref={video}
          className="film-video"
          src={near || still ? filmSrc(film) : undefined}
          poster={filmPoster(film)}
          aria-label={film.alt}
          width={1920}
          height={1080}
          muted
          loop={films.length === 1}
          playsInline
          preload={still ? 'none' : 'auto'}
          controls={still}
          onEnded={() => jump(index + 1)}
        />
      </div>
      {films.length > 1 && (
        <div role="group" aria-label="Chapters" className="film-chapters">
          {films.map((entry, at) => (
            <Button
              key={entry.key}
              ref={(element) => {
                chapters.current[at] = element
              }}
              variant="ghost"
              size="sm"
              className="film-chapter"
              aria-current={at === index || undefined}
              tabIndex={at === index ? 0 : -1}
              onClick={() => jump(at)}
              onKeyDown={(event) => onKeyDown(event, at)}
            >
              <span className="film-chapter-label">{entry.label}</span>
              <span className="film-chapter-track" aria-hidden="true">
                <span
                  ref={(element) => {
                    fills.current[at] = element
                  }}
                  className="film-chapter-fill"
                />
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
