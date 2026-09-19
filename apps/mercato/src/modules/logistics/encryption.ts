import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'logistics:vehicle_profile',
    fields: [
      { field: 'registration', hashField: 'registration_hash' },
      { field: 'last_known_place' },
    ],
  },
  {
    entityId: 'logistics:driver_profile',
    fields: [{ field: 'dispatcher_notes' }],
  },
  {
    entityId: 'logistics:transport_job',
    fields: [
      { field: 'customer_name_snapshot' },
      { field: 'customer_reference' },
      { field: 'cargo_description' },
      { field: 'pickup_place' },
      { field: 'delivery_place' },
      { field: 'notes' },
    ],
  },
]

export default defaultEncryptionMaps
