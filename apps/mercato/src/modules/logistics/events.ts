import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'logistics.offer.created', label: 'Offer created', entity: 'offer', category: 'crud' },
  { id: 'logistics.offer.updated', label: 'Offer updated', entity: 'offer', category: 'crud' },
  { id: 'logistics.offer.deleted', label: 'Offer deleted', entity: 'offer', category: 'crud' },
  { id: 'logistics.transport.created', label: 'Transport created', entity: 'transport', category: 'crud' },
  { id: 'logistics.transport.updated', label: 'Transport updated', entity: 'transport', category: 'crud' },
  { id: 'logistics.transport.deleted', label: 'Transport deleted', entity: 'transport', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'logistics', events })
export default eventsConfig
