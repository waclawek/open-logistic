import type { InboxActionDefinition } from '@open-mercato/shared/modules/inbox-actions'
import { inboxActions as salesInboxActions } from '@open-mercato/core/modules/sales/inbox-actions'
import { logisticsQuotePayloadSchema } from './lib/transport-quote'

const salesCreateQuoteAction = salesInboxActions.find((action) => action.type === 'create_quote')

if (!salesCreateQuoteAction) {
  throw new Error('[internal] Sales create_quote inbox action is not registered.')
}

export const inboxActions: InboxActionDefinition[] = [
  {
    ...salesCreateQuoteAction,
    payloadSchema: logisticsQuotePayloadSchema,
    promptSchema: `For freight and transport requests, extend the create_quote payload with transport details:
{ transport: { pickupAddress?: string, deliveryAddress?: string, pickupWindowStart?: ISO-8601 datetime, pickupWindowEnd?: ISO-8601 datetime, deliveryWindowStart?: ISO-8601 datetime, cargoPallets?: non-negative number, cargoWeightKg?: non-negative number, clientPrice?: non-negative number, exchangeSource?: "seed"|"manual"|"trans"|"timocom", exchangeReference?: string, dispatchNote?: string } }`,
    promptRules: [
      'For freight, haulage, shipment, lane, pallet-load, or other transport requests, use create_quote and include a transport object. This transport-specific rule overrides generic create_order guidance, including when the sender says to proceed.',
      'For transport create_quote actions, extract pickup and delivery addresses, pickup and delivery windows, pallet count, cargo weight in kilograms, and the customer price into transport when explicitly stated. Omit any optional value that is not present; do not fabricate it. Do not add internal Logistics metadata fields.',
    ],
    execute: (action, context) => salesCreateQuoteAction.execute(action, context),
  },
]

export default inboxActions
