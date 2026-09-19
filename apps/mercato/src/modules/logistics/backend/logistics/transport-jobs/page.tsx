import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { TransportJobsBoard } from '../../../components/TransportJobsBoard'

export default function TransportJobsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="transportJobs" />
      <PageBody>
        <TransportJobsBoard />
      </PageBody>
    </Page>
  )
}
