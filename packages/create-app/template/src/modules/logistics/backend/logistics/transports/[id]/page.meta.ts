export const metadata = {
  requireAuth: true,
  requireFeatures: ['logistics.view'],
  pageTitle: 'Transport details',
  pageTitleKey: 'logistics.transport.entityLabel',
  pageGroup: 'Our company',
  pageGroupKey: 'logistics.nav.group',
  navHidden: true,
  breadcrumb: [
    {
      label: 'AI Transports',
      labelKey: 'logistics.nav.aiTransports',
      href: '/backend/logistics/transports',
    },
  ],
} as const
