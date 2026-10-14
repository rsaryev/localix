import { useEffect, useState } from 'react'

/**
 * Renders `children` only after the page has painted once.
 *
 * The hero's wind animation is 40 animated layers. Mounted in the first render it is built on the
 * same frame as the headline, so the first paint waits on it and the headline appears late and
 * then stutters. Mounting it after two animation frames keeps the first paint to the text, and the
 * box it fills is reserved by the caller so nothing moves when it arrives. The server render and
 * the first client render both show `fallback`, which is also what hydration expects.
 */
export function AfterFirstPaint({
  children,
  fallback = null,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])
  return <>{ready ? children : fallback}</>
}
