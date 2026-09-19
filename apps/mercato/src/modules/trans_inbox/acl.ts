export const features = [
  { id: 'trans_inbox.view', title: 'View Trans simulator inbox', module: 'trans_inbox' },
  {
    id: 'trans_inbox.manage',
    title: 'Clear / manage Trans simulator inbox',
    module: 'trans_inbox',
    dependsOn: ['trans_inbox.view'],
  },
]
