import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadDrivers, loadTransportJobs, loadVehicles } from '../../lib/jobs'
import { estimateRoute, resolvePoint } from '../../lib/geo'

const logger = createLogger('logistics').child({ component: 'fleet-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

/** Fleet, drivers and every job with resolved coordinates (for the map). */
export async function GET() {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!auth.orgId) return Response.json({ error: 'Organization scope required' }, { status: 400 })
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const container = await createRequestContainer()
    const [vehicles, drivers, jobs] = await Promise.all([
      loadVehicles(container, scope),
      loadDrivers(container, scope),
      loadTransportJobs(container, scope),
    ])
    const jobsGeo = jobs.map((job) => {
      const from = resolvePoint(job.pickupAddress)
      const to = resolvePoint(job.deliveryAddress)
      const route = estimateRoute(job.pickupAddress, job.deliveryAddress)
      return { ...job, from: from ? { city: from.city, ...from.point } : null, to: to ? { city: to.city, ...to.point } : null, distanceKm: route.distanceKm }
    })
    const vehiclesGeo = vehicles.map((vehicle) => {
      const assigned = jobsGeo.find((job) => job.assignedVehicle === vehicle.plate)
      const base = resolvePoint(vehicle.homeBase)
      // Prototype position: in transit → halfway along the assigned route, otherwise at home base.
      let position = base ? { ...base.point } : null
      if (vehicle.status === 'in_transit' && assigned?.from && assigned?.to) {
        position = { lat: (assigned.from.lat + assigned.to.lat) / 2, lng: (assigned.from.lng + assigned.to.lng) / 2 }
      }
      return { ...vehicle, position, assignedJob: assigned ? { id: assigned.id, orderNumber: assigned.orderNumber, from: assigned.from?.city ?? null, to: assigned.to?.city ?? null } : null }
    })
    return Response.json({ vehicles: vehiclesGeo, drivers, jobs: jobsGeo })
  } catch (error) {
    logger.error('Failed to load fleet', { err: error })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
