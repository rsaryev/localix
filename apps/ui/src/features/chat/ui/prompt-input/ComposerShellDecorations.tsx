interface ComposerShellDecorationsProps {
  /** Prompt-improving in flight — drives the glow + top progress line. */
  isImproving: boolean
}

/**
 * Purely presentational composer-shell effects for prompt improving. Drop
 * feedback intentionally stays on PromptInput's own border: a quiet glow keeps
 * the destination obvious without covering the draft with instructions.
 */
export function ComposerShellDecorations({ isImproving }: ComposerShellDecorationsProps) {
  return (
    <>
      {/* Glow — improving state */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-(--dur-base)"
        style={
          isImproving
            ? {
                opacity: 1,
                background:
                  'radial-gradient(125% 145% at 50% 100%, color-mix(in oklch, var(--composer-accent), transparent 88%), transparent 58%)',
              }
            : undefined
        }
      />

      {/* Progress line — improving state */}
      {isImproving && (
        <div className="pointer-events-none absolute inset-x-8 top-px h-px overflow-hidden rounded-full">
          <div
            className="h-full w-full bg-gradient-to-r from-transparent via-foreground to-transparent opacity-[0.36]"
            style={{ animation: 'composer-soft-pulse 900ms var(--ease-standard) infinite' }}
          />
        </div>
      )}
    </>
  )
}
