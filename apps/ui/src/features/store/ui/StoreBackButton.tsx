import { ArrowLeft } from 'lucide-react'
import { Button } from '@localixai/kit/button'

/** Back to where the Store came from, named by that place in the words it shows. */
export function StoreBackButton({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Back to ${label}`}
        data-store-back
        onClick={onBack}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden />
        {label}
      </Button>
    </div>
  )
}
