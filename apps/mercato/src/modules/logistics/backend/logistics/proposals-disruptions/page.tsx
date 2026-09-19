import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { DisruptionsBoard } from '../../../components/DisruptionsBoard'

export default function LogisticsPrototypePage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="proposalsDisruptions" />
      <PageBody>
        <DisruptionsBoard />
      </PageBody>
    </Page>
  )
}
