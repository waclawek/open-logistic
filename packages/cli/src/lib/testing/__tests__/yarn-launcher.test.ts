import path from 'node:path'
import { resolveEnvironment } from '../../resolver'
import { startYarnRawCommand, terminateProcessTree, type CapturedOutputProcess } from '../integration'

const describeOnWindows = process.platform === 'win32' ? describe : describe.skip

async function closed(child: CapturedOutputProcess) {
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      void terminateProcessTree(child, { gracePeriodMs: 100 }).finally(() => reject(new Error('Test child timed out')))
    }, 10_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolve(code) })
  })
}

describeOnWindows('managed Yarn launch on real Windows', () => {
  it.each([true, false])('retains stdout, stderr, exit code and arguments (silent=%s)', async silent => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const args = ['two words', '& echo injected', '$(not-a-command)', '`literal`']
    const cwd = resolveEnvironment().appDir
    const script = 'process.stdout.write(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),value:process.env.OM_LAUNCH_TEST_VALUE}));process.stderr.write("stderr-probe");process.exitCode=7'
    let child: CapturedOutputProcess | undefined
    try {
      child = startYarnRawCommand(['node', '-e', script, ...args], { ...process.env, OM_LAUNCH_TEST_VALUE: 'test-value' }, { silent, detached: true }, cwd)
      const code = await closed(child)
      if (code !== 7) throw new Error(`Probe exit ${code}: ${child.readCapturedOutput!()}`)
      const captured = child.readCapturedOutput!()
      expect(captured).toContain('--- stderr ---\nstderr-probe\n--- stdout ---\n')
      const payload = JSON.parse(captured.split('--- stdout ---\n')[1]) as { args: string[], cwd: string, value: string }
      expect(payload).toEqual({ args, cwd: path.resolve(cwd), value: 'test-value' })
      if (silent) {
        expect(stdout).not.toHaveBeenCalled()
        expect(stderr).not.toHaveBeenCalled()
      } else {
        expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('test-value')
        expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('stderr-probe')
      }
    } finally {
      stdout.mockRestore(); stderr.mockRestore()
      if (child && child.exitCode === null) await terminateProcessTree(child, { gracePeriodMs: 100 })
    }
  }, 15_000)

  it('retains the existing non-detached Yarn path', async () => {
    const child = startYarnRawCommand(['--version'], process.env, { silent: true })
    expect(await closed(child)).toBe(0)
    expect(child.readCapturedOutput!()).toMatch(/^\d+\.\d+\.\d+/)
  }, 15_000)

  it('reports a missing Yarn command through the wrapper', async () => {
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
    const child = startYarnRawCommand(['--version'], { ...environment, PATH: '' }, { silent: true, detached: true })
    expect(await closed(child)).toBe(1)
    expect(child.readCapturedOutput!()).toMatch(/ENOENT|not recognized/i)
  }, 15_000)

  it('rejects unsafe command arguments before spawning', () => {
    expect(() => startYarnRawCommand(['%PATH%'], process.env, { silent: true, detached: true })).toThrow('unsupported characters')
  })

  it('terminates the wrapper and its live Yarn descendant through the existing tree owner', async () => {
    const child = startYarnRawCommand(['node', '-e', 'process.stdout.write(String(process.pid));setInterval(()=>{},1000)'], process.env, { silent: true, detached: true })
    let descendant = 0
    try {
      descendant = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No descendant pid')), 10_000)
        child.stdout!.once('data', chunk => { clearTimeout(timeout); resolve(Number(String(chunk))) })
        child.once('error', error => { clearTimeout(timeout); reject(error) })
      })
      expect(Number.isInteger(descendant) && descendant > 0).toBe(true)
      expect(descendant).not.toBe(child.pid)
      const completion = closed(child)
      await terminateProcessTree(child, { gracePeriodMs: 100 })
      await completion
      expect(() => process.kill(descendant, 0)).toThrow()
    } finally {
      if (child.exitCode === null) await terminateProcessTree(child, { gracePeriodMs: 100 })
    }
  }, 15_000)
})
