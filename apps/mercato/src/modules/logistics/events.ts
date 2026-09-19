import { createModuleEvents } from '@open-mercato/shared/modules/events'

export const events = [
  { id: 'logistics.job.created', label: 'Transport job created', entity: 'job', category: 'lifecycle', clientBroadcast: true },
  { id: 'logistics.job.updated', label: 'Transport job updated', entity: 'job', category: 'lifecycle', clientBroadcast: true },
  { id: 'logistics.job.deleted', label: 'Transport draft removed', entity: 'job', category: 'lifecycle', clientBroadcast: true },
  { id: 'logistics.job.accepted', label: 'Transport job accepted', entity: 'job', category: 'lifecycle', clientBroadcast: true },
  { id: 'logistics.job.cancelled', label: 'Transport job cancelled', entity: 'job', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'logistics', events })
export const emitLogisticsEvent = eventsConfig.emit
export default eventsConfig
