import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { installCustomEntitiesFromModules } from '@open-mercato/core/modules/entities/lib/install-from-ce'
import { LOGISTICS_ENTITY_IDS } from './ce'
import { seedLogisticsExamples } from './lib/seed-examples'
import { DISPATCHER_FEATURES } from './lib/constants'

export const setup: ModuleSetupConfig = {
  // `logistics.offers.draft` is the feature the inbox_ops execution engine checks
  // before it will run an accepted `draft_offer` action. Granted to the same
  // roles that already review inbox proposals, so an operator who can open the
  // proposal page can also accept the action without hand-editing a role.
  defaultRoleFeatures: {
    superadmin: ['logistics.*'],
    admin: ['logistics.view', 'logistics.manage', 'logistics.offers.draft'],
    employee: ['logistics.offers.draft'],
    dyspozytor: [...DISPATCHER_FEATURES],
  },
  async onTenantCreated({ em, tenantId }) {
    await installCustomEntitiesFromModules(em, null, { entityIds: [...LOGISTICS_ENTITY_IDS], tenantIds: [tenantId], includeGlobal: false })
  },
  async seedDefaults({ em, tenantId }) {
    await installCustomEntitiesFromModules(em, null, { entityIds: [...LOGISTICS_ENTITY_IDS], tenantIds: [tenantId], includeGlobal: false })
  },
  async seedExamples({ em, container, tenantId, organizationId }) {
    await seedLogisticsExamples(em, container, { tenantId, organizationId })
  },
}
export default setup
