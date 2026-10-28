import { useCallback, useEffect, useRef, useState } from 'react'

/** MIME types we try for MediaRecorder, in preference order (opus first). */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/wav',
]

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

export interface VoiceRecording {
  blob: Blob
  durationMs: number
}

export interface VoiceRecorder {
  isRecording: boolean
  /** Elapsed recording time in whole seconds (drives the composer timer). */
  seconds: number
  /** True when the browser exposes MediaRecorder + getUserMedia. */
  isSupported: boolean
  start: () => Promise<void>
  /** Stop and resolve the captured audio; null if nothing was recorded. */
  stop: () => Promise<VoiceRecording | null>
  /** Stop and discard the recording. */
  cancel: () => void
}

/**
 * Microphone recorder for composer voice messages. Records via MediaRecorder
 * (opus/webm preferred) with echo cancellation + noise suppression enabled.
 */
export function useVoiceRecorder(active = true): VoiceRecorder {
  const [isRecording, setIsRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const requestSeqRef = useRef(0)
  // False once unmounted — guards the async getUserMedia in start() so a mic
  // stream acquired AFTER unmount (permission prompt still open when the
  // composer closes) is released immediately instead of staying live forever.
  const mountedRef = useRef(true)
  const activeRef = useRef(active)

  const isSupported =
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'

  /** Release the mic, timer and recorder handles; the state reset is `cleanup`'s. */
  const release = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  const cleanup = useCallback(() => {
    release()
    setIsRecording(false)
    setSeconds(0)
  }, [release])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [cleanup])

  const start = useCallback(async () => {
    if (!activeRef.current || recorderRef.current) return
    const requestSeq = ++requestSeqRef.current
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    // Unmounted or warm-hidden while the permission prompt was open — release
    // the newly granted mic immediately. The hidden composer stays mounted, so
    // the ordinary unmount cleanup alone cannot protect this race.
    if (!mountedRef.current || !activeRef.current || requestSeq !== requestSeqRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.start(250)
    recorderRef.current = recorder
    streamRef.current = stream
    startedAtRef.current = Date.now()
    setSeconds(0)
    setIsRecording(true)
    timerRef.current = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 250)
  }, [])

  const stop = useCallback((): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current
    if (!recorder) return Promise.resolve(null)
    const durationMs = Date.now() - startedAtRef.current
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        cleanup()
        resolve(blob.size > 0 ? { blob, durationMs } : null)
      }
      recorder.stop()
    })
  }, [cleanup])

  /** Stop and drop the recording's handles without touching React state. */
  const discard = useCallback(() => {
    // Invalidate an unresolved getUserMedia request too. Merely checking the
    // current focus after it resolves would resurrect a recording if the user
    // briefly switched away and came back while the permission prompt was open.
    requestSeqRef.current += 1
    const recorder = recorderRef.current
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      try {
        recorder.stop()
      } catch {
        // already inactive
      }
    }
    chunksRef.current = []
    release()
  }, [release])

  const cancel = useCallback(() => {
    discard()
    setIsRecording(false)
    setSeconds(0)
  }, [discard])

  // A hidden composer shows no recording: reset while rendering, and let the effect below stop
  // the recorder itself.
  if (!active && (isRecording || seconds !== 0)) {
    setIsRecording(false)
    setSeconds(0)
  }
  useEffect(() => {
    activeRef.current = active
    if (!active) discard()
  }, [active, discard])

  return { isRecording, seconds, isSupported, start, stop, cancel }
}
