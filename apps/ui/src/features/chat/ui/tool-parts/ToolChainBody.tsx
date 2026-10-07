import { Fragment } from 'react'
import type { AgentItem } from '@localixai/agent/agents'
import type { Message } from '../../model/types'
import { coalesceSystemMessages } from '../coalesceSystemMessages'
import { SystemNoticeLine } from '../SystemNoticeLine'
import { ItemView } from './ItemView'
import { groupConsecutiveItems, isCollapsedGroup } from './cards/stacking'
import { StackedItemGroup } from './cards/StackedItemGroup'
import { toolActivitySegments } from './toolActivity'

export function ToolChainBody({
  items,
  activity,
}: {
  items: readonly AgentItem[]
  activity: readonly Message[]
}) {
  return toolActivitySegments(items, activity).map((segment) =>
    segment.kind === 'activity' ? (
      <Fragment key={`activity:${segment.messages[0]!.id}`}>
        {coalesceSystemMessages(segment.messages).map((message) => (
          <SystemNoticeLine
            key={message.id}
            notice={message.systemNotice!}
            repeatCount={message.systemRepeatCount}
          />
        ))}
      </Fragment>
    ) : (
      <Fragment key={`items:${segment.items[0]!.id}`}>
        {groupConsecutiveItems(segment.items).map((group) =>
          isCollapsedGroup(group) ? (
            <StackedItemGroup key={group.items[0].id} items={group.items} />
          ) : (
            group.items.map((item) => <ItemView key={item.id} item={item} />)
          ),
        )}
      </Fragment>
    ),
  )
}
