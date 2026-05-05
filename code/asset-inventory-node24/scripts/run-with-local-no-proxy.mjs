import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/run-with-local-no-proxy.mjs <command> [args...]')
  process.exit(1)
}

const noProxyHosts = ['localhost', '127.0.0.1', '::1']
const existingNoProxy = String(process.env.NO_PROXY || process.env.no_proxy || '').trim()
const merged = Array.from(new Set([
  ...existingNoProxy.split(',').map((s) => s.trim()).filter(Boolean),
  ...noProxyHosts,
])).join(',')

const env = {
  ...process.env,
  NO_PROXY: merged,
  no_proxy: merged,
}

const child = spawn(args[0], args.slice(1), {
  stdio: 'inherit',
  shell: true,
  env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

