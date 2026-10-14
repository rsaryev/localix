import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keep keyboard focus following the wizard. On a step CHANGE move focus into the
 * new step — its first text field if it opens with one (ready to type), else the
 * step container (never a button, so no stray focus ring). First mount focuses
 * the container; same-index re-renders are ignored. Owns its own prev-index ref
 * so the shell stays declarative.
 */
export function useStepFocus(stepIndex: number, containerRef: RefObject<HTMLElement | null>) {
  const prevStepRef = useRef<number | null>(null)
  useEffect(() => {
    const prev = prevStepRef.current
    prevStepRef.current = stepIndex
    const container = containerRef.current
    if (!container) return
    if (prev === null) {
      container.focus()
      return
    }
    if (prev === stepIndex) return
    const field = container.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([disabled]), textarea:not([disabled])',
    )
    ;(field ?? container).focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex])
}
