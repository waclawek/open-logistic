'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, FileCheck2, Inbox, MailQuestion, RefreshCw } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import type { InboxEmailDetail, OfferCard, OtherCard, ReplyCard } from '../../lib/inbox-board'
import { useInboxBoard } from './useInboxBoard'

function proposalHref(proposalId: string): string {
  return `/backend/inbox-ops/proposals/${proposalId}`
}

/** Card header; clicking it toggles the full email history underneath. */
function CardHeader({ subject, from, receivedAt, confidence, expanded, onToggle }: {
  subject: string | null
  from: string | null
  receivedAt: string
  confidence: number | null
  expanded: boolean
  onToggle: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(receivedAt))
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-left"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{subject || '—'}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {from ? `${from} · ` : ''}{when}
        {confidence != null ? ` · ${t('logistics.aiInbox.confidence', { value: confidence })}` : ''}
      </span>
    </button>
  )
}

/** The whole conversation behind a proposal: thread messages, or the cleaned email text. */
function EmailHistory({ email }: { email: InboxEmailDetail | null | undefined }) {
  const t = useT()
  const locale = useLocale()
  const messages = email?.threadMessages ?? []
  const fallback = email?.cleanedText ?? email?.rawText ?? null
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-3" data-testid="inbox-email-history">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('logistics.aiInbox.history.title')}</p>
      {messages.length > 0 ? messages.map((message, index) => (
        <div key={index} className="rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{message.from?.name || message.from?.email || t('logistics.aiInbox.history.unknownSender')}</span>
            <span className="text-xs text-muted-foreground">
              {message.from?.email ? `${message.from.email} · ` : ''}
              {message.date ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(message.date)) : ''}
            </span>
          </div>
          {message.subject ? <p className="mt-1 text-xs text-muted-foreground">{message.subject}</p> : null}
          <p className="mt-2 whitespace-pre-wrap text-sm">{message.body ?? ''}</p>
        </div>
      )) : fallback ? (
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{email?.forwardedByName || email?.forwardedByAddress || t('logistics.aiInbox.history.unknownSender')}</span>
            {email?.forwardedByAddress ? <span className="text-xs text-muted-foreground">{email.forwardedByAddress}</span> : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{fallback}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('logistics.aiInbox.history.empty')}</p>
      )}
    </div>
  )
}

type CardShellProps = {
  email: InboxEmailDetail | null | undefined
  expanded: boolean
  onToggle: () => void
}

function ReplyItem({ reply, busy, onSend, onReject, email, expanded, onToggle }: CardShellProps & {
  reply: ReplyCard
  busy: boolean
  onSend: (body: string) => void
  onReject: () => void
}) {
  const t = useT()
  const [body, setBody] = React.useState(reply.body)
  React.useEffect(() => setBody(reply.body), [reply.body])
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3" data-testid="inbox-reply">
      <CardHeader subject={reply.subject} from={reply.emailFrom} receivedAt={reply.receivedAt} confidence={reply.confidence} expanded={expanded} onToggle={onToggle} />
      <p className="text-xs text-muted-foreground">{reply.summary}</p>
      {expanded ? <EmailHistory email={email} /> : null}
      <p className="text-xs text-muted-foreground">
        {t('logistics.aiInbox.replies.to', { to: reply.toName ? `${reply.toName} <${reply.to ?? ''}>` : reply.to ?? '—' })}
      </p>
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={expanded ? 6 : 4}
        aria-label={t('logistics.aiInbox.replies.bodyLabel')}
        className="text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || !body.trim()} onClick={() => onSend(body)}>
          {busy ? t('logistics.dispatcher.saving') : t('logistics.aiInbox.replies.send')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReject}>{t('logistics.aiInbox.reject')}</Button>
        <Button asChild type="button" size="sm" variant="link" className="ml-auto px-0">
          <a href={proposalHref(reply.proposalId)}>{t('logistics.aiInbox.details')}</a>
        </Button>
      </div>
    </li>
  )
}

function OfferItem({ offer, busy, onAccept, onReject, email, expanded, onToggle }: CardShellProps & {
  offer: OfferCard
  busy: boolean
  onAccept: () => void
  onReject: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const money = (value: number | null) => value == null
    ? null
    : new Intl.NumberFormat(locale, { style: 'currency', currency: offer.currencyCode, maximumFractionDigits: 0 }).format(value)
  const transport = offer.transport
  const cargo = transport
    ? [transport.cargoPallets != null ? `${transport.cargoPallets} EP` : null, transport.cargoWeightKg != null ? `${new Intl.NumberFormat(locale).format(transport.cargoWeightKg)} kg` : null].filter(Boolean).join(' · ')
    : ''
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3" data-testid="inbox-offer">
      <CardHeader subject={offer.emailSubject} from={offer.emailFrom} receivedAt={offer.receivedAt} confidence={offer.confidence} expanded={expanded} onToggle={onToggle} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{offer.customerName}</p>
        <p className="text-base font-semibold">{money(offer.total) ?? t('logistics.aiInbox.offers.noPrice')}</p>
      </div>
      {transport && (transport.pickupAddress || transport.deliveryAddress) ? (
        <p className="text-sm">
          {transport.pickupAddress ?? '—'} → {transport.deliveryAddress ?? '—'}{cargo ? ` · ${cargo}` : ''}
        </p>
      ) : null}
      <ul className="text-xs text-muted-foreground">
        {offer.lines.map((line, index) => (
          <li key={index}>
            {line.name}{line.quantity != null ? ` × ${line.quantity}` : ''}{line.unitPrice != null ? ` · ${money(line.unitPrice)}` : ''}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{offer.summary}</p>
      {expanded ? <EmailHistory email={email} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onAccept}>
          {busy ? t('logistics.dispatcher.saving') : t('logistics.aiInbox.offers.accept')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReject}>{t('logistics.aiInbox.reject')}</Button>
        <Button asChild type="button" size="sm" variant="link" className="ml-auto px-0">
          <a href={proposalHref(offer.proposalId)}>{t('logistics.aiInbox.details')}</a>
        </Button>
      </div>
    </li>
  )
}

function OtherItem({ card, email, expanded, onToggle }: CardShellProps & { card: OtherCard }) {
  const t = useT()
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 text-sm" data-testid="inbox-other">
      <CardHeader subject={card.emailSubject} from={card.emailFrom} receivedAt={card.receivedAt} confidence={null} expanded={expanded} onToggle={onToggle} />
      <p className="text-xs text-muted-foreground">{card.summary}</p>
      {expanded ? <EmailHistory email={email} /> : null}
      <p className="text-xs text-muted-foreground">
        {t('logistics.aiInbox.others.pending', { count: card.pendingActionTypes.length })}
        {' · '}
        <a className="underline" href={proposalHref(card.proposalId)}>{t('logistics.aiInbox.details')}</a>
      </p>
    </li>
  )
}

function Column({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex min-h-96 flex-col rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{count}</span>
      </header>
      <div className="flex-1 p-3">{children}</div>
    </section>
  )
}

/** AI Inbox: replies to send on the left, offers ready to accept on the right. */
export function AiInboxBoard() {
  const t = useT()
  const inbox = useInboxBoard()
  const { replies, offers, others } = inbox.board
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const toggle = (cardId: string) => setExpandedId((current) => (current === cardId ? null : cardId))

  if (inbox.error && replies.length === 0 && offers.length === 0 && !inbox.loading) {
    return (
      <ErrorMessage
        label={inbox.error}
        action={<Button type="button" size="sm" variant="outline" onClick={inbox.reload}>{t('logistics.actions.retry')}</Button>}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4" data-testid="ai-inbox-board">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">{t('logistics.aiInbox.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('logistics.aiInbox.description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild type="button" size="sm" variant="link" className="px-0">
            <Link href="/backend/inbox-ops">{t('logistics.aiInbox.allProposals')}</Link>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={inbox.reload} disabled={inbox.loading}>
            <RefreshCw className={cn('size-3.5', inbox.loading && 'animate-spin')} />
            {t('logistics.actions.refresh')}
          </Button>
        </div>
      </header>

      {inbox.loading && replies.length === 0 && offers.length === 0 ? <LoadingMessage label={t('logistics.aiInbox.loading')} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Column icon={<MailQuestion className="size-4 text-muted-foreground" />} title={t('logistics.aiInbox.replies.title')} count={replies.length + others.length}>
          {replies.length === 0 && others.length === 0 ? (
            <EmptyState title={t('logistics.aiInbox.replies.empty.title')} description={t('logistics.aiInbox.replies.empty.description')} icon={<Inbox className="size-5" />} />
          ) : (
            <ul className="flex flex-col gap-3">
              {replies.map((reply) => (
                <ReplyItem
                  key={reply.actionId}
                  reply={reply}
                  email={inbox.emails[reply.proposalId]}
                  expanded={expandedId === reply.actionId}
                  onToggle={() => toggle(reply.actionId)}
                  busy={inbox.busyId === reply.actionId}
                  onSend={(body) => void inbox.sendReply(reply, body)}
                  onReject={() => void inbox.rejectAction(reply.proposalId, reply.actionId)}
                />
              ))}
              {others.map((card) => (
                <OtherItem
                  key={card.proposalId}
                  card={card}
                  email={inbox.emails[card.proposalId]}
                  expanded={expandedId === `other:${card.proposalId}`}
                  onToggle={() => toggle(`other:${card.proposalId}`)}
                />
              ))}
            </ul>
          )}
        </Column>

        <Column icon={<FileCheck2 className="size-4 text-muted-foreground" />} title={t('logistics.aiInbox.offers.title')} count={offers.length}>
          {offers.length === 0 ? (
            <EmptyState title={t('logistics.aiInbox.offers.empty.title')} description={t('logistics.aiInbox.offers.empty.description')} icon={<FileCheck2 className="size-5" />} />
          ) : (
            <ul className="flex flex-col gap-3">
              {offers.map((offer) => (
                <OfferItem
                  key={offer.actionId}
                  offer={offer}
                  email={inbox.emails[offer.proposalId]}
                  expanded={expandedId === offer.actionId}
                  onToggle={() => toggle(offer.actionId)}
                  busy={inbox.busyId === offer.actionId}
                  onAccept={() => void inbox.acceptOffer(offer)}
                  onReject={() => void inbox.rejectAction(offer.proposalId, offer.actionId)}
                />
              ))}
            </ul>
          )}
        </Column>
      </div>
    </div>
  )
}
