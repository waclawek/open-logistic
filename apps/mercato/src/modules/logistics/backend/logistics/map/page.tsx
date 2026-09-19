import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageHeader } from '../../../components/LogisticsPage'
import { FleetMap } from '../../../components/FleetMap'

export default function LogisticsPrototypePage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="map" />
      <PageBody>
        <FleetMap />
      </PageBody>
    </Page>
  )
}
