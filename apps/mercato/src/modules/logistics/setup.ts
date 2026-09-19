import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

/**
 * `dyspozytor` is the demo dispatcher role seeded by `logistics seed-examples`.
 * It sees only what a dispatcher needs: the logistics pages, transport jobs
 * (sales orders), quotes, clients and carriers, the fleet, drivers and the
 * inbox proposals. No catalog, warehouse, payments or settings.
 */
export const DISPATCHER_FEATURES = [
  'logistics.view',
  'dashboards.view',
  'sales.orders.view',
  'sales.orders.manage',
  'sales.quotes.view',
  'sales.quotes.manage',
  'customers.companies.view',
  'customers.people.view',
  'resources.view',
  'staff.view',
  'planner.view',
  'shipping_carriers.view',
  'inbox_ops.proposals.view',
  'inbox_ops.proposals.manage',
  'ai_assistant.view',
] as const

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    admin: ['logistics.view'],
    dyspozytor: [...DISPATCHER_FEATURES],
  },
}
