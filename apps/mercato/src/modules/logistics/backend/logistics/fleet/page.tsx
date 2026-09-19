import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { FleetBoard } from '../../../components/FleetBoard'

export default function LogisticsPrototypePage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="fleet" />
      <PageBody>
        <FleetBoard />
      </PageBody>
    </Page>
  )
}
