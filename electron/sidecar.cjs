const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const timeoutMs = 120_000
const stderrMax = 4 * 1024

let child = null
let childDone = Promise.resolve()
let pending = null
let nextId = 1
let stderrBuf = Buffer.alloc(0)
let chain = Promise.resolve()
let lastClose = null
// stop() is final so quit cannot spawn a replacement and leave it behind.
let stopped = false

function candidatePaths() {
  const preferred = process.platform === 'win32' ? 'crunchcalld.exe' : 'crunchcalld'
  const names = [preferred, 'crunchcalld.exe', 'crunchcalld']
  const seen = new Set()
  const paths = []
  const push = (candidate) => {
    if (!candidate || seen.has(candidate)) return
    seen.add(candidate)
    paths.push(candidate)
  }
  const fromEnv = typeof process.env.CRUNCHCALL_ENGINE === 'string' ? process.env.CRUNCHCALL_ENGINE.trim() : ''
  if (fromEnv) push(path.resolve(fromEnv))
  for (const name of names) {
    push(path.resolve(__dirname, '..', 'native', 'target', 'debug', name))
    push(path.resolve(__dirname, '..', 'native', 'target', 'release', name))
  }
  return paths
}

function findBinary() {
  for (const candidate of candidatePaths()) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      /* not a file we can spawn */
    }
  }
  return null
}

function pidAlive(pid) {
  if (!pid) return false
  try {
    // Signal 0 checks that the process still exists. It does not kill it.
    process.kill(pid, 0)
    return true
  } catch (error) {
    return Boolean(error && error.code === 'EPERM')
  }
}

function isAlive(proc) {
  return Boolean(
    proc && proc.exitCode === null && !proc.killed && proc.stdin && proc.stdin.writable && pidAlive(proc.pid),
  )
}

function pushStderr(chunk) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  if (buf.length >= stderrMax) {
    stderrBuf = buf.subarray(buf.length - stderrMax)
    return
  }
  const keep = stderrMax - buf.length
  const prev = stderrBuf.length > keep ? stderrBuf.subarray(stderrBuf.length - keep) : stderrBuf
  stderrBuf = Buffer.concat([prev, buf], prev.length + buf.length)
}

function stderrMessage(fallback) {
  const text = stderrBuf.toString('utf8').trim()
  return text || fallback
}

function failure(code, message) {
  return { ok: false, error: { code, message } }
}

function asResult(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.ok !== 'boolean') {
    return failure('engine_error', 'The local engine returned an unexpected response.')
  }
  if (msg.ok) return { ok: true, result: msg.result }
  const error = msg.error
  if (error && typeof error === 'object') {
    const code = typeof error.code === 'string' && error.code ? error.code : 'engine_error'
    const message = typeof error.message === 'string' && error.message ? error.message : 'The local engine failed.'
    return failure(code, message)
  }
  if (typeof error === 'string' && error) return failure('engine_error', error)
  return failure('engine_error', 'The local engine returned an unexpected response.')
}

function takePending(proc, id) {
  if (!pending || pending.proc !== proc) return null
  if (id != null && String(pending.id) !== String(id)) return null
  const current = pending
  pending = null
  clearTimeout(current.timer)
  return current
}

function attach(proc) {
  stderrBuf = Buffer.alloc(0)
  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity })
  const ignore = () => {}
  rl.on('error', ignore)
  rl.on('line', (line) => {
    const text = String(line).trim()
    if (!text) return
    let msg
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    const current = takePending(proc, msg.id)
    if (current) current.resolve(asResult(msg))
  })

  if (proc.stdin) proc.stdin.on('error', ignore)
  if (proc.stdout) proc.stdout.on('error', ignore)
  if (proc.stderr) proc.stderr.on('error', ignore)
  if (proc.stderr) proc.stderr.on('data', (chunk) => pushStderr(chunk))

  let closed = false
  childDone = new Promise((resolve) => {
    const finish = (result) => {
      if (closed) return
      closed = true
      if (child === proc) child = null
      lastClose = { proc, result }
      const current = takePending(proc)
      if (current) current.resolve(result)
      resolve()
      try {
        rl.close()
      } catch {
        /* already closed */
      }
    }
    proc.forceFinish = () => finish(failure('engine_exited', stderrMessage('The local engine exited.')))
    proc.once('error', (err) => {
      if (err && err.code === 'ENOENT') {
        finish(failure('engine_missing', 'The local engine is not built yet.'))
        return
      }
      const message = err && err.message ? err.message : 'The local engine failed to start.'
      finish(failure('engine_exited', stderrMessage(message)))
    })
    proc.once('exit', (code, signal) => {
      // stderr can arrive in the same turn as exit. Wait for it, but don't hang.
      const fallback = signal
        ? `The local engine exited (${signal}).`
        : `The local engine exited (${code ?? 'unknown'}).`
      const report = () => finish(failure('engine_exited', stderrMessage(fallback)))
      const stderr = proc.stderr
      if (stderr && !stderr.readableEnded) {
        const timer = setTimeout(report, 50)
        stderr.once('end', () => {
          clearTimeout(timer)
          report()
        })
        return
      }
      setImmediate(report)
    })
  })
}

function start(binary) {
  const proc = spawn(binary, [], {
    stdio: 'pipe',
    windowsHide: true,
    env: process.env,
  })
  child = proc
  attach(proc)
  return proc
}

async function ensureChild() {
  if (stopped) return null
  if (isAlive(child)) return child
  await childDone
  if (stopped) return null
  if (isAlive(child)) return child
  const binary = findBinary()
  if (!binary) return null
  return start(binary)
}

function request(proc, method, params) {
  return new Promise((resolve) => {
    if (!isAlive(proc)) {
      const closed = lastClose && lastClose.proc === proc ? lastClose.result : null
      resolve(closed || failure('engine_exited', stderrMessage('The local engine exited.')))
      return
    }
    const id = nextId++
    let line
    try {
      line = `${JSON.stringify({
        id,
        method: String(method || ''),
        params: params && typeof params === 'object' ? params : {},
      })}\n`
    } catch {
      resolve(failure('engine_error', 'Could not encode the request.'))
      return
    }
    const timer = setTimeout(() => {
      const current = takePending(proc, id)
      if (!current) return
      if (child === proc) child = null
      current.resolve(failure('timeout', 'The local engine took too long.'))
      let killed = false
      try {
        killed = proc.kill() !== false
      } catch {
        killed = false
      }
      if (!killed && typeof proc.forceFinish === 'function') proc.forceFinish()
    }, timeoutMs)
    pending = { id, proc, resolve, timer }
    try {
      proc.stdin.write(line, (err) => {
        if (!err) return
        const current = takePending(proc, id)
        if (!current) return
        current.resolve(failure('engine_exited', err.message || 'The local engine stopped accepting requests.'))
      })
    } catch (error) {
      const current = takePending(proc, id)
      if (!current) return
      current.resolve(
        failure(
          'engine_exited',
          error && error.message ? error.message : 'The local engine stopped accepting requests.',
        ),
      )
    }
  })
}

async function invoke(method, params) {
  try {
    if (stopped) return failure('engine_exited', 'The local engine stopped.')
    const proc = await ensureChild()
    if (!proc) {
      if (stopped) return failure('engine_exited', 'The local engine stopped.')
      return failure('engine_missing', 'The local engine is not built yet.')
    }
    return await request(proc, method, params)
  } catch (error) {
    return failure('engine_error', error && error.message ? String(error.message) : 'The local engine failed.')
  }
}

function call(method, params) {
  const run = chain
    .then(() => invoke(method, params))
    .catch((error) => failure('engine_error', error && error.message ? String(error.message) : 'The local engine failed.'))
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function stop() {
  stopped = true
  const proc = child
  child = null
  const current = proc ? takePending(proc) : null
  if (current) current.resolve(failure('engine_exited', stderrMessage('The local engine stopped.')))
  if (!proc || proc.exitCode !== null || proc.killed) return
  try {
    proc.kill()
  } catch {
    /* already exited */
  }
}

module.exports = { call, stop }
