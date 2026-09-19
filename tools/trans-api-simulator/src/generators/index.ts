import type { GenCtx } from './common'
import {
  freightCreateCompanies,
  freightCreatePublic,
  freightEntityEvent,
  freightOfferAccept,
} from './freight'
import {
  dockAnnouncement,
  orderCreate,
  orderEvent,
  partnerAdd,
  vehicleCreate,
} from './misc'

export type TemplateFn = (ctx: GenCtx) => unknown

const TEMPLATES: Record<string, TemplateFn> = {
  'freight.create.public': freightCreatePublic,
  'freight.create.companies': freightCreateCompanies,
  'freight.offer.accept': freightOfferAccept,
  'freight.event.created': freightEntityEvent,
  'order.create': orderCreate,
  'order.event.created': orderEvent,
  'partner.add': partnerAdd,
  'vehicle.create': vehicleCreate,
  'dock.announcement': dockAnnouncement,
  none: () => undefined,
}

/** Default Trans op for a template when scenario omits `operation`. */
export const TEMPLATE_DEFAULT_OPS: Record<string, string> = {
  'freight.create.public': 'POST /ext/freights-api/v2/freights',
  'freight.create.companies': 'POST /ext/freights-api/v2/freight-companies',
  'freight.offer.accept': 'POST /ext/freights-api/v1/freights/offers/{id}/accept',
  'freight.event.created': 'POST /ext/freights-api/v1/freights',
  'order.create': 'POST /ext/orders-api/v1/orders',
  'order.event.created': 'POST /ext/orders-api/v1/orders',
  'partner.add': 'POST /ext/partners-api/v1/partners',
  'vehicle.create': 'POST /ext/vehicles-api/v1/vehicles',
  'dock.announcement': 'POST /ext/dock-scheduler-api/v2/announcement',
}

export function listTemplates(): string[] {
  return Object.keys(TEMPLATES).filter((k) => k !== 'none').sort()
}

export function generateBody(template: string | undefined, ctx: GenCtx): unknown {
  if (!template || template === 'none') return undefined
  const fn = TEMPLATES[template]
  if (!fn) {
    throw new Error(
      `[internal] Unknown template "${template}". Available: ${listTemplates().join(', ')}`,
    )
  }
  return fn(ctx)
}

export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) return overlay
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return overlay
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(overlay as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v)
  }
  return out
}
