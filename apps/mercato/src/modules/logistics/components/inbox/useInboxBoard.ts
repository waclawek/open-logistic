'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { splitInbox, type InboxAction, type InboxBoard, type InboxEmailDetail, type InboxProposalSummary, type OfferCard, type ReplyCard } from '../../lib/inbox-board'

export const INBOX_POLL_MS = 10000
const PAGE_SIZE = 50

type ActionWithVersion = InboxAction & { updatedAt?: string }
type ProposalDetail = { proposal: InboxProposalSummary; actions: ActionWithVersion[]; email: InboxEmailDetail | null }
type AcceptResponse = { ok: boolean; error?: string; action?: { createdEntityId?: string | null; createdEntityType?: string | null } | null }

/** Both open statuses: `partial` is a proposal where some actions were already handled. */
const OPEN_STATUSES = ['pending', 'partial'] as const

async function fetchOpenProposals(signal?: AbortSignal): Promise<InboxProposalSummary[]> {
  const pages = await Promise.all(OPEN_STATUSES.map(async (status) => {
    const params = new URLSearchParams({ status, page: '1', pageSize: String(PAGE_SIZE) })
    const call = await apiCallOrThrow<{ items: InboxProposalSummary[] }>(`/api/inbox_ops/proposals?${params.toString()}`, { signal })
    return call.result?.items ?? []
  }))
  return pages.flat()
}

/**
 * Loads open proposals with their actions and splits them into the two columns.
 * Polls while visible so new AI proposals appear without a manual refresh.
 */
export function useInboxBoard() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [proposals, setProposals] = React.useState<InboxProposalSummary[]>([])
  const [actions, setActions] = React.useState<Record<string, ActionWithVersion[] | undefined>>({})
  const [emails, setEmails] = React.useState<Record<string, InboxEmailDetail | null | undefined>>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const items = await fetchOpenProposals(signal)
      const details = await Promise.all(items.map(async (item) => {
        const call = await apiCallOrThrow<ProposalDetail>(`/api/inbox_ops/proposals/${item.id}`, { signal })
        return [item.id, call.result?.actions ?? [], call.result?.email ?? null] as const
      }))
      if (signal?.aborted) return
      setProposals(items)
      setActions(Object.fromEntries(details.map(([id, list]) => [id, list])))
      setEmails(Object.fromEntries(details.map(([id, , email]) => [id, email])))
      setError(null)
    } catch (loadError) {
      if (signal?.aborted || (loadError instanceof Error && loadError.name === 'AbortError')) return
      setError(loadError instanceof Error ? loadError.message : t('logistics.aiInbox.errors.load'))
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
    }, INBOX_POLL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [load, reloadToken, scopeVersion])

  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  const actionUrl = (proposalId: string, actionId: string) => `/api/inbox_ops/proposals/${proposalId}/actions/${actionId}`

  /**
   * Accepting an offer executes the Inbox action, which creates the Sales quote.
   * TODO(Order 1): once the team settles the quote → order step (PR #17 discussion), convert the
   * created quote here — the response already carries `action.createdEntityId`.
   */
  const acceptOffer = React.useCallback(async (offer: OfferCard) => {
    if (busyId) return
    setBusyId(offer.actionId)
    try {
      const result = await apiCall<AcceptResponse>(`${actionUrl(offer.proposalId, offer.actionId)}/accept`, { method: 'POST' })
      if (result.ok && result.result?.ok) {
        flash(t('logistics.aiInbox.offers.accepted', { customer: offer.customerName }), 'success')
      } else {
        flash(result.result?.error || t('logistics.aiInbox.offers.acceptFailed'), 'error')
      }
    } finally {
      setBusyId(null)
      reload()
    }
  }, [busyId, reload, t])

  const rejectAction = React.useCallback(async (proposalId: string, actionId: string) => {
    if (busyId) return
    setBusyId(actionId)
    try {
      const result = await apiCall<{ ok: boolean; error?: string }>(`${actionUrl(proposalId, actionId)}/reject`, { method: 'POST' })
      if (!(result.ok && result.result?.ok)) flash(result.result?.error || t('logistics.aiInbox.errors.reject'), 'error')
    } finally {
      setBusyId(null)
      reload()
    }
  }, [busyId, reload, t])

  /** Saves an edited body, approves the draft, then hands it to the mail service. */
  const sendReply = React.useCallback(async (reply: ReplyCard, body: string) => {
    if (busyId) return
    setBusyId(reply.actionId)
    try {
      const action = actions[reply.proposalId]?.find((entry) => entry.id === reply.actionId)
      if (body !== reply.body) {
        await withScopedApiRequestHeaders(buildOptimisticLockHeader(action?.updatedAt), () =>
          apiCallOrThrow(actionUrl(reply.proposalId, reply.actionId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payload: { body } }),
          }))
      }
      const accepted = await apiCall<{ ok: boolean; error?: string }>(`${actionUrl(reply.proposalId, reply.actionId)}/accept`, { method: 'POST' })
      if (!(accepted.ok && accepted.result?.ok)) {
        flash(accepted.result?.error || t('logistics.aiInbox.replies.sendFailed'), 'error')
        return
      }
      const sent = await apiCall<{ ok: boolean; error?: string }>(`/api/inbox_ops/proposals/${reply.proposalId}/replies/${reply.actionId}/send`, { method: 'POST' })
      if (sent.ok && sent.result?.ok) {
        flash(t('logistics.aiInbox.replies.sent', { to: reply.toName ?? reply.to ?? '' }), 'success')
      } else if (sent.status === 503) {
        flash(t('logistics.aiInbox.replies.approvedNoMail'), 'warning')
      } else {
        flash(sent.result?.error || t('logistics.aiInbox.replies.sendFailed'), 'error')
      }
    } catch (sendError) {
      flash(sendError instanceof Error ? sendError.message : t('logistics.aiInbox.replies.sendFailed'), 'error')
    } finally {
      setBusyId(null)
      reload()
    }
  }, [actions, busyId, reload, t])

  const board = React.useMemo<InboxBoard>(() => splitInbox(proposals, actions), [proposals, actions])

  return { board, emails, loading, error, busyId, reload, acceptOffer, rejectAction, sendReply }
}
