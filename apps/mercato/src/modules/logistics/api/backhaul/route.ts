import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadTransportJobs, loadVehicles } from '../../lib/jobs'
import { findBackhaulProposals } from '../../lib/backhaul'

const logger = createLogger('logistics').child({ component: 'backhaul-route' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

export const HOME_BASE = 'Wrocław'

/** Pairs of transport jobs that can share one truck so it does not return empty. */
export async function GET() {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!auth.orgId) return Response.json({ error: 'Organization scope required' }, { status: 400 })
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const container = await createRequestContainer()
    const [jobs, vehicles] = await Promise.all([loadTransportJobs(container, scope), loadVehicles(container, scope)])
    const proposals = findBackhaulProposals(jobs, HOME_BASE)
    const emptyKmToday = jobs.reduce((sum, job) => sum + (job.dispatchMode === 'own_fleet' ? 0 : 0), 0)
    return Response.json({ proposals, jobs, vehicles, homeBase: HOME_BASE, emptyKmToday })
  } catch (error) {
    logger.error('Failed to compute backhaul proposals', { err: error })
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
