/**
 * The customer email the demo is built around, in one place.
 *
 * `offers-send-email` sends these fields to core's inbound webhook as a signed
 * JSON payload and lets core build the row, so the `id` and `messageId` fields
 * below are only what this module PROPOSED: the stored row is core's, and the
 * message id is the only handle that survives the POST.
 *
 * The source module had a second entry point, an offline command that wrote the
 * row itself. It is not ported: this repo demos the production path only, so
 * there is one caller and nothing to keep in step.
 */
export type EnquiryInput = {
  emailId: string
  messageIdPrefix: string
  customerEmail: string
  customerName: string
  contactName: string
  tenantId: string
  organizationId: string
  /**
   * `received` is what the inbound webhook writes and what every extractor's
   * optimistic claim looks for. `processed` is kept in the union only so a
   * caller that writes the row itself can say so; nothing in this port does.
   */
  status: 'received' | 'processed'
  /** Free-text provenance written to `inbox_emails.metadata.seededBy`. */
  seededBy: string
  /**
   * One extra sentence from the customer, appended to the body.
   *
   * This is how an operator changes what the enquiry ASKS for without editing
   * this file: "please quote in USD" produces a real, unforced pricing failure,
   * because the catalogue holds EUR prices only. That is the fail-closed path,
   * demonstrated without faking anything.
   */
  extraNote?: string | null
  /**
   * The whole body, written by the operator (`offers-send-email --body` /
   * `--body-file`).
   *
   * It REPLACES the built-in enquiry rather than being appended to it, because
   * an operator describing a different freight job must not have the Poznań to
   * Rotterdam story still sitting above their text: the extraction would read
   * both and quote the wrong shipment. `extraNote` still appends, to whichever
   * body is in play.
   */
  body?: string | null
  /** Subject line, written by the operator. Falls back to the built-in one. */
  subject?: string | null
  /**
   * Recipient address. This is the value that picks a tenant inside core's
   * webhook, so it is the organization's configured inbox address, read from
   * `inbox_settings`. The fallback below exists only so the pure builder is
   * testable without a database.
   */
  toAddress?: string | null
  now: Date
}

export type SeededEnquiry = {
  id: string
  messageId: string
  forwardedByAddress: string
  forwardedByName: string
  toAddress: string
  subject: string
  replyTo: string
  rawText: string
  cleanedText: string
  detectedLanguage: string
  receivedAt: Date
  status: 'received' | 'processed'
  organizationId: string
  tenantId: string
  metadata: Record<string, unknown>
}

/** The subject used when the operator writes none. */
export const DEFAULT_ENQUIRY_SUBJECT =
  'Request for a transport quote: 8 pallets Poznań to Rotterdam'

/** `cleaned_text` is core's one-paragraph form of the body; this makes one. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function buildDefaultRawText(input: EnquiryInput): string {
  return (
    `Hello,\n\nCould you quote us for a groupage shipment of 8 EUR pallets from our Poznań warehouse to Rotterdam?\nEach pallet is about 1.6 m high and 420 kg. The delivery site has no loading dock, so we need a tail-lift.\nWe need it collected before the end of the month.${
      input.extraNote ? `\n${input.extraNote}` : ''
    }\n\nThanks,\n${input.contactName}\n${input.customerName}`
  )
}

function buildDefaultCleanedText(input: EnquiryInput): string {
  return `Could you quote us for a groupage shipment of 8 EUR pallets from Poznań to Rotterdam? Each pallet is about 1.6 m high and 420 kg. The delivery site has no loading dock, so we need a tail-lift. We need it collected before the end of the month.${
    input.extraNote ? ` ${input.extraNote}` : ''
  }`
}

export function buildEnquiryEmail(input: EnquiryInput): SeededEnquiry {
  const customBody = input.body?.trim() ? input.body.trim() : null
  const note = input.extraNote?.trim() ? input.extraNote.trim() : null
  const customSubject = input.subject?.trim() ? input.subject.trim() : null

  // The operator's text is used verbatim, including its blank lines, with the
  // signature they wrote. `--note` still appends, on its own line, so the flag
  // keeps meaning "one more sentence from the customer" on both paths.
  const rawText = customBody
    ? note
      ? `${customBody}\n${note}`
      : customBody
    : buildDefaultRawText(input)

  const cleanedText = customBody
    ? collapseWhitespace(note ? `${customBody} ${note}` : customBody)
    : buildDefaultCleanedText(input)

  return {
    id: input.emailId,
    messageId: `${input.messageIdPrefix}${input.now.getTime()}@localhost>`,
    forwardedByAddress: input.customerEmail,
    forwardedByName: input.customerName,
    toAddress: input.toAddress?.trim() || 'quotes@logistics.example',
    subject: customSubject ?? DEFAULT_ENQUIRY_SUBJECT,
    replyTo: input.customerEmail,
    rawText,
    cleanedText,
    detectedLanguage: 'en',
    receivedAt: input.now,
    status: input.status,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    metadata: { seededBy: input.seededBy },
  }
}
