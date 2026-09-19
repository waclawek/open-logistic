import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function runSimulators(providers) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const dryRun = process.argv.includes('--dry-run')
  const smoke = process.argv.includes('--smoke')
  if (!dryRun && !process.env.TRANS_INBOX_TOKEN) {
    console.error('Set TRANS_INBOX_TOKEN to the development inbox shared token, or use --smoke --dry-run.')
    process.exitCode = 1
    return
  }
  const tsx = import.meta.resolve('tsx')
  const children = providers.map((provider) => {
    const scenario = smoke ? 'smoke' : 'every-3s'
    const args = [
      '--import',
      tsx,
      path.join(root, 'tools', provider + '-api-simulator', 'src', 'cli.ts'),
      'run',
      path.join(root, 'tools', provider + '-api-simulator', 'scenarios', scenario + '.yaml'),
      ...(dryRun ? ['--dry-run'] : []),
    ]
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, TARGET_BASE_URL: process.env.TARGET_BASE_URL || 'http://127.0.0.1:3000' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const print = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line) console.log('[' + provider + '] ' + line)
    }
    child.stdout.on('data', print)
    child.stderr.on('data', print)
    child.on('error', (error) => {
      console.error('[' + provider + '] ' + error.message)
      process.exitCode = 1
    })
    child.on('exit', (code) => {
      if (code) process.exitCode = code
    })
    return child
  })
  const shutdown = () => {
    for (const child of children) if (!child.killed) child.kill('SIGTERM')
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
