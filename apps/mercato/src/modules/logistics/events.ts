import { createModuleEvents } from '@open-mercato/shared/modules/events'

export const events = [
  { id: 'logistics.job.accepted', label: 'Transport job accepted', entity: 'job', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'logistics', events })
export const emitLogisticsEvent = eventsConfig.emit
export default eventsConfig
