"use client"

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CheckCircle,
  XCircle,
  Pencil,
  AlertTriangle,
  RefreshCw,
  Package,
  FileText,
  MessageSquare,
  Truck,
  UserPlus,
  Link2,
  Activity,
  ShoppingBag,
  ExternalLink,
} from 'lucide-react'
import type { ActionDetail, DiscrepancyDetail } from './types'
import { hasContactNameIssue } from '../../lib/contactValidation'

export { hasContactNameIssue }

/**
 * Resolves discrepancy description i18n keys stored in the database.
 * Falls back to the raw description string for legacy data or LLM-generated descriptions.
 */
export function useDiscrepancyDescriptions(): (description: string, foundValue?: string | null) => string {
  const t = useT()
  const translations: Record<string, string> = {
    'inbox_ops.discrepancy.desc.no_channel': t('inbox_ops.discrepancy.desc.no_channel', 'No sales channel available. Create a channel in Sales settings before accepting this order.'),
    'inbox_ops.discrepancy.desc.no_currency': t('inbox_ops.discrepancy.desc.no_currency', 'No currency could be resolved for this order. Set a currency code or configure a sales channel with a default currency.'),
    'inbox_ops.discrepancy.desc.product_not_matched': t('inbox_ops.discrepancy.desc.product_not_matched', 'Product could not be matched to any catalog product'),
    'inbox_ops.discrepancy.desc.no_matching_contact': t('inbox_ops.discrepancy.desc.no_matching_contact', 'No matching contact found'),
    'inbox_ops.discrepancy.desc.draft_reply_no_contact': t('inbox_ops.discrepancy.desc.draft_reply_no_contact', 'Draft reply target has no matching contact. Create the contact first.'),
    'inbox_ops.discrepancy.desc.duplicate_order_reference': t('inbox_ops.discrepancy.desc.duplicate_order_reference', 'An order with this customer reference already exists'),
  }
  return (description: string, foundValue?: string | null) => {
    const translated = translations[description]
    if (!translated) return description
    if (foundValue && (description === 'inbox_ops.discrepancy.desc.product_not_matched' || description === 'inbox_ops.discrepancy.desc.no_matching_contact')) {
      return `${translated}: ${foundValue}`
    }
    return translated
  }
}

/**
 * Resolves action description i18n keys stored in the database.
 * Auto-generated actions store keys like `inbox_ops.action.desc.create_contact`;
 * LLM-generated actions store plain text which is returned as-is.
 */
export function useActionDescriptionResolver(): (description: string, payload: Record<string, unknown>) => string {
  const t = useT()
  return (description: string, payload: Record<string, unknown>) => {
    if (!description.startsWith('inbox_ops.action.desc.')) return description
    const name = (payload.name as string) || (payload.contactName as string) || ''
    const email = (payload.email as string) || (payload.emailAddress as string) || ''
    const title = (payload.title as string) || ''
    const toName = (payload.toName as string) || (payload.to as string) || ''
    const subject = (payload.subject as string) || ''
    const translations: Record<string, string> = {
      'inbox_ops.action.desc.create_contact': t('inbox_ops.action.desc.create_contact', 'Create contact for {name} ({email})')
        .replace('{name}', name).replace('{email}', email),
      'inbox_ops.action.desc.link_contact': t('inbox_ops.action.desc.link_contact', 'Link {name} ({email}) to existing contact')
        .replace('{name}', name).replace('{email}', email),
      'inbox_ops.action.desc.create_product': t('inbox_ops.action.desc.create_product', 'Create catalog product "{title}"')
        .replace('{title}', title),
      'inbox_ops.action.desc.draft_reply': t('inbox_ops.action.desc.draft_reply', 'Draft reply to {toName}: {subject}')
        .replace('{toName}', toName).replace('{subject}', subject),
    }
    return translations[description] || description
  }
}

const ACTION_TYPE_ICONS: Record<string, React.ElementType> = {
  create_order: Package,
  create_quote: FileText,
  update_order: Package,
  update_shipment: Truck,
  create_contact: UserPlus,
  create_product: ShoppingBag,
  link_contact: Link2,
  log_activity: Activity,
  draft_reply: MessageSquare,
}

export function useActionTypeLabels(): Record<string, string> {
  const t = useT()
  return {
    create_order: t('inbox_ops.action_type.create_order', 'Create Sales Order'),
    create_quote: t('inbox_ops.action_type.create_quote', 'Create Quote'),
    update_order: t('inbox_ops.action_type.update_order', 'Update Order'),
    update_shipment: t('inbox_ops.action_type.update_shipment', 'Update Shipment'),
    create_contact: t('inbox_ops.action_type.create_contact', 'Create Contact'),
    create_product: t('inbox_ops.action_type.create_product', 'Create Product'),
    link_contact: t('inbox_ops.action_type.link_contact', 'Link Contact'),
    log_activity: t('inbox_ops.action_type.log_activity', 'Log Activity'),
    draft_reply: t('inbox_ops.action_type.draft_reply', 'Draft Reply'),
  }
}

export function ConfidenceBadge({ value }: { value: string }) {
  const num = parseFloat(value)
  const pct = Math.round(num * 100)
  const color = num >= 0.8 ? 'text-status-success-text' : num >= 0.6 ? 'text-status-warning-text' : 'text-status-error-text'
  const bgColor = num >= 0.8 ? 'bg-status-success-icon' : num >= 0.6 ? 'bg-status-warning-icon' : 'bg-status-error-icon'
  const width = Math.round(num * 100)
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-medium ${color}`}>{pct}%</span>
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${bgColor} rounded-full`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

type QuoteTotals = {
  currencyCode: string | null
  grandTotalNetAmount: number | null
  grandTotalGrossAmount: number | null
}

function readQuoteTotals(value: unknown): QuoteTotals | null {
  if (!value || typeof value !== 'object') return null
  const items = (value as { items?: unknown }).items
  if (!Array.isArray(items) || items.length === 0) return null
  const first = items[0]
  if (!first || typeof first !== 'object') return null
  const row = first as Record<string, unknown>
  const net = typeof row.grandTotalNetAmount === 'number' ? row.grandTotalNetAmount : null
  const gross = typeof row.grandTotalGrossAmount === 'number' ? row.grandTotalGrossAmount : null
  if (net === null && gross === null) return null
  return {
    currencyCode: typeof row.currencyCode === 'string' ? row.currencyCode : null,
    grandTotalNetAmount: net,
    grandTotalGrossAmount: gross,
  }
}

function formatAmount(amount: number, currencyCode: string | null): string {
  const value = amount.toFixed(2)
  return currencyCode ? `${value} ${currencyCode}` : value
}

/**
 * Grand totals of the quote an accepted action created.
 *
 * Read from the sales quotes list endpoint filtered to one id, which is the
 * same call the quote detail page makes. A failed or empty read renders
 * nothing: the card's existing link must keep working regardless.
 */
function ExecutedQuoteTotals({ quoteId }: { quoteId: string }) {
  const t = useT()
  const [totals, setTotals] = React.useState<QuoteTotals | null>(null)

  React.useEffect(() => {
    let active = true
    const params = new URLSearchParams({ id: quoteId, page: '1', pageSize: '1' })
    apiCall(`/api/sales/quotes?${params.toString()}`)
      .then((result) => {
        if (!active || !result.ok) return
        setTotals(readQuoteTotals(result.result))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [quoteId])

  if (!totals) return null

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {totals.grandTotalNetAmount !== null && (
        <div className="flex items-baseline gap-1">
          <span className="text-xs text-muted-foreground">{t('inbox_ops.quote.total_net', 'Total net')}:</span>
          <span className="text-sm font-medium">{formatAmount(totals.grandTotalNetAmount, totals.currencyCode)}</span>
        </div>
      )}
      {totals.grandTotalGrossAmount !== null && (
        <div className="flex items-baseline gap-1">
          <span className="text-xs text-muted-foreground">{t('inbox_ops.quote.total_gross', 'Total gross')}:</span>
          <span className="text-sm font-medium">{formatAmount(totals.grandTotalGrossAmount, totals.currencyCode)}</span>
        </div>
      )}
    </div>
  )
}

function OrderPreview({ payload }: { payload: Record<string, unknown> }) {
  const t = useT()
  const lineItems = (payload.lineItems as Record<string, unknown>[]) || []
  const customerName = (payload.customerName as string) || ''
  const currencyCode = (payload.currencyCode as string) || ''
  const notes = (payload.notes as string) || ''
  const deliveryDate = (payload.requestedDeliveryDate as string) || ''

  return (
    <div className="mt-2 space-y-2 text-xs">
      {customerName && (
        <div className="flex gap-1">
          <span className="text-muted-foreground">{t('inbox_ops.preview.customer', 'Customer')}:</span>
          <span>{customerName}</span>
          {typeof payload.customerEmail === 'string' && <span className="text-muted-foreground">({payload.customerEmail})</span>}
        </div>
      )}
      {lineItems.length > 0 && (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-2 py-1 font-medium">{t('inbox_ops.preview.product', 'Product')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('inbox_ops.preview.qty', 'Qty')}</th>
                <th className="text-right px-2 py-1 font-medium">{t('inbox_ops.preview.price', 'Price')}</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, index) => (
                <tr key={index} className="border-t">
                  <td className="px-2 py-1">{(item.productName as string) || '—'}</td>
                  <td className="px-2 py-1 text-right">{String(item.quantity ?? '')}</td>
                  <td className="px-2 py-1 text-right">{item.unitPrice ? `${item.unitPrice} ${currencyCode}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(deliveryDate || notes) && (
        <div className="flex flex-wrap gap-3">
          {deliveryDate && (
            <div className="flex gap-1">
              <span className="text-muted-foreground">{t('inbox_ops.preview.delivery', 'Delivery')}:</span>
              <span>{deliveryDate}</span>
            </div>
          )}
          {notes && (
            <div className="flex gap-1">
              <span className="text-muted-foreground">{t('inbox_ops.preview.notes', 'Notes')}:</span>
              <span className="truncate max-w-[200px]">{notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProductPreview({ payload }: { payload: Record<string, unknown> }) {
  const t = useT()
  const title = (payload.title as string) || ''
  const sku = (payload.sku as string) || ''
  const unitPrice = (payload.unitPrice as string) || ''
  const currencyCode = (payload.currencyCode as string) || ''
  const kind = (payload.kind as string) || 'product'

  return (
    <div className="mt-2 space-y-1 text-xs">
      {title && (
        <div className="flex gap-1">
          <span className="text-muted-foreground">{t('inbox_ops.preview.product_title', 'Title')}:</span>
          <span className="font-medium">{title}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {sku && (
          <div className="flex gap-1">
            <span className="text-muted-foreground">{t('inbox_ops.preview.sku', 'SKU')}:</span>
            <span>{sku}</span>
          </div>
        )}
        {unitPrice && (
          <div className="flex gap-1">
            <span className="text-muted-foreground">{t('inbox_ops.preview.price', 'Price')}:</span>
            <span>{unitPrice}{currencyCode ? ` ${currencyCode}` : ''}</span>
          </div>
        )}
        <div className="flex gap-1">
          <span className="text-muted-foreground">{t('inbox_ops.edit_dialog.kind', 'Kind')}:</span>
          <span>{kind}</span>
        </div>
      </div>
    </div>
  )
}

export function ActionCard({
  action,
  discrepancies,
  actionTypeLabels,
  onAccept,
  onReject,
  onRetry,
  onEdit,
  translatedDescription,
  resolveDiscrepancyDescription,
}: {
  action: ActionDetail
  discrepancies: DiscrepancyDetail[]
  actionTypeLabels: Record<string, string>
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onRetry: (id: string) => void
  onEdit: (action: ActionDetail) => void
  translatedDescription?: string
  resolveDiscrepancyDescription?: (description: string, foundValue?: string | null) => string
}) {
  const t = useT()
  const Icon = ACTION_TYPE_ICONS[action.actionType] || Package
  const label = actionTypeLabels[action.actionType] || action.actionType
  const resolveActionDescription = useActionDescriptionResolver()

  const actionDiscrepancies = discrepancies.filter((d) => d.actionId === action.id && !d.resolved)
  const hasBlockingDiscrepancies = actionDiscrepancies.some((d) => d.severity === 'error')
  const displayDescription = translatedDescription || resolveActionDescription(action.description, action.payload)

  if (action.status === 'executed') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-status-success-bg border-status-success-border">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="h-5 w-5 text-status-success-icon flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <p className="text-sm text-muted-foreground">{displayDescription}</p>
        {action.createdEntityId && (
          <div className="mt-2 space-y-3">
            <span className="text-xs text-status-success-text">
              {t('inbox_ops.action.created_entity', 'Created {type}').replace('{type}', action.createdEntityType || '')} · {action.executedAt && new Date(action.executedAt).toLocaleString()}
            </span>
            {(action.actionType === 'create_quote' || action.createdEntityType === 'sales_quote') && (
              <ExecutedQuoteTotals quoteId={action.createdEntityId} />
            )}
            {(action.actionType === 'create_quote' || action.createdEntityType === 'sales_quote') && (
              <div>
                <Button asChild type="button" variant="outline" size="sm" className="h-11 md:h-9">
                  <Link href={`/backend/sales/quotes/${encodeURIComponent(action.createdEntityId)}`}>
                    {t('inbox_ops.action.view_quote_details', 'View quote details')}
                    <ExternalLink className="ml-1.5 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (action.status === 'rejected') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-muted/50 opacity-60">
        <div className="flex items-center gap-2 mb-2">
          <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium line-through">{label}</span>
          <span className="text-xs text-muted-foreground">{t('inbox_ops.status.rejected', 'Rejected')}</span>
        </div>
        <p className="text-sm text-muted-foreground">{displayDescription}</p>
      </div>
    )
  }

  if (action.status === 'failed') {
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-status-error-bg border-status-error-border">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-status-error-icon flex-shrink-0" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-status-error-text">{t('inbox_ops.extraction_failed', 'Failed')}</span>
        </div>
        <p className="text-sm text-muted-foreground">{displayDescription}</p>
        {action.executionError && (
          <p className="text-xs text-status-error-text mt-1">{action.executionError}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onRetry(action.id)}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.retry', 'Retry')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onEdit(action)}
          >
            <Pencil className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.edit', 'Edit')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onReject(action.id)}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.reject', 'Reject')}
          </Button>
        </div>
      </div>
    )
  }

  if (action.status !== 'pending') {
    const isProcessing = action.status === 'processing'
    const statusLabel = action.status === 'accepted'
      ? t('inbox_ops.status.accepted', 'Accepted')
      : isProcessing
        ? t('inbox_ops.status.processing', 'Processing')
        : action.status
    return (
      <div className="border rounded-lg p-3 md:p-4 bg-muted/50">
        <div className="flex items-center gap-2 mb-2">
          {isProcessing ? (
            <RefreshCw className="h-5 w-5 text-muted-foreground flex-shrink-0 animate-spin" />
          ) : (
            <CheckCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        </div>
        <p className="text-sm text-muted-foreground">{displayDescription}</p>
      </div>
    )
  }

  const hasNameIssue = hasContactNameIssue(action)

  return (
    <div className="border rounded-lg p-3 md:p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-5 w-5 text-primary flex-shrink-0" />
        <span className="text-sm font-medium">{label}</span>
        <ConfidenceBadge value={action.confidence} />
      </div>
      <p className="text-sm text-foreground/80 mb-2">{displayDescription}</p>

      {(action.actionType === 'create_order' || action.actionType === 'create_quote') && (
        <OrderPreview payload={action.payload} />
      )}

      {action.actionType === 'create_product' && (
        <ProductPreview payload={action.payload} />
      )}

      {actionDiscrepancies.length > 0 && (
        <div className="mb-3 space-y-1">
          {actionDiscrepancies.map((d) => (
            <div key={d.id} className={`flex items-start gap-2 text-xs rounded px-2 py-1.5 ${
              d.severity === 'error' ? 'bg-status-error-bg text-status-error-text' : 'bg-status-warning-bg text-status-warning-text'
            }`}>
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <div>
                <span>{resolveDiscrepancyDescription ? resolveDiscrepancyDescription(d.description, d.foundValue) : d.description}</span>
                {(d.expectedValue || d.foundValue) && (
                  <div className="mt-0.5 text-overline opacity-80">
                    {d.expectedValue && <span>{t('inbox_ops.discrepancy.expected', 'Expected')}: {d.expectedValue}</span>}
                    {d.expectedValue && d.foundValue && <span> · </span>}
                    {d.foundValue && <span>{t('inbox_ops.discrepancy.found', 'Found')}: {d.foundValue}</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasNameIssue && (
        <div className="mb-3 flex items-start gap-2 text-xs rounded px-2 py-1.5 bg-status-warning-bg text-status-warning-text">
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{action.actionType === 'link_contact'
            ? t('inbox_ops.contact.link_name_missing_warning', 'Contact name is missing. Please edit and provide a name before accepting.')
            : t('inbox_ops.contact.name_missing_warning', 'First and last name could not be extracted. Please edit before accepting.')
          }</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div title={
          hasNameIssue
            ? action.actionType === 'link_contact'
              ? t('inbox_ops.contact.link_name_missing_warning', 'Contact name is missing. Please edit and provide a name before accepting.')
              : t('inbox_ops.contact.name_missing_warning', 'First and last name could not be extracted. Please edit before accepting.')
            : hasBlockingDiscrepancies
              ? t('inbox_ops.action.accept_blocked', 'Resolve errors before accepting')
              : undefined
        }>
          <Button
            type="button"
            size="sm"
            className="h-11 md:h-9"
            onClick={() => onAccept(action.id)}
            disabled={hasBlockingDiscrepancies || hasNameIssue}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            {t('inbox_ops.action.accept', 'Accept')}
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => onEdit(action)}
        >
          <Pencil className="h-4 w-4 mr-1" />
          {t('inbox_ops.action.edit', 'Edit')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => onReject(action.id)}
        >
          <XCircle className="h-4 w-4 mr-1" />
          {t('inbox_ops.action.reject', 'Reject')}
        </Button>
      </div>
    </div>
  )
}
