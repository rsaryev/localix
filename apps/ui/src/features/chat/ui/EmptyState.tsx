import { BirdStage } from '@/shared/ui/BirdStage'
import { useBirdStill } from './useBirdStill'

/** The empty chat: the flying Localix bird and nothing else, model connected or not. */
export function EmptyState() {
  const still = useBirdStill()

  return (
    <div className="flex flex-1 select-none flex-col items-center justify-center px-4 py-8">
      <BirdStage still={still} cycles={Infinity} lineCount={10} />
    </div>
  )
}
