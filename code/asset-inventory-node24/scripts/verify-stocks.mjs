import { spawn } from 'node:child_process'
import process from 'node:process'

const baseUrl = 'http://127.0.0.1:3001'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.ok) return
    } catch {}
    await sleep(400)
  }
  throw new Error('server health check timed out')
}

async function fetchJson(path) {
  const res = await fetch(`${baseUrl}${path}`)
  const text = await res.text()
  let body = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`non-json response for ${path}: ${text.slice(0, 120)}`)
  }
  if (!res.ok) {
    throw new Error(`${path} failed: HTTP ${res.status} ${body.message || ''}`.trim())
  }
  return body
}

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '3001',
      AUTH_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  try {
    await waitForHealth()

    const overview = await fetchJson('/api/stocks/overview?limit=5')
    if (!Array.isArray(overview.data) || overview.data.length === 0) {
      throw new Error('overview data is empty')
    }
    const symbol = overview.data[0].symbol

    const kline = await fetchJson(`/api/stocks/kline?symbol=${encodeURIComponent(symbol)}&cycle=1w`)
    const bars = kline?.data?.bars || []
    if (!Array.isArray(bars) || bars.length === 0) {
      throw new Error(`kline bars empty for symbol=${symbol}`)
    }

    const sample = bars[0]
    const requiredFields = ['time', 'open', 'high', 'low', 'close', 'volume']
    for (const key of requiredFields) {
      if (sample[key] === null || sample[key] === undefined) {
        throw new Error(`kline missing field: ${key}`)
      }
    }

    console.log(`verify:stocks passed; symbol=${symbol}; bars=${bars.length}`)
  } finally {
    server.kill('SIGTERM')
    await sleep(300)
    if (!server.killed) server.kill('SIGKILL')
  }

  if (stderr.trim()) {
    process.stderr.write(stderr)
  }
}

main().catch((error) => {
  console.error(`verify:stocks failed: ${error.message}`)
  process.exit(1)
})
