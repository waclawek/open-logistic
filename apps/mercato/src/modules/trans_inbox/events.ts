import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  {
    id: 'trans_inbox.request.received',
    label: 'Trans webhook received',
    entity: 'request',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'trans_inbox.feed.cleared',
    label: 'Trans inbox cleared',
    entity: 'request',
    category: 'lifecycle',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'trans_inbox',
  events,
})

export const emitTransInboxEvent = eventsConfig.emit
export type TransInboxEventId = (typeof events)[number]['id']
export default eventsConfig
