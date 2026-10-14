/**
 * READING ONE MESSAGE ALOUD, through the platform's speech synthesis.
 *
 * Two failures shape it. Speech synthesis is ONE queue for the whole page, so a card that just
 * called `speak` would wait behind whatever another card was still reading — starting here
 * cancels that first. And a card that unmounts mid-speech (a session switch, a row virtualized
 * away) takes its Stop control with it while the voice goes on, so unmounting cancels too.
 */
import { useCallback, useEffect, useState } from 'react'

/**
 * Strip markdown noise before handing text to speech synthesis — code blocks
 * become a short marker (nobody wants `const x = …` read character by
 * character), inline syntax loses its punctuation.
 */
function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whether this runtime can speak at all: there is no `window` in a server render. */
export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function useReadAloud(text: string | undefined): {
  speaking: boolean
  toggle: () => void
} {
  const [speaking, setSpeaking] = useState(false)

  // Stop reading aloud when this card unmounts mid-speech (session switch etc.).
  useEffect(
    () => () => {
      if (speaking) window.speechSynthesis?.cancel()
    },
    [speaking],
  )

  const toggle = useCallback(() => {
    const synth = window.speechSynthesis
    if (!synth || !text) return
    if (speaking) {
      synth.cancel()
      setSpeaking(false)
      return
    }
    synth.cancel() // another card may still be reading
    const utterance = new SpeechSynthesisUtterance(speakableText(text))
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    synth.speak(utterance)
  }, [text, speaking])

  return { speaking, toggle }
}
