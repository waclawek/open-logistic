import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { LogisticsAgentInbox } from '../../../components/LogisticsAgentInbox'

export default function ProposalsDisruptionsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="proposalsDisruptions" />
      <PageBody>
        <LogisticsAgentInbox />
      </PageBody>
    </Page>
  )
}
