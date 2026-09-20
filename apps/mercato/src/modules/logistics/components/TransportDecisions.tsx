'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TransportDetail } from '../types'

type Decision = { action: 'approve_carrier' | 'reject_carrier' | 'accept_load' | 'reject_load'; offerId?: string; orderId?: string }

export function TransportDecisions({ transport, onChanged, onReload }: {
  transport: TransportDetail
  onChanged: (value: TransportDetail) => void
  onReload: () => void
}) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const scopeRef = React.useRef(scopeVersion)
  scopeRef.current = scopeVersion
  const mountedRef = React.useRef(true)
  React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const [saving, setSaving] = React.useState(false)
  const savingRef = React.useRef(false)
  const [failed, setFailed] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'logistics.dispatcher' })
  const carrierApproved = transport.order2?.status === 'approved' || transport.order2?.status === 'confirmed'
  const fits = (pallets: unknown, weight: unknown) => transport.order1.status === 'confirmed' && carrierApproved
    && typeof pallets === 'number' && Number.isFinite(pallets) && typeof weight === 'number' && Number.isFinite(weight)
    && pallets >= 0 && weight >= 0 && (pallets > 0 || weight > 0) && transport.freeSpace?.pallets != null && transport.freeSpace.kg != null
    && pallets <= transport.freeSpace.pallets && weight <= transport.freeSpace.kg

  const decide = async (decision: Decision) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setFailed(false)
    setSaved(false)
    const decisionScope = scopeVersion
    const isCurrent = () => mountedRef.current && scopeRef.current === decisionScope
    const payload = { ...decision, transportVersion: transport.transportVersion }
    try {
      await runMutation({
        context: {
          formId: 'logistics.dispatcher',
          entityId: 'sales:sales_order',
          resourceKind: 'sales.order',
          resourceId: transport.order1.id,
          retryLastMutation,
        },
        mutationPayload: payload,
        operation: async () => {
          if (!isCurrent()) return
          const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(transport.updatedAt), () =>
            apiCallOrThrow<{ item: TransportDetail }>(`/api/logistics/transports/${transport.order1.id}/decision`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            }))
          if (!isCurrent()) return
          const item = response.result?.item
          if (item) onChanged(item)
          setSaved(true)
        },
      })
    } catch (error) {
      if (!isCurrent()) return
      if (surfaceRecordConflict(error, t)) onReload()
      else setFailed(true)
    } finally {
      savingRef.current = false
      if (isCurrent()) setSaving(false)
    }
  }

  return <section className="space-y-4 rounded-lg border border-border bg-card p-4 md:p-6">
    <SectionHeader title={t('logistics.transport.decisions')} />
    {transport.order2?.status === 'pending_approval' ? <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={saving} onClick={() => void decide({ action: 'approve_carrier' })}>{t('logistics.dispatcher.approveCarrier')}</Button>
      <Button type="button" variant="destructive" disabled={saving} onClick={() => void decide({ action: 'reject_carrier' })}>{t('logistics.dispatcher.rejectCarrier')}</Button>
    </div> : null}
    {transport.additionalLoads.filter((order) => order.status === 'pending_approval').map((order) => <div key={order.id} className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">{order.orderNumber}</span>
      <Button type="button" variant="outline" disabled={saving || !fits(order.fields.cargo_pallets, order.fields.cargo_weight_kg)}
        aria-label={`${t('logistics.dispatcher.acceptAdditional')}: ${order.orderNumber}`}
        onClick={() => void decide({ action: 'accept_load', orderId: order.id })}>{t('logistics.dispatcher.acceptAdditional')}</Button>
      <Button type="button" variant="destructive" disabled={saving} aria-label={`${t('logistics.transport.rejectLoad')}: ${order.orderNumber}`}
        onClick={() => void decide({ action: 'reject_load', orderId: order.id })}>{t('logistics.transport.rejectLoad')}</Button>
    </div>)}
    {saving ? <LoadingMessage label={t('logistics.dispatcher.saving')} /> : null}
    {failed ? <ErrorMessage label={t('logistics.dispatcher.saveFailed')} /> : null}
    {saved ? <p role="status" className="text-sm text-status-success-text">{t('logistics.dispatcher.saved')}</p> : null}
  </section>
}
