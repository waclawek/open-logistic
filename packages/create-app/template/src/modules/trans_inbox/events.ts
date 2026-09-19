import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [{
  id: 'trans_inbox.request.received',
  label: 'Diagnostic webhook received',
  entity: 'request',
  category: 'lifecycle',
  clientBroadcast: true,
  excludeFromTriggers: true,
}] as const

export const eventsConfig = createModuleEvents({ moduleId: 'trans_inbox', events })
export const emitTransInboxEvent = eventsConfig.emit
export default eventsConfig
