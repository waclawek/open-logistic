import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { BackhaulBoard } from '../../../components/BackhaulBoard'

export default function TripsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="trips" />
      <PageBody>
        <BackhaulBoard />
      </PageBody>
    </Page>
  )
}
