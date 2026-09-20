import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { TransportOrdersPanel } from '../../../components/TransportOrdersPanel'

export default function TransportJobsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="transportJobs" />
      <PageBody>
        <TransportOrdersPanel />
      </PageBody>
    </Page>
  )
}
