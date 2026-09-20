'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { buildBoardItem, buildNotifications, type BoardNotification, type RouteBoardItem } from '../../lib/routes-board'
import type { TransportDetail, TransportListResponse, TransportRow } from '../../types'

const PAGE_SIZE = 50
export const BOARD_POLL_MS = 8000

export type BoardDecision = 'approve_carrier' | 'reject_carrier' | 'accept_load' | 'reject_load'

type DetailCache = Record<string, TransportDetail | undefined>

/**
 * Loads the transport list, then the detail of every row whose version changed
 * (details carry the loads and the `transportVersion` needed for decisions).
 * Polls while the tab is visible so proposals made by agents show up on their own.
 */
export function useRoutesBoard() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<TransportRow[]>([])
  const [details, setDetails] = React.useState<DetailCache>({})
  const detailsRef = React.useRef<DetailCache>({})
  detailsRef.current = details
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [decidingId, setDecidingId] = React.useState<string | null>(null)
  const [decisionError, setDecisionError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE), sortField: 'updatedAt', sortDir: 'desc' })
      const list = await apiCallOrThrow<TransportListResponse>(
        `/api/logistics/transports?${params.toString()}`,
        { signal },
        { errorMessage: t('logistics.transports.errors.load') },
      )
      if (signal?.aborted) return
      const items = list.result?.items ?? []
      setRows(items)
      const stale = items.filter((row) => detailsRef.current[row.id]?.updatedAt !== row.updatedAt)
      const loaded = await Promise.all(stale.map(async (row) => {
        const call = await apiCallOrThrow<{ item: TransportDetail }>(`/api/logistics/transports/${row.id}`, { signal })
        return [row.id, call.result?.item] as const
      }))
      if (signal?.aborted) return
      setDetails((current) => {
        const next: DetailCache = {}
        for (const row of items) next[row.id] = current[row.id]
        for (const [id, detail] of loaded) if (detail) next[id] = detail
        return next
      })
      setError(null)
    } catch (loadError) {
      if (signal?.aborted || (loadError instanceof Error && loadError.name === 'AbortError')) return
      setError(loadError instanceof Error ? loadError.message : t('logistics.transports.errors.load'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void load(controller.signal)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal)
    }, BOARD_POLL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [load, reloadToken, scopeVersion])

  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  const decide = React.useCallback(async (notification: BoardNotification, action: BoardDecision) => {
    const detail = detailsRef.current[notification.transportId]
    if (!detail || decidingId) return
    setDecidingId(notification.id)
    setDecisionError(null)
    const payload = {
      action,
      transportVersion: detail.transportVersion,
      ...(notification.kind === 'load' ? { orderId: notification.orderId } : {}),
    }
    try {
      const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(detail.updatedAt), () =>
        apiCallOrThrow<{ item: TransportDetail }>(`/api/logistics/transports/${notification.transportId}/decision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }))
      const item = response.result?.item
      if (item) setDetails((current) => ({ ...current, [notification.transportId]: item }))
      reload()
    } catch (decideError) {
      if (surfaceRecordConflict(decideError, t)) reload()
      else setDecisionError(decideError instanceof Error ? decideError.message : t('logistics.dispatcher.saveFailed'))
    } finally {
      setDecidingId(null)
    }
  }, [decidingId, reload, t])

  const items = React.useMemo<RouteBoardItem[]>(() => rows.map((row) => buildBoardItem(row, details[row.id])), [rows, details])
  const notifications = React.useMemo<BoardNotification[]>(
    () => buildNotifications(rows.map((row) => details[row.id]).filter((detail): detail is TransportDetail => Boolean(detail))),
    [rows, details],
  )

  return { items, notifications, loading, error, reload, decide, decidingId, decisionError }
}
