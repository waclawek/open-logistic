import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TransportsTable } from '../../../components/TransportsTable'

export default function TransportsPage() {
  return <Page data-testid="logistics-page"><PageBody><TransportsTable /></PageBody></Page>
}
