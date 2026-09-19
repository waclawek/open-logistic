import type { EntityExtension } from '@open-mercato/shared/modules/entities'

export const extensions: EntityExtension[] = [
  {
    base: 'resources:resources_resource',
    extension: 'logistics:vehicle_profile',
    join: { baseKey: 'id', extensionKey: 'resource_id' },
    table: 'logistics_vehicle_profiles',
    cardinality: 'one-to-one',
  },
  {
    base: 'staff:staff_team_member',
    extension: 'logistics:driver_profile',
    join: { baseKey: 'id', extensionKey: 'staff_member_id' },
    table: 'logistics_driver_profiles',
    cardinality: 'one-to-one',
  },
]

export default extensions
