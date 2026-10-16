import { BirdStage } from '@/shared/ui/BirdStage'
import { useBirdStill } from './useBirdStill'

/** The empty chat once a model is connected: the flying Localix bird and nothing else.
 *  Without a connection the chat surface shows the workspace tips carousel instead. */
export function EmptyState() {
  const still = useBirdStill()

  return (
    <div className="flex flex-1 select-none flex-col items-center justify-center px-4 py-8">
      <BirdStage still={still} cycles={Infinity} lineCount={10} />
    </div>
  )
}
