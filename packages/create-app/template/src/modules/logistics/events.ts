import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'logistics.offer.created', label: 'Offer created', entity: 'offer', category: 'crud' },
  { id: 'logistics.offer.updated', label: 'Offer updated', entity: 'offer', category: 'crud' },
  { id: 'logistics.offer.deleted', label: 'Offer deleted', entity: 'offer', category: 'crud' },
  {
    id: 'logistics.transport.created',
    label: 'Transport created',
    entity: 'transport',
    category: 'crud',
    clientBroadcast: true,
  },
  { id: 'logistics.transport.updated', label: 'Transport updated', entity: 'transport', category: 'crud' },
  { id: 'logistics.transport.deleted', label: 'Transport deleted', entity: 'transport', category: 'crud' },
  {
    id: 'logistics.transport_run.started',
    label: 'Transport agent run started',
    entity: 'transport_run',
    category: 'lifecycle',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'logistics', events })
export default eventsConfig
