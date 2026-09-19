import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { StatsBoard } from '../../../components/StatsBoard'

export default function LogisticsPrototypePage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="statistics" />
      <PageBody>
        <StatsBoard />
      </PageBody>
    </Page>
  )
}
