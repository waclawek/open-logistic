import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'trans_inbox',
  title: 'Trans Inbox',
  version: '0.1.0',
  description: 'Dev inbox that captures Trans.eu simulator webhooks and streams them live.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

export default metadata
