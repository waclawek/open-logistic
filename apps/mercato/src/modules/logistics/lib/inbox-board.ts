/**
 * Splits pending Inbox Ops proposals into the two AI Inbox columns:
 * replies to send (left) and offers ready to accept (right).
 * Pure functions over API shapes, so the board can be unit-tested without the network.
 */

export type InboxProposalSummary = {
  id: string
  summary: string
  category: string | null
  status: string
  confidence: string | number | null
  emailSubject: string | null
  emailFrom: string | null
  receivedAt: string
  pendingActionCount?: number
}

export type InboxThreadMessage = {
  from?: { name?: string; email?: string } | null
  date?: string | null
  subject?: string | null
  body?: string | null
}

/** The source email of a proposal, as returned by GET /api/inbox_ops/proposals/:id. */
export type InboxEmailDetail = {
  subject?: string | null
  forwardedByName?: string | null
  forwardedByAddress?: string | null
  receivedAt?: string | null
  cleanedText?: string | null
  rawText?: string | null
  threadMessages?: InboxThreadMessage[] | null
}

export type InboxAction = {
  id: string
  actionType: string
  status: string
  description: string
  confidence: string | number | null
  payload: Record<string, unknown>
  createdEntityId?: string | null
  createdEntityType?: string | null
}

type CardBase = {
  proposalId: string
  actionId: string
  summary: string
  emailSubject: string | null
  emailFrom: string | null
  receivedAt: string
  confidence: number | null
}

export type ReplyCard = CardBase & {
  to: string | null
  toName: string | null
  subject: string
  body: string
}

export type OfferLine = { name: string; quantity: number | null; unitPrice: number | null }

export type OfferCard = CardBase & {
  actionType: string
  customerName: string
  customerEmail: string | null
  currencyCode: string
  lines: OfferLine[]
  total: number | null
  transport: {
    pickupAddress: string | null
    deliveryAddress: string | null
    pickupWindowStart: string | null
    cargoPallets: number | null
    cargoWeightKg: number | null
  } | null
}

/** Proposals with pending work that is neither a reply nor an offer (order updates, activity logs…). */
export type OtherCard = {
  proposalId: string
  summary: string
  category: string | null
  emailSubject: string | null
  emailFrom: string | null
  receivedAt: string
  pendingActionTypes: string[]
}

export type InboxBoard = { replies: ReplyCard[]; offers: OfferCard[]; others: OtherCard[] }

/** Action types that put a proposal in the "offers to accept" column. `draft_offer` is the priced variant. */
export const OFFER_ACTION_TYPES = new Set(['create_quote', 'draft_offer'])
export const REPLY_ACTION_TYPES = new Set(['draft_reply'])

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function confidenceOf(value: string | number | null | undefined): number | null {
  const parsed = asNumber(value)
  return parsed == null ? null : Math.round(parsed * 100)
}

function offerLines(payload: Record<string, unknown>): OfferLine[] {
  const raw = Array.isArray(payload.lineItems) ? payload.lineItems : []
  return raw
    .filter((line): line is Record<string, unknown> => typeof line === 'object' && line !== null)
    .map((line) => ({
      name: asString(line.productName) ?? asString(line.description) ?? '',
      quantity: asNumber(line.quantity),
      unitPrice: asNumber(line.unitPrice) ?? asNumber(line.catalogPrice),
    }))
}

function offerTotal(lines: OfferLine[]): number | null {
  if (lines.length === 0) return null
  let total = 0
  for (const line of lines) {
    if (line.quantity == null || line.unitPrice == null) return null
    total += line.quantity * line.unitPrice
  }
  return total
}

function offerTransport(payload: Record<string, unknown>): OfferCard['transport'] {
  const transport = payload.transport
  if (typeof transport !== 'object' || transport === null) return null
  const fields = transport as Record<string, unknown>
  return {
    pickupAddress: asString(fields.pickupAddress),
    deliveryAddress: asString(fields.deliveryAddress),
    pickupWindowStart: asString(fields.pickupWindowStart),
    cargoPallets: asNumber(fields.cargoPallets),
    cargoWeightKg: asNumber(fields.cargoWeightKg),
  }
}

export function splitInbox(
  proposals: InboxProposalSummary[],
  actionsByProposal: Record<string, InboxAction[] | undefined>,
): InboxBoard {
  const board: InboxBoard = { replies: [], offers: [], others: [] }
  for (const proposal of proposals) {
    const actions = actionsByProposal[proposal.id]
    if (!actions) continue
    const base = {
      proposalId: proposal.id,
      summary: proposal.summary,
      emailSubject: proposal.emailSubject,
      emailFrom: proposal.emailFrom,
      receivedAt: proposal.receivedAt,
    }
    const otherTypes: string[] = []
    for (const action of actions) {
      if (action.status !== 'pending') continue
      const card = { ...base, actionId: action.id, confidence: confidenceOf(action.confidence) }
      if (REPLY_ACTION_TYPES.has(action.actionType)) {
        board.replies.push({
          ...card,
          to: asString(action.payload.to),
          toName: asString(action.payload.toName),
          subject: asString(action.payload.subject) ?? proposal.emailSubject ?? '',
          body: asString(action.payload.body) ?? '',
        })
      } else if (OFFER_ACTION_TYPES.has(action.actionType)) {
        const lines = offerLines(action.payload)
        board.offers.push({
          ...card,
          actionType: action.actionType,
          customerName: asString(action.payload.customerName) ?? proposal.emailFrom ?? '',
          customerEmail: asString(action.payload.customerEmail),
          currencyCode: asString(action.payload.currencyCode) ?? 'EUR',
          lines,
          total: offerTotal(lines),
          transport: offerTransport(action.payload),
        })
      } else {
        otherTypes.push(action.actionType)
      }
    }
    if (otherTypes.length > 0) {
      board.others.push({
        proposalId: proposal.id,
        summary: proposal.summary,
        category: proposal.category,
        emailSubject: proposal.emailSubject,
        emailFrom: proposal.emailFrom,
        receivedAt: proposal.receivedAt,
        pendingActionTypes: otherTypes,
      })
    }
  }
  const newestFirst = <T extends { receivedAt: string }>(items: T[]) => items.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
  newestFirst(board.replies)
  newestFirst(board.offers)
  newestFirst(board.others)
  return board
}
