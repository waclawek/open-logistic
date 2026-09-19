import { dataTableExtensionHost, defineModuleExtensionPoints } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'logistics',
  hosts: {
    offersTable: dataTableExtensionHost({ tableId: 'logistics.offers.list', source: 'components/DispatcherPanel.tsx' }),
    transportsTable: dataTableExtensionHost({ tableId: 'logistics.transports.list', source: 'components/DispatcherPanel.tsx' }),
  },
})
