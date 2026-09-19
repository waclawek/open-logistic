import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadCarriers, loadTransportJobs, loadVehicles } from '../../lib/jobs'
import { priceJob } from '../../lib/pricing'

const logger = createLogger('logistics').child({ component: 'replan-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

/**
 * Self-healing prototype: given an order and the carrier that just cancelled,
 * recompute the best alternative (own truck or another subcontractor) with the
 * same deterministic rules. The dispatcher applies the plan from the UI.
 */
export async function GET(request: Request) {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!auth.orgId) return Response.json({ error: 'Organization scope required' }, { status: 400 })
    const url = new URL(request.url)
    const orderId = url.searchParams.get('orderId')
    const excludeCarrier = url.searchParams.get('excludeCarrier')
    if (!orderId) return Response.json({ error: 'orderId required' }, { status: 400 })
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const container = await createRequestContainer()
    const [jobs, carriers, vehicles] = await Promise.all([
      loadTransportJobs(container, scope),
      loadCarriers(container, scope),
      loadVehicles(container, scope),
    ])
    const job = jobs.find((j) => j.id === orderId)
    if (!job) return Response.json({ error: 'Order not found' }, { status: 404 })
    const remainingCarriers = carriers.filter((c) => c.name !== excludeCarrier)
    const planB = priceJob({
      from: job.pickupAddress,
      to: job.deliveryAddress,
      pallets: job.pallets,
      weightKg: job.weightKg,
      clientPrice: job.clientPrice,
      maxCarrierCost: job.maxCarrierCost,
      carriers: remainingCarriers,
      vehicles,
    })
    const hoursToPickup = job.pickupStart ? Math.round(((new Date(job.pickupStart).getTime() - Date.now()) / 36e5) * 10) / 10 : null
    return Response.json({ job, excludedCarrier: excludeCarrier, planB, hoursToPickup })
  } catch (error) {
    logger.error('Failed to replan', { err: error })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
