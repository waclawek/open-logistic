import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['trans_inbox.*'],
    admin: ['trans_inbox.*'],
  },
}

export default setup
