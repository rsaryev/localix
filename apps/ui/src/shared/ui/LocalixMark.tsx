/** The app's bird silhouette, following the surrounding text colour. */
export function LocalixMark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-block bg-current ${className ?? 'size-full'}`}
      aria-hidden="true"
      style={{
        maskImage: 'url(/logo-dark.svg)',
        maskSize: 'contain',
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
      }}
    />
  )
}
