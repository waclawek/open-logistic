import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { migrateLegacyTransports, systemCommandContext } from './lib/migrate-legacy'
import { seedLogisticsExamples } from './lib/seed-examples'

function parseArgs(rest: string[]) {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part.startsWith('--')) continue
    const [key, value] = part.slice(2).split('=', 2)
    if (value !== undefined) args[key] = value
    else if (rest[index + 1] && !rest[index + 1].startsWith('--')) args[key] = rest[++index]
    else args[key] = true
  }
  const scope = z.object({ tenantId: z.uuid(), organizationId: z.uuid() }).parse({ tenantId: args.tenant ?? args.tenantId, organizationId: args.org ?? args.organizationId })
  return { scope, apply: args.apply === true && args['dry-run'] !== true, channelId: args.channel ? z.uuid().parse(args.channel) : undefined }
}

const migrate: ModuleCli = {
  command: 'migrate-sales',
  async run(rest) {
    const { scope, apply, channelId } = parseArgs(rest)
    const container = await createRequestContainer()
    try {
      const rows = apply
        ? (await container.resolve<CommandBus>('commandBus').execute('logistics.transports.migrate', { input: { channelId }, ctx: systemCommandContext(container, scope) })).result
        : await migrateLegacyTransports(container.resolve<EntityManager>('em'), container, scope, { channelId })
      process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', scope, rows }, null, 2)}\n`)
    } finally { await container.dispose() }
  },
}
const seed: ModuleCli = {
  command: 'seed-examples',
  async run(rest) {
    const { scope } = parseArgs(rest)
    const container = await createRequestContainer()
    try { await seedLogisticsExamples(container.resolve<EntityManager>('em'), container, scope) }
    finally { await container.dispose() }
  },
}
const commands = [migrate, seed]
export default commands
