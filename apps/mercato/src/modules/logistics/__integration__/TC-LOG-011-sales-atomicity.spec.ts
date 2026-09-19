import { spawn } from 'node:child_process'
import path from 'node:path'
import { test, expect } from './helpers/fixtures'
import { createDispatcherFixtures, decideTransport } from './helpers/dispatcher'

async function runDatabaseCase(input: { mode: 'rollback' | 'migration'; transportId: string; organizationId: string; offerId?: string }) {
  expect(process.env.DATABASE_URL, 'Managed ephemeral runner must inject DATABASE_URL').toBeTruthy()
  const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT || path.join(process.cwd(), 'apps/mercato'))
  const runner = path.join(appRoot, 'src/modules/logistics/__integration__/helpers/sales-database-runner.mjs')
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn(process.execPath, [runner], { cwd: appRoot, windowsHide: true, env: { ...process.env, OM_INTEGRATION_TEST: 'true', LOGISTICS_DB_TEST_INPUT: JSON.stringify(input) }, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { child.kill(); reject(new Error('Database integration helper timed out')) }, 115_000)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`Database integration helper failed (${code}): ${stderr || stdout}`))
      const result = stdout.trim().split(/\r?\n/).reverse().find((line) => line.startsWith('{"ok":'))
      if (!result) return reject(new Error(`No integration result: ${stderr || stdout}`))
      resolve(JSON.parse(result) as Record<string, unknown>)
    })
  })
}

test('TC-LOG-011 rolls back a created Sales load and all side effects when the parent update fails', async ({ page, logistics }) => {
  await logistics.grant(['logistics.view', 'logistics.manage'])
  await logistics.prepareSales()
  await logistics.authorizeApi()
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const transport = await decideTransport(page.request, await fixtures.createTransport(), 'approve_carrier')
    const offer = await fixtures.createOffer()
    expect(await runDatabaseCase({ mode: 'rollback', transportId: transport.id, organizationId: logistics.organizationId, offerId: offer.id })).toMatchObject({ ok: true, childCreatedBeforeFault: true, rolledBack: true, effects: 0 })
  } finally { await fixtures.cleanup() }
})

test('TC-LOG-011 migrates legacy rows once and preserves accepted load allocations', async ({ page, logistics }) => {
  await logistics.grant(['logistics.view', 'logistics.manage'])
  await logistics.prepareSales()
  await logistics.authorizeApi()
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const transport = await fixtures.createTransport()
    expect(await runDatabaseCase({ mode: 'migration', transportId: transport.id, organizationId: logistics.organizationId })).toMatchObject({ ok: true, idempotent: true, preservedLegacy: true, remappedOffer: true })
  } finally { await fixtures.cleanup() }
})
