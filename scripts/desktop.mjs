import { spawn } from 'node:child_process'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteUrl = process.env.CRUNCHCALL_DEV_URL || 'http://127.0.0.1:5173/'
const electronBin = require('electron')

function ready(url, attempts = 60) {
  return new Promise((resolve, reject) => {
    let left = attempts
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        left -= 1
        if (left <= 0) {
          reject(new Error(`Vite did not start at ${url}`))
          return
        }
        setTimeout(tick, 250)
      })
    }
    tick()
  })
}

const kids = []

function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  kids.push(child)
  return child
}

function shutdown(code = 0) {
  for (const child of kids) {
    if (!child.killed) child.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const vite = run(process.execPath, ['run', 'dev'])
vite.on('exit', (code, signal) => {
  if (signal) return
  if (code && code !== 0) shutdown(code)
})

try {
  await ready(new URL(viteUrl).origin + '/')
} catch (error) {
  console.error(error.message || error)
  shutdown(1)
}

const electron = run(electronBin, ['.'])
electron.on('exit', (code) => shutdown(code ?? 0))
