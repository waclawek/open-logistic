import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createSourceAvailabilityService, type SourceAvailabilityDependencies } from './services/sourceAvailability'

export function register(container: AppContainer) {
  container.register({
    logisticsSourceAvailabilityService: asFunction((cradle: SourceAvailabilityDependencies) => createSourceAvailabilityService({
      queryEngine: container.hasRegistration('queryEngine') ? cradle.queryEngine : null,
      plannerAvailabilityService: container.hasRegistration('plannerAvailabilityService') ? cradle.plannerAvailabilityService : null,
    })).scoped().proxy(),
  })
}
