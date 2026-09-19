import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DispatcherPanel, DispatcherPanelHeader } from '../../components/DispatcherPanel'

export default function DashboardPage() {
  return <Page data-testid="logistics-page"><DispatcherPanelHeader /><PageBody><DispatcherPanel initialTab="inbox" /></PageBody></Page>
}
