#!/usr/bin/env node
/**
 * Run Trans.eu + TIMOCOM simulators on a 3s interval into the OM inbox.
 * Ctrl+C kills both.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = {
  ...process.env,
  TARGET_BASE_URL: process.env.TARGET_BASE_URL || 'http://127.0.0.1:3001',
}

const jobs = [
  {
    name: 'trans',
    args: ['trans:sim', 'run', 'tools/trans-api-simulator/scenarios/every-3s.yaml'],
  },
  {
    name: 'timocom',
    args: ['timocom:sim', 'run', 'tools/timocom-api-simulator/scenarios/every-3s.yaml'],
  },
]

const children = jobs.map(({ name, args }) => {
  const child = spawn('yarn', args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
  const prefix = (chunk) => {
    const text = String(chunk)
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      console.log(`[${name}] ${line}`)
    }
  }
  child.stdout?.on('data', prefix)
  child.stderr?.on('data', prefix)
  child.on('exit', (code, signal) => {
    console.log(`[${name}] exited code=${code} signal=${signal ?? ''}`)
  })
  return child
})

console.log(
  `[sim:both:3s] TARGET_BASE_URL=${env.TARGET_BASE_URL} — Trans + TIMOCOM every 3s (ctrl+c to stop)`,
)

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(0), 300).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
