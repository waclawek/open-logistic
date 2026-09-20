import { z } from 'zod'
import { orderPayloadSchema } from '@open-mercato/core/modules/inbox_ops/data/validators'

export const logisticsQuoteTransportSchema = z.object({
  pickupAddress: z.string().trim().min(1).max(1000).optional(),
  deliveryAddress: z.string().trim().min(1).max(1000).optional(),
  pickupWindowStart: z.iso.datetime().optional(),
  pickupWindowEnd: z.iso.datetime().optional(),
  deliveryWindowStart: z.iso.datetime().optional(),
  cargoPallets: z.number().finite().nonnegative().max(100_000).optional(),
  cargoWeightKg: z.number().finite().nonnegative().max(100_000_000).optional(),
  clientPrice: z.number().finite().nonnegative().max(100_000_000).optional(),
  exchangeSource: z.enum(['seed', 'manual', 'trans', 'timocom']).optional(),
  exchangeReference: z.string().trim().min(1).max(500).optional(),
  dispatchNote: z.string().trim().min(1).max(4000).optional(),
})

export const logisticsQuotePayloadSchema = orderPayloadSchema.extend({
  transport: logisticsQuoteTransportSchema.optional(),
})

export type LogisticsQuoteTransport = z.infer<typeof logisticsQuoteTransportSchema>
