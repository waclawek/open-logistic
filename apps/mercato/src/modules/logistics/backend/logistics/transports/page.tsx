import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DispatcherPanel, DispatcherPanelHeader } from '../../../components/DispatcherPanel'

export default function TransportsPage() {
  return <Page data-testid="logistics-page"><DispatcherPanelHeader /><PageBody><DispatcherPanel initialTab="transports" /></PageBody></Page>
}
