'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { TransportsTable } from './TransportsTable'

export function DispatcherPanelHeader() {
  const t = useT()
  return <PageHeader title={t('logistics.dispatcher.title')} />
}

export function DispatcherPanel({ initialTab = 'inbox' }: { initialTab?: 'inbox' | 'transports' }) {
  const router = useRouter()
  const t = useT()
  React.useEffect(() => { if (initialTab === 'inbox') router.replace('/backend/inbox-ops') }, [initialTab, router])
  return initialTab === 'transports' ? <TransportsTable /> : <LoadingMessage label={t('logistics.transport.loading')} />
}
