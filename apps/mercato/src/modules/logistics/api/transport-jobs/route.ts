import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadCarriers, loadTransportJobs, loadVehicles } from '../../lib/jobs'
import { priceJob } from '../../lib/pricing'

const logger = createLogger('logistics').child({ component: 'transport-jobs-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

/**
 * Transport jobs = sales orders carrying the logistics custom fields, enriched
 * with a deterministic pricing recommendation for each one.
 */
export async function GET() {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!auth.orgId) return Response.json({ error: 'Organization scope required' }, { status: 400 })
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const container = await createRequestContainer()
    const [jobs, carriers, vehicles] = await Promise.all([
      loadTransportJobs(container, scope),
      loadCarriers(container, scope),
      loadVehicles(container, scope),
    ])
    const items = jobs.map((job) => ({
      ...job,
      pricing: priceJob({
        from: job.pickupAddress,
        to: job.deliveryAddress,
        pallets: job.pallets,
        weightKg: job.weightKg,
        clientPrice: job.clientPrice,
        maxCarrierCost: job.maxCarrierCost,
        carriers,
        vehicles,
      }),
    }))
    return Response.json({ items, carriers, vehicles })
  } catch (error) {
    logger.error('Failed to load transport jobs', { err: error })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
