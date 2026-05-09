import cors from 'cors'
import { execFile as execFileCallback } from 'child_process'
import dotenv from 'dotenv'
import express from 'express'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import path from 'path'
import pg from 'pg'
import { promisify } from 'util'
import { createPreciseSourcingLangGraph } from './agents/preciseSourcingLangGraph.js'
import { buildLangChainToolbox, getLangchainToolCatalog, normalizeToolJsonResult } from './integrations/langchainTools.js'

dotenv.config()

const execFileAsync = promisify(execFileCallback)

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT || 3000)

const dbConfig = {
  host: process.env.DB_HOST || '10.1.1.113',
  port: Number(process.env.DB_PORT || 7300),
  database: process.env.DB_NAME || 'training_exercises',
  user: process.env.DB_USER || 'aoyong',
  password: process.env.DB_PASSWORD || 'aoyong',
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 6000),
  ssl: (process.env.DB_SSL || 'false') === 'true' ? { rejectUnauthorized: false } : false,
}

const schemaName = (process.env.DB_SCHEMA || 'aoyong').trim()
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
  throw new Error(`Invalid DB_SCHEMA: ${schemaName}`)
}

const authEnabled = (process.env.AUTH_ENABLED || 'true') === 'true'
const authBaseUrl = (process.env.AUTH_BASE_URL || 'http://leaf-auth-server.dev.jinxin.cloud').replace(/\/+$/, '')
const oauthClientId = process.env.OAUTH_CLIENT_ID || 'aitraining'
const oauthClientSecret = process.env.OAUTH_CLIENT_SECRET || '29b9635df0164eb890d99a58ffa7f8f2'
const oauthRedirectUri = process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/callback'
const frontendCallbackUrl = process.env.FRONTEND_CALLBACK_URL || 'http://localhost:5173/auth/callback'
const frontendLoginUrl = process.env.FRONTEND_LOGIN_URL || 'http://localhost:5173/login'
const authReachabilityCheck = (process.env.AUTH_REACHABILITY_CHECK || 'true') === 'true'
const authDevBypass = (process.env.AUTH_DEV_BYPASS || 'true') === 'true'
const allowStartWithoutDb = (
  process.env.ALLOW_START_WITHOUT_DB
  || (process.env.NODE_ENV === 'production' ? 'false' : 'true')
) === 'true'
const dbReconnectIntervalMs = Math.max(1000, Number(process.env.DB_RECONNECT_INTERVAL_MS || 10000))
const dbReconnectCooldownMs = Math.max(1000, Number(process.env.DB_RECONNECT_COOLDOWN_MS || 4000))
const embeddingApiKey = toText(process.env.OPENAI_API_KEY || process.env.EMBEDDING_API_KEY)
const embeddingBaseUrl = toText(process.env.OPENAI_BASE_URL || process.env.EMBEDDING_BASE_URL || 'https://api.openai.com')
const qwenEmbeddingApiKey = toText(process.env.QWEN_EMBEDDING_API_KEY || process.env.EMBEDDING_API_KEY)
const qwenEmbeddingBaseUrl = toText(process.env.QWEN_EMBEDDING_BASE_URL || 'https://api.siliconflow.cn/v1')
const qwenEmbeddingModel = 'Qwen/Qwen3-VL-Embedding-8B'
const defaultKbEmbeddingModel = qwenEmbeddingModel

function resolveKnowledgeBaseEmbeddingModel(kb = null) {
  return toText(kb?.config?.embeddingModel) || defaultKbEmbeddingModel
}

function safeHostFromUrl(input) {
  try {
    return new URL(input).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function normalizeHostToken(input) {
  return String(input || '').trim().toLowerCase()
}

const supplierDirectHosts = [
  'chinaautosupplier.com',
  'www.chinaautosupplier.com',
  'qcgys.com',
  'www.qcgys.com',
  'gasgoo.com',
  'www.gasgoo.com',
  'i.gasgoo.com',
  ...String(process.env.SUPPLIER_DIRECT_HOSTS || '').split(','),
]
  .map(normalizeHostToken)
  .filter(Boolean)

const authHost = safeHostFromUrl(authBaseUrl)
const proxyBypassHostSet = new Set(
  [
    dbConfig.host,
    authHost,
    'localhost',
    '127.0.0.1',
    '::1',
    ...supplierDirectHosts,
    ...(String(process.env.PROXY_BYPASS_HOSTS || '').split(',')),
  ]
    .map(normalizeHostToken)
    .filter(Boolean),
)

function mergeNoProxyEnv(hosts) {
  const existing = [
    ...String(process.env.NO_PROXY || '').split(','),
    ...String(process.env.no_proxy || '').split(','),
  ]
    .map(normalizeHostToken)
    .filter(Boolean)
  const merged = [...new Set([...existing, ...hosts])]
  const value = merged.join(',')
  process.env.NO_PROXY = value
  process.env.no_proxy = value
}

function matchesHostRule(hostname, rule) {
  if (!hostname || !rule) return false
  if (rule === hostname) return true
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(2)
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
  }
  if (rule.startsWith('.')) {
    const suffix = rule.slice(1)
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
  }
  return false
}

function shouldBypassProxyForUrl(targetUrl) {
  const host = safeHostFromUrl(targetUrl)
  if (!host) return false
  for (const rule of proxyBypassHostSet) {
    if (matchesHostRule(host, rule)) return true
  }
  return false
}

function shouldUseDirectForSupplierUrl(targetUrl = '') {
  const host = safeHostFromUrl(targetUrl)
  if (!host) return false
  return supplierDirectHosts.some((rule) => matchesHostRule(host, rule))
}

function buildPlaywrightLaunchArgs(targetUrl = '') {
  const args = []
  if (shouldUseDirectForSupplierUrl(targetUrl)) {
    args.push('--no-proxy-server')
    args.push(`--proxy-bypass-list=${supplierDirectHosts.join(';')}`)
  }
  return args
}

const cdpProxyBaseUrl = (process.env.WEB_ACCESS_CDP_BASE_URL || 'http://localhost:3456').replace(/\/+$/, '')

const skillRootDirs = [
  'C:\\Users\\aoyon\\.codex\\skills',
  'E:\\workspaceCodeing\\.agents\\skills',
  'C:\\Users\\aoyon\\.agents\\skills',
]

function resolveSafePath(input = '') {
  return path.resolve(String(input || '').trim())
}

function isPathInsideRoot(targetPath = '', rootPath = '') {
  const resolvedTarget = resolveSafePath(targetPath).toLowerCase()
  const resolvedRoot = resolveSafePath(rootPath).toLowerCase()
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
}

async function readInstalledSkillsFromDisk() {
  const items = []
  for (const root of skillRootDirs) {
    const rootPath = resolveSafePath(root)
    let entries = []
    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = path.join(rootPath, entry.name)
      const skillFile = path.join(dirPath, 'SKILL.md')
      try {
        await fs.access(skillFile)
      } catch {
        continue
      }
      items.push({
        name: entry.name,
        source: dirPath,
        installPath: dirPath,
        description: '技能说明',
      })
    }
  }
  const deduped = new Map()
  for (const item of items) {
    if (!deduped.has(item.name)) deduped.set(item.name, item)
  }
  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

const codexConfigPath = 'C:\\Users\\aoyon\\.codex\\config.toml'
const mcpShadowStatePath = 'C:\\Users\\aoyon\\.codex\\mcp-services.shadow.json'
const agentReachConfigPath = 'C:\\Users\\aoyon\\.agent-reach\\config.yaml'

function toMcpServiceName(input = '') {
  return String(input || '').trim()
}

function parseMcpServerNamesFromToml(text = '') {
  const names = []
  for (const matched of String(text || '').matchAll(/^\s*\[mcp_servers\.([^\]\r\n]+)\]\s*$/gim)) {
    const raw = toText(matched?.[1])
    if (!raw) continue
    names.push(raw.replace(/^["']|["']$/g, ''))
  }
  return [...new Set(names)]
}

async function readMcpShadowState() {
  try {
    const raw = await fs.readFile(mcpShadowStatePath, 'utf8')
    const json = JSON.parse(raw)
    return json && typeof json === 'object' ? json : { disabled: {} }
  } catch {
    return { disabled: {} }
  }
}

async function writeMcpShadowState(state) {
  const next = state && typeof state === 'object' ? state : { disabled: {} }
  await fs.writeFile(mcpShadowStatePath, JSON.stringify(next, null, 2), 'utf8')
}

async function loadConfiguredMcpServices() {
  let configText = ''
  try {
    configText = await fs.readFile(codexConfigPath, 'utf8')
  } catch {
    configText = ''
  }
  const names = parseMcpServerNamesFromToml(configText)
  const rows = []
  for (const name of names) {
    try {
      const { stdout } = await execFileAsync('codex', ['mcp', 'get', name, '--json'], { timeout: 20000 })
      const parsed = JSON.parse(String(stdout || '{}'))
      rows.push({
        name,
        source: 'codex-config',
        installPath: codexConfigPath,
        description: toText(parsed?.description || ''),
        type: toText(parsed?.transport?.type).includes('http') || parsed?.url ? 'http' : 'stdio',
        url: toText(parsed?.transport?.url || parsed?.url || ''),
        command: Array.isArray(parsed?.command)
          ? parsed.command.join(' ')
          : Array.isArray(parsed?.transport?.command)
            ? parsed.transport.command.join(' ')
            : toText(parsed?.command || ''),
        env: parsed?.env && typeof parsed.env === 'object' ? parsed.env : {},
        enabled: true,
      })
    } catch {
      rows.push({
        name,
        source: 'codex-config',
        installPath: codexConfigPath,
        description: '',
        type: 'stdio',
        url: '',
        command: '',
        env: {},
        enabled: true,
      })
    }
  }
  return rows
}

function parseAgentReachConfigValue(text = '', key = '') {
  const keyToken = String(key || '').trim()
  if (!keyToken) return ''
  const matched = String(text || '').match(new RegExp(`^\\s*${keyToken}\\s*:\\s*(.+?)\\s*$`, 'm'))
  if (!matched?.[1]) return ''
  return String(matched[1]).trim().replace(/^['"]|['"]$/g, '')
}

async function loadConfiguredAgentReachServices() {
  let configText = ''
  try {
    configText = await fs.readFile(agentReachConfigPath, 'utf8')
  } catch {
    configText = ''
  }
  const xueqiuCookie = parseAgentReachConfigValue(configText, 'xueqiu_cookie')
  const rows = [
    {
      name: 'wechat',
      source: 'agent-reach',
      installPath: 'C:\\Users\\aoyon\\.agent-reach\\tools\\wechat-article-for-ai',
      description: '微信公众号搜索与文章读取（Agent Reach）',
      type: 'stdio',
      url: '',
      command: 'python mcp_server.py',
      env: {},
      enabled: true,
    },
    {
      name: 'xueqiu',
      source: 'agent-reach',
      installPath: agentReachConfigPath,
      description: '雪球股票行情与社区动态（Agent Reach）',
      type: 'stdio',
      url: '',
      command: 'agent-reach channel xueqiu',
      env: {},
      enabled: Boolean(xueqiuCookie),
    },
  ]
  return rows
}

function isAgentReachVirtualMcp(name = '') {
  const token = toMcpServiceName(name)
  return token === 'wechat' || token === 'xueqiu'
}

const chromeCdpBaseUrl = (process.env.WEB_ACCESS_CHROME_CDP_BASE_URL || 'http://127.0.0.1:9222').replace(/\/+$/, '')

function mapChromeTarget(item = {}) {
  return {
    targetId: toText(item?.id),
    url: toText(item?.url),
    title: toText(item?.title),
    type: toText(item?.type),
    webSocketDebuggerUrl: toText(item?.webSocketDebuggerUrl),
  }
}

async function fetchChromeCdpJson(pathname = '', init = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 15000)))
  try {
    const response = await fetchByNetworkPolicy(`${chromeCdpBaseUrl}${pathname}`, {
      ...init,
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Chrome CDP HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    const text = await response.text()
    return text ? JSON.parse(text) : {}
  } finally {
    clearTimeout(timer)
  }
}

async function evalByChromeCdpTarget(targetId = '', expression = '', timeoutMs = 15000) {
  const normalizedTargetId = toText(targetId)
  if (!normalizedTargetId) throw new Error('Chrome CDP targetId is required')
  const list = await fetchChromeCdpJson('/json/list', {}, timeoutMs)
  const targets = Array.isArray(list) ? list.map((item) => mapChromeTarget(item)) : []
  const target = targets.find((item) => item.targetId === normalizedTargetId)
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`Chrome CDP target not found: ${normalizedTargetId}`)
  }
  const wsUrl = target.webSocketDebuggerUrl
  return await new Promise((resolve, reject) => {
    let settled = false
    const settle = (err, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* ignore */ }
      if (err) reject(err)
      else resolve(value)
    }
    const timer = setTimeout(() => settle(new Error('Chrome CDP Runtime.evaluate timeout')), Math.max(2000, Number(timeoutMs || 15000)))
    const socket = new WebSocket(wsUrl)
    socket.addEventListener('open', () => {
      const payload = {
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: String(expression || ''),
          returnByValue: true,
          awaitPromise: true,
        },
      }
      socket.send(JSON.stringify(payload))
    })
    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event?.data || '{}'))
        if (Number(msg?.id) !== 1) return
        if (msg?.error) {
          settle(new Error(toText(msg.error?.message) || 'Chrome CDP evaluate error'))
          return
        }
        const exceptionText = toText(msg?.result?.exceptionDetails?.text)
        if (exceptionText) {
          settle(new Error(`Chrome CDP eval exception: ${exceptionText}`))
          return
        }
        settle(null, { value: msg?.result?.result?.value })
      } catch (error) {
        settle(error)
      }
    })
    socket.addEventListener('error', () => settle(new Error('Chrome CDP websocket error')))
    socket.addEventListener('close', () => {
      if (!settled) settle(new Error('Chrome CDP websocket closed unexpectedly'))
    })
  })
}

async function fetchCdpByChromeDirect(endpoint = '', init = {}, timeoutMs = 15000) {
  const raw = String(endpoint || '')
  const [pathOnly, queryText = ''] = raw.split('?')
  const query = new URLSearchParams(queryText)
  if (pathOnly === '/targets') {
    const list = await fetchChromeCdpJson('/json/list', {}, timeoutMs)
    const value = Array.isArray(list) ? list.map((item) => mapChromeTarget(item)) : []
    return { value }
  }
  if (pathOnly === '/new') {
    const url = toText(query.get('url'))
    let created = null
    try {
      created = await fetchChromeCdpJson(`/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }, timeoutMs)
    } catch {
      created = await fetchChromeCdpJson(`/json/new?${encodeURIComponent(url)}`, {}, timeoutMs)
    }
    const mapped = mapChromeTarget(created || {})
    return { targetId: mapped.targetId, ...mapped }
  }
  if (pathOnly === '/info') {
    const targetId = toText(query.get('target'))
    const list = await fetchChromeCdpJson('/json/list', {}, timeoutMs)
    const targets = Array.isArray(list) ? list.map((item) => mapChromeTarget(item)) : []
    const matched = targets.find((item) => item.targetId === targetId) || {}
    return matched
  }
  if (pathOnly === '/close') {
    const targetId = toText(query.get('target'))
    await fetchChromeCdpJson(`/json/close/${encodeURIComponent(targetId)}`, {}, timeoutMs).catch(() => ({}))
    return { ok: true }
  }
  if (pathOnly === '/eval') {
    const targetId = toText(query.get('target'))
    const expression = String(init?.body || '')
    return await evalByChromeCdpTarget(targetId, expression, timeoutMs)
  }
  throw new Error(`Chrome direct CDP unsupported endpoint: ${raw}`)
}

async function fetchCdpProxyJson(endpoint = '', init = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 15000)))
  try {
    const response = await fetchByNetworkPolicy(`${cdpProxyBaseUrl}${endpoint}`, {
      ...init,
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`CDP proxy HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    return await response.json()
  } catch (error) {
    const message = toText(error?.message || '')
    if (/CDP proxy HTTP|ECONNREFUSED|fetch failed|aborted|timed out/i.test(message)) {
      return await fetchCdpByChromeDirect(endpoint, init, timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function pathExists(targetPath = '') {
  const normalized = toText(targetPath)
  if (!normalized) return false
  try {
    await fs.access(normalized)
    return true
  } catch {
    return false
  }
}

async function commandExists(command = '') {
  const name = toText(command)
  if (!name) return false
  try {
    await execFileAsync('where', [name], { timeout: 8000 })
    return true
  } catch {
    return false
  }
}

async function evaluateMcpCallable(item = {}) {
  const name = toMcpServiceName(item?.name).toLowerCase()
  if (item?.enabled === false) return { callable: false, reason: '已禁用' }
  if (name === 'exa') return { callable: false, reason: '已禁用：检索结果质量不稳定' }
  if (name === 'tavily') return { callable: true, reason: 'HTTP MCP/官方检索可用' }
  if (name === 'weixin-reader') {
    const ok = await commandExists('python') && await pathExists('C:\\Users\\aoyon\\.codex\\mcp\\wexin-read-mcp\\src\\server.py')
    return ok ? { callable: true, reason: '可读取公众号正文' } : { callable: false, reason: 'weixin-reader 未完整安装' }
  }
  if (name === 'filesystem') {
    const ok = await commandExists('npx')
    return ok ? { callable: true, reason: 'npx 可用' } : { callable: false, reason: '缺少 npx' }
  }
  if (name === 'twitter') {
    const ok = await commandExists('twitter')
    return ok ? { callable: true, reason: '命令存在（UTF-8 终端下可用）' } : { callable: false, reason: '命令不存在' }
  }
  if (name === 'linkedin') {
    const ok = await commandExists('linkedin-scraper-mcp') || await pathExists('C:\\Users\\aoyon\\AppData\\Roaming\\Python\\Python314\\Scripts\\linkedin-scraper-mcp.exe')
    return ok ? { callable: true, reason: '命令存在（可能需登录）' } : { callable: false, reason: '命令不存在' }
  }
  if (name === 'weibo') {
    const ok = await commandExists('mcp-server-weibo')
    return ok ? { callable: true, reason: '命令存在' } : { callable: false, reason: '本机缺少 mcp-server-weibo 命令' }
  }
  if (name === 'wechat') {
    return { callable: false, reason: '仅文章阅读可用；搜索依赖 Exa/未注册独立 MCP 工具' }
  }
  if (name === 'xueqiu') {
    const ok = await commandExists('agent-reach')
    return ok ? { callable: true, reason: 'agent-reach 可用（需渠道配置）' } : { callable: false, reason: '缺少 agent-reach 命令' }
  }
  return { callable: true, reason: '可尝试调用' }
}

function buildSupplierBrowserProfileCandidates() {
  const localAppData = toText(process.env.LOCALAPPDATA)
  const explicitUserDataDir = toText(process.env.SUPPLIER_PW_USER_DATA_DIR)
  const explicitProfileDir = toText(process.env.SUPPLIER_PW_PROFILE_DIR) || 'Default'
  const candidates = []
  if (explicitUserDataDir) {
    candidates.push({
      channel: 'chrome',
      userDataDir: explicitUserDataDir,
      profileDir: explicitProfileDir,
      label: `chrome:${explicitProfileDir}`,
    })
  }
  if (localAppData) {
    candidates.push({
      channel: 'chrome',
      userDataDir: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      profileDir: explicitProfileDir,
      label: `chrome:${explicitProfileDir}`,
    })
  }
  return candidates
}

async function resolveSupplierBrowserProfile(targetUrl = '', context = {}) {
  const skillText = toText(context?.skill).toLowerCase()
  const host = safeHostFromUrl(targetUrl)
  const shouldPreferProfile = /playwright/.test(skillText) || host.includes('gasgoo.com')
  if (!shouldPreferProfile) return null
  for (const candidate of buildSupplierBrowserProfileCandidates()) {
    if (await pathExists(candidate.userDataDir)) {
      return candidate
    }
  }
  return null
}

async function createSupplierPlaywrightSession(targetUrl = '', context = {}) {
  const { chromium } = await import('playwright')
  const launchArgs = buildPlaywrightLaunchArgs(targetUrl)
  const pageOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  }
  const profile = await resolveSupplierBrowserProfile(targetUrl, context)
  if (profile) {
    try {
      const persistentContext = await chromium.launchPersistentContext(profile.userDataDir, {
        channel: profile.channel,
        headless: false,
        args: [...launchArgs, `--profile-directory=${profile.profileDir}`],
        ...pageOptions,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
      })
      const page = await persistentContext.newPage()
      return {
        page,
        mode: 'persistent-profile',
        profileLabel: profile.label,
        close: async () => persistentContext.close().catch(() => {}),
      }
    } catch (error) {
      const browser = await chromium.launch({ headless: true, args: launchArgs })
      const page = await browser.newPage(pageOptions)
      return {
        page,
        mode: 'ephemeral-fallback',
        profileLabel: profile.label,
        launchError: error?.message || 'persistent profile launch failed',
        close: async () => browser.close().catch(() => {}),
      }
    }
  }
  const browser = await chromium.launch({ headless: true, args: launchArgs })
  const page = await browser.newPage(pageOptions)
  return {
    page,
    mode: 'ephemeral',
    profileLabel: '',
    close: async () => browser.close().catch(() => {}),
  }
}

mergeNoProxyEnv([...proxyBypassHostSet])

async function fetchByNetworkPolicy(url, init = {}) {
  if (!shouldBypassProxyForUrl(url)) {
    return fetch(url, init)
  }
  const envKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']
  const backup = {}
  for (const key of envKeys) {
    backup[key] = process.env[key]
    delete process.env[key]
  }
  try {
    return await fetch(url, init)
  } finally {
    for (const key of envKeys) {
      if (typeof backup[key] === 'undefined') {
        delete process.env[key]
      } else {
        process.env[key] = backup[key]
      }
    }
  }
}

function parseSetCookiePair(rawHeaders = '') {
  const matches = [...String(rawHeaders || '').matchAll(/^set-cookie:\s*([^\r\n]+)/gmi)]
  const lastValue = matches.at(-1)?.[1] || ''
  return String(lastValue || '').split(';')[0]?.trim() || ''
}

function parseCurlStatusFromHeaders(rawHeaders = '') {
  const matches = [...String(rawHeaders || '').matchAll(/^HTTP\/[^\s]+\s+(\d+)/gmi)]
  return Number(matches.at(-1)?.[1] || 0)
}

async function fetchTextWithCurl(url, timeoutMs = 18000, headers = {}) {
  const tmpBase = path.join(
    process.cwd(),
    '.run-logs',
    `curl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  const headerPath = `${tmpBase}.headers.txt`
  const bodyPath = `${tmpBase}.body.txt`
  const timeoutSeconds = Math.max(4, Math.ceil(timeoutMs / 1000))
  const args = [
    '--noproxy', '*',
    '-L',
    '-sS',
    '--connect-timeout', String(Math.max(3, timeoutSeconds)),
    '--max-time', String(timeoutSeconds),
    '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
  ]
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = toText(key)
    const normalizedValue = toText(value)
    if (!normalizedKey || !normalizedValue) continue
    args.push('-H', `${normalizedKey}: ${normalizedValue}`)
  }
  args.push('-D', headerPath, '-o', bodyPath, String(url || ''))
  try {
    await execFileAsync('curl.exe', args, {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    })
    const [rawHeaders, text] = await Promise.all([
      fs.readFile(headerPath, 'utf8').catch(() => ''),
      fs.readFile(bodyPath, 'utf8').catch(() => ''),
    ])
    return {
      status: parseCurlStatusFromHeaders(rawHeaders),
      text,
      headersRaw: rawHeaders,
    }
  } catch (error) {
    throw new Error(error?.message || 'curl fetch failed')
  } finally {
    await Promise.allSettled([
      fs.unlink(headerPath),
      fs.unlink(bodyPath),
    ])
  }
}

const inventoryTable = `"${schemaName}"."asset_inventory"`
const crawlTaskTable = `"${schemaName}"."crawl_task"`
const crawlLogTable = `"${schemaName}"."crawl_task_log"`
const crawlQualityTable = `"${schemaName}"."crawl_task_quality"`
const crawlInfoTable = `"${schemaName}"."crawl_info"`
const supplyChainNodeTable = `"${schemaName}"."supply_chain_node"`
const gasSupplyChainNodeTable = `"${schemaName}"."gas_supply_chain_node"`
const supplierBaseTable = `"${schemaName}"."supplier_base_info"`
const gasSupplierTable = `"${schemaName}"."gas_supplier"`
const gasOemTable = `"${schemaName}"."gas_oem"`
const supplierProfileTable = `"${schemaName}"."supplier_profile"`
const supplierProfileCustomerTable = `"${schemaName}"."supplier_profile_customer_item"`
const supplierProfileProductCaseTable = `"${schemaName}"."supplier_profile_product_case_item"`
const supplierProfileFinancingTable = `"${schemaName}"."supplier_profile_financing_item"`
const supplierProfileSoftwareCopyrightTable = `"${schemaName}"."supplier_profile_software_copyright_item"`
const supplierProfilePatentTable = `"${schemaName}"."supplier_profile_patent_item"`
const supplierProfileAdminLicenseTable = `"${schemaName}"."supplier_profile_admin_license_item"`
const supplierProfileAdminLicenseGsTable = `"${schemaName}"."supplier_profile_admin_license_gs_item"`
const supplierProfileTradeCreditTable = `"${schemaName}"."supplier_profile_trade_credit_item"`
const supplierProfileCourtNoticeTable = `"${schemaName}"."supplier_profile_court_notice_item"`
const supplierProfileProductionBaseTable = `"${schemaName}"."supplier_profile_production_base_item"`
const supplierProfileNewsTable = `"${schemaName}"."supplier_profile_news_item"`
const supplierProfileEquipmentTable = `"${schemaName}"."supplier_profile_equipment_item"`
const supplierOemDictTable = `"${schemaName}"."supplier_oem_dict"`
const supplierCountryDictTable = `"${schemaName}"."supplier_country_dict"`
const supplierCertDictTable = `"${schemaName}"."supplier_certification_dict"`
const gasSupplierPortraitSettingTable = `"${schemaName}"."gas_supplier_portrait_setting"`
const chatSessionTable = `"${schemaName}"."chat_session"`
const chatMessageTable = `"${schemaName}"."chat_message"`
const langchainSessionStateTable = `"${schemaName}"."langchain_multi_chat_state"`
const preciseSourcingRunTable = `"${schemaName}"."precise_sourcing_run_log"`
const modelProviderTable = `"${schemaName}"."model_provider_config"`
const modelProviderModelTable = `"${schemaName}"."model_provider_model"`
const knowledgeBaseTable = `"${schemaName}"."knowledge_base"`
const knowledgeBaseDocumentTable = `"${schemaName}"."knowledge_base_document"`
const knowledgeBaseVectorTable = `"${schemaName}"."knowledge_base_vector"`
const supplierOpinionVectorTable = `"${schemaName}"."supplier_opinion_vector"`
const crawlExportDir = path.join(process.cwd(), 'crawl_exports')

function sanitizeFilePart(input = '') {
  return toText(input)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 64) || 'export'
}

async function generateSourcingChartFile({ chartType = 'bar', title = '候选供应商匹配分布', labels = [], values = [] } = {}) {
  await fs.mkdir(crawlExportDir, { recursive: true })
  const ts = Date.now()
  const safeTitle = sanitizeFilePart(title)
  const fileName = `chart_${safeTitle}_${ts}.html`
  const absPath = path.join(crawlExportDir, fileName)
  const chartData = {
    type: /line/i.test(toText(chartType)) ? 'line' : 'bar',
    x: Array.isArray(labels) ? labels : [],
    y: Array.isArray(values) ? values : [],
    marker: { color: '#2563eb' },
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title><script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script></head><body><div id="chart" style="width:100%;height:90vh;"></div><script>const data=[${JSON.stringify(chartData)}];const layout={title:${JSON.stringify(title)},paper_bgcolor:'#fff',plot_bgcolor:'#fff'};Plotly.newPlot('chart',data,layout,{responsive:true});</script></body></html>`
  await fs.writeFile(absPath, html, 'utf8')
  return {
    ok: true,
    title: toText(title) || 'chart',
    fileName,
    downloadUrl: `/api/crawl-exports/${encodeURIComponent(fileName)}`,
    format: 'html',
  }
}

function toCsvCell(value) {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

async function exportSourcingFile({ format = 'md', title = '精准寻源报告', rows = [], summary = '' } = {}) {
  await fs.mkdir(crawlExportDir, { recursive: true })
  const ts = Date.now()
  const safeTitle = sanitizeFilePart(title)
  const normalizedRows = Array.isArray(rows) ? rows : []
  let fileName = ''
  let absPath = ''
  if (format === 'xlsx') {
    fileName = `report_${safeTitle}_${ts}.xlsx`
    absPath = path.join(crawlExportDir, fileName)
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('report')
    const headers = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : ['message']
    ws.addRow(headers)
    for (const row of normalizedRows) ws.addRow(headers.map((h) => row?.[h] ?? ''))
    ws.columns.forEach((col) => { col.width = Math.min(40, Math.max(12, Number(col.header?.length || 12) + 2)) })
    await wb.xlsx.writeFile(absPath)
  } else if (format === 'csv') {
    fileName = `report_${safeTitle}_${ts}.csv`
    absPath = path.join(crawlExportDir, fileName)
    const headers = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : ['message']
    const lines = [headers.join(',')]
    for (const row of normalizedRows) lines.push(headers.map((h) => toCsvCell(row?.[h] ?? '')).join(','))
    await fs.writeFile(absPath, lines.join('\n'), 'utf8')
  } else {
    fileName = `report_${safeTitle}_${ts}.md`
    absPath = path.join(crawlExportDir, fileName)
    const headers = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : []
    const tableHead = headers.length > 0 ? `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |` : ''
    const tableRows = headers.length > 0
      ? normalizedRows.map((row) => `| ${headers.map((h) => String(row?.[h] ?? '')).join(' | ')} |`).join('\n')
      : ''
    const md = `# ${title}\n\n${summary ? `${summary}\n\n` : ''}${tableHead}${tableRows ? `\n${tableRows}\n` : '\n'}`
    await fs.writeFile(absPath, md, 'utf8')
  }
  return {
    ok: true,
    fileName,
    format,
    downloadUrl: `/api/crawl-exports/${encodeURIComponent(fileName)}`,
  }
}
const supplyChainRootTitle = '新能源汽车制造供应链'
const supplierCrawlTaskStore = new Map()
const supplierTaskStoreFile = path.join(process.cwd(), 'logs', 'supplier-crawl-tasks.json')
let supplierTaskStorePersistPromise = Promise.resolve()
let supplierTaskStorePersistPending = false
const supplierAutoResumeTaskIds = []
let supplierAutoResumeScheduled = false
const gasSupplyChainTaskStore = new Map()
const gasSupplyChainTaskStoreFile = path.join(process.cwd(), 'logs', 'gas-supply-chain-tasks.json')
const gasgooCdpTargetFile = path.join(process.cwd(), 'logs', 'gasgoo-cdp-target.json')
let gasSupplyChainTaskStorePersistPromise = Promise.resolve()
let gasSupplyChainTaskStorePersistPending = false
const supplierDetailLlmCache = new Map()
const codexModelOptions = [
  'gpt-5.4',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2',
  'gpt-5.1-codex-mini',
]
const supplierSkillOptions = [
  'web-access',
  'Playwright（浏览器自动化）',
  'playwright-script',
  'Crawl4AI',
  'vercel:agent-browser',
  'openclaw-grok-search',
]
const supplierLlmEnabled = (process.env.SUPPLIER_LLM_ENABLED || 'true') === 'true'
const supplierLlmApiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.CODEX_API_KEY || ''
const supplierLlmBaseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
const supplierLlmTimeoutMs = Math.max(3000, Number(process.env.SUPPLIER_LLM_TIMEOUT_MS || 18000))
const supplierHttpTimeoutMs = Math.max(4000, Number(process.env.SUPPLIER_HTTP_TIMEOUT_MS || 12000))
const supplierHttpRetryCount = Math.max(1, Number(process.env.SUPPLIER_HTTP_RETRY_COUNT || 1))
const supplierPlaywrightGotoTimeoutMs = Math.max(8000, Number(process.env.SUPPLIER_PW_GOTO_TIMEOUT_MS || 25000))
const supplierPlaywrightWaitMs = Math.max(400, Number(process.env.SUPPLIER_PW_WAIT_MS || 1800))
const supplierDetailConcurrency = Math.max(1, Math.min(6, Number(process.env.SUPPLIER_DETAIL_CONCURRENCY || 3)))
const supplierDetailRowTimeoutMs = Math.max(45000, Number(process.env.SUPPLIER_DETAIL_ROW_TIMEOUT_MS || 120000))
const supplierDetailPlaywrightTimeoutMs = Math.max(20000, Number(process.env.SUPPLIER_DETAIL_PLAYWRIGHT_TIMEOUT_MS || 55000))
const supplierTryAllVariants = (process.env.SUPPLIER_TRY_ALL_VARIANTS || 'false') === 'true'
const gasSyncLocalExtractCommandDefault = toText(process.env.GAS_SYNC_LOCAL_EXTRACT_COMMAND)
const gasSyncLocalExtractArgsJsonDefault = toText(process.env.GAS_SYNC_LOCAL_EXTRACT_ARGS_JSON || '[]')
const gasSyncLocalExtractCwdDefault = toText(process.env.GAS_SYNC_LOCAL_EXTRACT_CWD)
const gasSyncLocalExtractTimeoutMsDefault = Math.max(5000, Number(process.env.GAS_SYNC_LOCAL_EXTRACT_TIMEOUT_MS || 180000))
const webAccessStartCommandDefault = toText(process.env.WEB_ACCESS_START_COMMAND)
const webAccessStartArgsJsonDefault = toText(process.env.WEB_ACCESS_START_ARGS_JSON || '[]')
const webAccessStartCwdDefault = toText(process.env.WEB_ACCESS_START_CWD)
const webAccessCheckDepsScriptDefault = toText(process.env.WEB_ACCESS_CHECK_DEPS_SCRIPT)
const pool = new Pool(dbConfig)
let dbReady = false
let dbInitErrorMessage = ''
let dbReconnectInFlight = null
let lastDbReconnectAttemptAt = 0
const knowledgeBaseAssetDir = path.join(process.cwd(), 'logs', 'knowledge-base-assets')
const knowledgeBaseStore = new Map()
let knowledgeBasePersistPromise = Promise.resolve()
let knowledgeBasePersistPending = false

function generateKbId(prefix = 'kb') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function defaultEmbeddingDimension(model = '') {
  return 1536
}

function stripHtmlTags(input = '') {
  return String(input || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeBase64Utf8(input = '') {
  const payload = toText(input)
  if (!payload) return ''
  try {
    return Buffer.from(payload, 'base64').toString('utf8')
  } catch {
    return ''
  }
}

function decodeHtmlEntities(input = '') {
  const basic = String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return basic
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m
    })
    .replace(/&#([0-9]+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m
    })
}

function stripHtmlBasic(input = '') {
  return String(input || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function mapSearchQueryByService(service = '', keyword = '') {
  const token = toMcpServiceName(service).toLowerCase()
  const q = String(keyword || '').trim()
  if (!q) return q
  if (token === 'wechat') return `site:mp.weixin.qq.com ${q}`
  if (token === 'weibo') return `site:weibo.com ${q}`
  if (token === 'twitter') return `site:x.com ${q}`
  if (token === 'linkedin') return `site:linkedin.com ${q}`
  return q
}

function toSimpleTokens(text = '') {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，。；;、|]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
}

function scoreRelevance(title = '', snippet = '', keyword = '') {
  const t = `${title} ${snippet}`.toLowerCase()
  const tokens = toSimpleTokens(keyword)
  let score = 0
  for (const token of tokens) {
    if (token && t.includes(token)) score += 2
  }
  return score
}

function parseLinksFromJinaMarkdown(text = '', keyword = '') {
  const rows = []
  for (const m of String(text || '').matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gim)) {
    const title = decodeHtmlEntities(toText(m?.[1]))
    const href = decodeHtmlEntities(toText(m?.[2]))
    if (!title || !href) continue
    if (/bing|google|baidu|duckduckgo/i.test(href) && /(search|s\?)/i.test(href)) continue
    rows.push({ title, href, snippet: '', score: scoreRelevance(title, '', keyword) })
    if (rows.length >= 20) break
  }
  return rows
}

async function searchWebSnippets(keyword = '', service = '') {
  const q = mapSearchQueryByService(service, keyword)
  if (!q) return []
  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }
  const parseDuck = (html = '') => {
    const blocks = [...String(html || '').matchAll(/<div class="result(?:__body)?[\s\S]*?<\/div>\s*<\/div>/gim)]
    const rows = []
    for (const block of blocks) {
      const raw = String(block?.[0] || '')
      const titleMatch = raw.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i)
      const hrefMatch = raw.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"/i)
      const snippetMatch = raw.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i)
      const title = decodeHtmlEntities(stripHtmlBasic(titleMatch?.[1] || ''))
      const href = decodeHtmlEntities(toText(hrefMatch?.[1]))
      const snippet = decodeHtmlEntities(stripHtmlBasic(snippetMatch?.[1] || snippetMatch?.[2] || ''))
      if (!title && !snippet) continue
      rows.push({ title, href, snippet })
      if (rows.length >= 8) break
    }
    return rows
  }
  const parseBaidu = (html = '') => {
    const blocks = [...String(html || '').matchAll(/<div[^>]+class="[^"]*result[^"]*"[\s\S]*?<\/div>\s*<\/div>/gim)]
    const rows = []
    for (const block of blocks) {
      const raw = String(block?.[0] || '')
      const titleMatch = raw.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i)
      const snippetMatch = raw.match(/<div[^>]+class="[^"]*(?:c-abstract|content-right_8Zs40)[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      const href = decodeHtmlEntities(toText(titleMatch?.[1]))
      const title = decodeHtmlEntities(stripHtmlBasic(titleMatch?.[2] || ''))
      const snippet = decodeHtmlEntities(stripHtmlBasic(snippetMatch?.[1] || ''))
      if (!title && !snippet) continue
      rows.push({ title, href, snippet })
      if (rows.length >= 8) break
    }
    if (rows.length === 0) {
      const generic = [...String(html || '').matchAll(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gim)]
      for (const item of generic) {
        const href = decodeHtmlEntities(toText(item?.[1]))
        const title = decodeHtmlEntities(stripHtmlBasic(item?.[2] || ''))
        if (!href || !title || title.length < 2) continue
        if (/百度一下|下一页|上一页|更多|登录|注册/i.test(title)) continue
        rows.push({ title, href, snippet: '' })
        if (rows.length >= 8) break
      }
    }
    return rows
  }
  try {
    const ddg = await fetchByNetworkPolicy(`https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { headers: commonHeaders })
    if (ddg.ok) {
      const html = await ddg.text()
      const rows = parseDuck(html)
      if (rows.length > 0) return rows
    }
  } catch {
    // fallback below
  }
  const baidu = await fetchByNetworkPolicy(`https://www.baidu.com/s?wd=${encodeURIComponent(q)}`, { headers: commonHeaders })
  if (baidu.ok) {
    const baiduHtml = await baidu.text()
    const rows = parseBaidu(baiduHtml)
    if (rows.length > 0) return rows
  }
  const bing = await fetchByNetworkPolicy(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, { headers: commonHeaders })
  if (!bing.ok) throw new Error(`搜索服务返回 HTTP ${bing.status}`)
  const bingHtml = await bing.text()
  const rows = []
  for (const block of [...String(bingHtml || '').matchAll(/<li class="b_algo"[\s\S]*?<\/li>/gim)]) {
    const raw = String(block?.[0] || '')
    const titleMatch = raw.match(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/i)
    const snippetMatch = raw.match(/<p>([\s\S]*?)<\/p>/i)
    const href = decodeHtmlEntities(toText(titleMatch?.[1]))
    const title = decodeHtmlEntities(stripHtmlBasic(titleMatch?.[2] || ''))
    const snippet = decodeHtmlEntities(stripHtmlBasic(snippetMatch?.[1] || ''))
    if (!title && !snippet) continue
    rows.push({ title, href, snippet })
    if (rows.length >= 8) break
  }
  if (rows.length > 0) return rows
  try {
    const jina = await fetchByNetworkPolicy(`https://r.jina.ai/http://cn.bing.com/search?q=${encodeURIComponent(q)}`, { headers: commonHeaders })
    if (jina.ok) {
      const md = await jina.text()
      const parsed = parseLinksFromJinaMarkdown(md, keyword)
      if (parsed.length > 0) {
        return parsed
          .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
          .slice(0, 8)
          .map((item) => ({ title: item.title, href: item.href, snippet: item.snippet }))
      }
    }
  } catch {
    // ignore
  }
  return []
}

function extractKeySentences(text = '', maxCount = 2) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const parts = normalized.split(/(?<=[。！？!?\.])\s+/g).map((s) => s.trim()).filter(Boolean)
  return parts.slice(0, Math.max(1, maxCount))
}

function parseTavilyApiKeyFromUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''))
    return toText(parsed.searchParams.get('tavilyApiKey') || '')
  } catch {
    return ''
  }
}

const fallbackTavilyApiKey = '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'

async function resolveTavilyApiKey(serviceMeta = {}) {
  const fromServiceUrl = parseTavilyApiKeyFromUrl(toText(serviceMeta?.url))
  if (fromServiceUrl) return fromServiceUrl
  const fromEnv = toText(process.env.TAVILY_API_KEY)
  if (fromEnv) return fromEnv
  try {
    const { stdout } = await execFileAsync('codex', ['mcp', 'get', 'tavily', '--json'], { timeout: 15000 })
    const parsed = JSON.parse(String(stdout || '{}'))
    const fromMcp = parseTavilyApiKeyFromUrl(toText(parsed?.transport?.url || parsed?.url))
    if (fromMcp) return fromMcp
  } catch {
    // ignore
  }
  return fallbackTavilyApiKey
}

const TAVILY_PREFERRED_HOST_RULES = [
  'cls.cn',
  'eastmoney.com',
  'stcn.com',
  'cnstock.com',
  'caixin.com',
  'yicai.com',
  '10jqka.com.cn',
  'sina.com.cn',
  'news.qq.com',
  '36kr.com',
  'wallstreetcn.com',
  'jiemian.com',
  'thepaper.cn',
  'ifeng.com',
  'people.com.cn',
  'xinhuanet.com',
  'cctv.com',
  'mp.weixin.qq.com',
]

const TAVILY_CN_ONLY_HOST_RULES = [
  'cls.cn',
  'eastmoney.com',
  'stcn.com',
  'cnstock.com',
  'caixin.com',
  'yicai.com',
  '10jqka.com.cn',
  'sina.com.cn',
  'news.qq.com',
  '36kr.com',
  'wallstreetcn.com',
  'jiemian.com',
  'thepaper.cn',
  'ifeng.com',
  'people.com.cn',
  'xinhuanet.com',
  'cctv.com',
  'mp.weixin.qq.com',
]

const TAVILY_NOISE_HOST_RULES = [
  'music.youtube.com',
  'open.spotify.com',
  'apple.com',
  'fandango.com',
  'moviefone.com',
  'showtimes.com',
  'atomtickets.com',
]

function hostMatchesRule(host = '', rule = '') {
  const h = String(host || '').toLowerCase()
  const r = String(rule || '').toLowerCase()
  if (!h || !r) return false
  return h === r || h.endsWith(`.${r}`)
}

function isLikelyChineseText(text = '') {
  const src = String(text || '')
  if (!src) return false
  const hits = src.match(/[\u4e00-\u9fa5]/g)
  return Boolean(hits && hits.length >= 2)
}

function isEnglishLikeUrl(url = '') {
  const u = String(url || '').toLowerCase()
  if (!u) return false
  return /\/en\//.test(u) || /\/english\//.test(u) || /eu\.36kr\.com/.test(u)
}

function isNoiseHost(url = '') {
  const host = safeHostFromUrl(url)
  if (!host) return true
  return TAVILY_NOISE_HOST_RULES.some((rule) => hostMatchesRule(host, rule))
}

function scorePreferredSource(item = {}, keyword = '') {
  const href = toText(item?.href)
  const title = toText(item?.title)
  const snippet = toText(item?.snippet)
  const host = safeHostFromUrl(href)
  let score = 0
  if (TAVILY_PREFERRED_HOST_RULES.some((rule) => hostMatchesRule(host, rule))) score += 6
  if (isLikelyChineseText(`${title} ${snippet}`)) score += 3
  score += Math.min(6, Math.max(0, scoreRelevance(title, snippet, keyword)))
  return score
}

function compactText(input = '', maxLen = 220) {
  const normalized = String(input || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}...` : normalized
}

function containsCatlIntent(text = '') {
  const src = String(text || '').toLowerCase()
  return ['宁德时代', 'catl', 'contemporary amperex', 'ningde shidai'].some((k) => src.includes(k))
}

function isBoilerplateLike(text = '') {
  const src = String(text || '').toLowerCase()
  if (!src) return true
  const noiseHits = [
    'skip to navigation',
    'all rights reserved',
    'privacy',
    'terms',
    'login',
    'subscribe',
    'facebook',
    'linkedin',
    'twitter',
  ].filter((k) => src.includes(k)).length
  return noiseHits >= 3 || src.length < 20
}

async function searchViaTavily(keyword = '', apiKey = '') {
  const key = toText(apiKey)
  if (!key) throw new Error('Tavily API Key 缺失')
  const baseQuery = String(keyword || '').trim()
  const wechatMode = /公众号|微信|wechat/i.test(baseQuery)
  const queryCandidates = [baseQuery]
  if (containsCatlIntent(baseQuery)) {
    queryCandidates.push(`${baseQuery} CATL 300750`)
    queryCandidates.push(`${baseQuery} Contemporary Amperex`)
  }
  if (wechatMode) {
    queryCandidates.push(`site:mp.weixin.qq.com ${baseQuery.replace(/公众号|微信|wechat/ig, '').trim()}`)
  }
  // Always add one WeChat-focused query so public-account articles can be merged in,
  // even when the user did not explicitly type "公众号/微信".
  const wechatSupplement = `site:mp.weixin.qq.com ${baseQuery.replace(/公众号|微信|wechat/ig, '').trim()}`
  if (toText(wechatSupplement).replace(/^site:mp\.weixin\.qq\.com\s*/i, '').trim()) {
    queryCandidates.push(wechatSupplement)
  }
  const merged = []
  for (const q of [...new Set(queryCandidates)].filter(Boolean)) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await fetchByNetworkPolicy('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: q,
        topic: 'news',
        max_results: 8,
        include_raw_content: true,
        include_answer: false,
        search_depth: 'advanced',
        include_domains: wechatMode ? ['mp.weixin.qq.com'] : undefined,
        days: 180,
      }),
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Tavily HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    // eslint-disable-next-line no-await-in-loop
    const json = await resp.json().catch(() => ({}))
    const rows = Array.isArray(json?.results) ? json.results : []
    merged.push(...rows)
  }
  const normalizedRows = merged.map((item) => ({
    title: toText(item?.title),
    href: toText(item?.url),
    snippet: toText(item?.content),
    rawContent: toText(item?.raw_content),
  }))
    .filter((item) => item.href || item.title)
    .filter((item) => !isNoiseHost(item.href))
    .filter((item) => {
      if (!wechatMode) return true
      const host = safeHostFromUrl(item.href)
      return ['mp.weixin.qq.com'].some((rule) => hostMatchesRule(host, rule))
    })
    .filter((item) => wechatMode || !isBoilerplateLike(`${item.title} ${item.snippet}`))
    .map((item) => ({ ...item, preferredScore: scorePreferredSource(item, keyword) }))
    .filter((item, idx, arr) => arr.findIndex((x) => toText(x.href) === toText(item.href)) === idx)

  const strictRows = normalizedRows
    .filter((item) => !isEnglishLikeUrl(item.href))
    .filter((item) => Number(item.preferredScore || 0) >= (wechatMode ? 5 : 4))
    .sort((a, b) => Number(b.preferredScore || 0) - Number(a.preferredScore || 0))

  if (strictRows.length > 0) return strictRows.slice(0, 5)

  const relaxedRows = normalizedRows
    .filter((item) => Number(item.preferredScore || 0) >= 1)
    .sort((a, b) => Number(b.preferredScore || 0) - Number(a.preferredScore || 0))

  return relaxedRows.slice(0, 5)
}

async function searchViaTavilyRaw(keyword = '', apiKey = '') {
  const key = toText(apiKey)
  if (!key) return []
  const resp = await fetchByNetworkPolicy('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query: String(keyword || '').trim(),
      topic: 'general',
      max_results: 8,
      include_raw_content: false,
      include_answer: false,
      search_depth: 'advanced',
      days: 365,
    }),
  })
  if (!resp.ok) return []
  const json = await resp.json().catch(() => ({}))
  const rows = Array.isArray(json?.results) ? json.results : []
  return rows.map((item) => ({
    title: toText(item?.title),
    href: toText(item?.url),
    snippet: compactText(toText(item?.content), 220),
    summary: compactText(toText(item?.content), 220),
    preferredScore: scorePreferredSource({ title: item?.title, href: item?.url, snippet: item?.content }, keyword),
  }))
    .filter((item) => item.href || item.title)
    .filter((item) => !isNoiseHost(item.href))
    .filter((item) => {
      if (!containsCatlIntent(keyword)) return true
      return containsCatlIntent(`${item.title} ${item.summary} ${item.href}`)
    })
    .sort((a, b) => Number(b.preferredScore || 0) - Number(a.preferredScore || 0))
    .slice(0, 5)
}

async function readWeixinArticleMarkdown(url = '') {
  const target = toText(url)
  if (!/https?:\/\/mp\.weixin\.qq\.com\//i.test(target)) return ''
  const candidates = [
    'C:\\Users\\aoyon\\.url-md\\bin\\url-md.exe',
    'url-md',
  ]
  for (const cmd of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { stdout } = await execFileAsync(cmd, ['md', target], { timeout: 30000 })
      const markdown = toText(stdout)
      if (markdown) return markdown
    } catch {
      // try next command
    }
  }
  return ''
}

async function enrichSearchRows(rows = []) {
  const enriched = []
  for (const item of rows.slice(0, 5)) {
    const href = toText(item.href)
    let detail = ''
    if (href) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const resp = await fetchByNetworkPolicy(`https://r.jina.ai/http://${href.replace(/^https?:\/\//i, '')}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
        if (resp.ok) {
          // eslint-disable-next-line no-await-in-loop
          detail = (await resp.text()).slice(0, 2500)
        }
      } catch {
        detail = ''
      }
    }
    const summary = extractKeySentences(detail || toText(item.snippet), 2).join(' ')
    enriched.push({
      ...item,
      summary: summary || toText(item.snippet),
    })
  }
  return enriched
}

function splitIntoChunks(text = '', chunkSize = 800, overlap = 120) {
  const normalized = String(text || '').trim()
  if (!normalized) return []
  const chunks = []
  let cursor = 0
  const safeSize = Math.max(200, Number(chunkSize || 800))
  const safeOverlap = Math.max(0, Math.min(safeSize - 1, Number(overlap || 120)))
  while (cursor < normalized.length) {
    const end = Math.min(normalized.length, cursor + safeSize)
    const piece = normalized.slice(cursor, end).trim()
    if (piece) chunks.push(piece)
    if (end >= normalized.length) break
    cursor = Math.max(cursor + 1, end - safeOverlap)
  }
  return chunks
}

function embedTextDeterministic(text = '', dimension = 1536) {
  const dim = Math.max(64, Math.min(4096, Number(dimension || 1536)))
  const vector = new Array(dim).fill(0)
  const src = String(text || '')
  for (let i = 0; i < src.length; i += 1) {
    const code = src.charCodeAt(i)
    const idx = (i * 131 + code) % dim
    vector[idx] = Number((vector[idx] + (code % 97) / 97).toFixed(6))
  }
  return vector
}

async function embedTextByProvider(text = '', model = 'text-embedding-3-small', dimension = 1536) {
  const content = String(text || '').trim()
  if (!content) return new Array(dimension).fill(0)
  const normalizedModel = toText(model || 'text-embedding-3-small')
  const useQwenEmbedding = normalizedModel === qwenEmbeddingModel
  const selectedApiKey = useQwenEmbedding ? qwenEmbeddingApiKey : embeddingApiKey
  const selectedBaseUrl = useQwenEmbedding ? qwenEmbeddingBaseUrl : embeddingBaseUrl
  if (!selectedApiKey) return embedTextDeterministic(content, dimension)
  const base = selectedBaseUrl.replace(/\/+$/, '')
  const endpoint = base.endsWith('/v1') ? `${base}/embeddings` : `${base}/v1/embeddings`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${selectedApiKey}`,
    },
    body: JSON.stringify({
      model: normalizedModel || 'text-embedding-3-small',
      input: content,
    }),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    console.warn(`embedding fallback: HTTP ${response.status}${errorText ? ` ${errorText.slice(0, 200)}` : ''}`)
    return embedTextDeterministic(content, dimension)
  }
  const payload = await response.json().catch(() => ({}))
  const embedding = Array.isArray(payload?.data) && Array.isArray(payload.data[0]?.embedding)
    ? payload.data[0].embedding.map((item) => Number(item))
    : []
  if (embedding.length === 0) return embedTextDeterministic(content, dimension)
  return normalizeVectorForStorage(embedding, dimension)
}

function isPlainTextLikeFile(name = '', mime = '') {
  const ext = path.extname(String(name || '')).toLowerCase()
  const mimeToken = String(mime || '').toLowerCase()
  if (mimeToken.startsWith('text/')) return true
  return ['.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.json', '.xml'].includes(ext)
}

function isPdfFile(name = '', mime = '') {
  const ext = path.extname(String(name || '')).toLowerCase()
  const mimeToken = String(mime || '').toLowerCase()
  return ext === '.pdf' || mimeToken === 'application/pdf'
}

async function extractPdfTextFromBuffer(buffer) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  try {
    const parsed = await parser.getText()
    return String(parsed?.text || '').trim()
  } finally {
    await parser.destroy().catch(() => {})
  }
}

const knowledgeVectorStoreDim = 1536

function normalizeVectorForStorage(vector = [], targetDim = knowledgeVectorStoreDim) {
  const normalized = new Array(targetDim).fill(0)
  const source = Array.isArray(vector) ? vector : []
  const usable = Math.min(source.length, targetDim)
  for (let i = 0; i < usable; i += 1) {
    const value = Number(source[i])
    normalized[i] = Number.isFinite(value) ? value : 0
  }
  return normalized
}

function toPgVectorLiteral(vector = []) {
  return `[${vector.map((item) => Number(item || 0).toFixed(6)).join(',')}]`
}

async function persistKnowledgeBaseStore() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of knowledgeBaseStore.values()) {
      await client.query(
        `
        INSERT INTO ${knowledgeBaseTable} (id, name, config_json, created_at, updated_at)
        VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
        ON CONFLICT (id)
        DO UPDATE SET name = EXCLUDED.name, config_json = EXCLUDED.config_json, updated_at = EXCLUDED.updated_at
        `,
        [
          item.id,
          item.name,
          JSON.stringify(item.config || {}),
          item.createdAt || new Date().toISOString(),
          item.updatedAt || new Date().toISOString(),
        ],
      )
      const docs = Array.isArray(item.documents) ? item.documents : []
      const docIds = docs
        .map((doc) => toText(doc?.id))
        .filter(Boolean)
      for (const doc of docs) {
        await client.query(
          `
          INSERT INTO ${knowledgeBaseDocumentTable}
          (id, kb_id, source_type, name, url, mime_type, size_bytes, status, chunk_count, vector_count, retry_count, error_message, vector_path, content_base64, created_at, updated_at, completed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz,$17::timestamptz)
          ON CONFLICT (id)
          DO UPDATE SET
            kb_id = EXCLUDED.kb_id,
            source_type = EXCLUDED.source_type,
            name = EXCLUDED.name,
            url = EXCLUDED.url,
            mime_type = EXCLUDED.mime_type,
            size_bytes = EXCLUDED.size_bytes,
            status = EXCLUDED.status,
            chunk_count = EXCLUDED.chunk_count,
            vector_count = EXCLUDED.vector_count,
            retry_count = EXCLUDED.retry_count,
            error_message = EXCLUDED.error_message,
            vector_path = EXCLUDED.vector_path,
            content_base64 = EXCLUDED.content_base64,
            updated_at = EXCLUDED.updated_at,
            completed_at = EXCLUDED.completed_at
          `,
          [
            doc.id,
            item.id,
            toText(doc.sourceType),
            toText(doc.name),
            toText(doc.url),
            toText(doc.mimeType),
            Number(doc.size || 0),
            toText(doc.status || 'queued'),
            Number(doc.chunkCount || 0),
            Number(doc.vectorCount || 0),
            Number(doc.retryCount || 0),
            toText(doc.errorMessage),
            toText(doc.vectorPath),
            toText(doc.contentBase64),
            doc.createdAt || new Date().toISOString(),
            doc.updatedAt || new Date().toISOString(),
            doc.completedAt || null,
          ],
        )
      }
      if (docIds.length > 0) {
        await client.query(
          `DELETE FROM ${knowledgeBaseDocumentTable} WHERE kb_id = $1 AND NOT (id = ANY($2::text[]))`,
          [item.id, docIds],
        )
      } else {
        await client.query(`DELETE FROM ${knowledgeBaseDocumentTable} WHERE kb_id = $1`, [item.id])
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function schedulePersistKnowledgeBaseStore() {
  if (knowledgeBasePersistPending) return
  knowledgeBasePersistPending = true
  knowledgeBasePersistPromise = knowledgeBasePersistPromise
    .then(() => persistKnowledgeBaseStore())
    .catch(() => {})
    .finally(() => {
      knowledgeBasePersistPending = false
    })
}

async function loadKnowledgeBaseStore() {
  try {
    const [kbRes, docRes] = await Promise.all([
      pool.query(`SELECT id, name, config_json AS config, created_at AS "createdAt", updated_at AS "updatedAt" FROM ${knowledgeBaseTable} ORDER BY updated_at DESC`),
      pool.query(`SELECT id, kb_id AS "kbId", source_type AS "sourceType", name, url, mime_type AS "mimeType", size_bytes AS size, status, chunk_count AS "chunkCount", vector_count AS "vectorCount", retry_count AS "retryCount", error_message AS "errorMessage", vector_path AS "vectorPath", content_base64 AS "contentBase64", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt" FROM ${knowledgeBaseDocumentTable} ORDER BY updated_at DESC`),
    ])
    const rows = kbRes.rows || []
    const docs = docRes.rows || []
    const docMap = new Map()
    for (const doc of docs) {
      const key = toText(doc.kbId)
      if (!docMap.has(key)) docMap.set(key, [])
      docMap.get(key).push(doc)
    }
    knowledgeBaseStore.clear()
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = toText(row?.id)
      if (!id) continue
      knowledgeBaseStore.set(id, {
        id,
        name: toText(row?.name) || id,
        config: row?.config && typeof row.config === 'object' ? row.config : {},
        createdAt: toText(row?.createdAt) || new Date().toISOString(),
        updatedAt: toText(row?.updatedAt) || new Date().toISOString(),
        documents: docMap.get(id) || [],
      })
    }
  } catch {
    knowledgeBaseStore.clear()
  }
}

async function upsertKnowledgeBaseDocumentRow(kbId = '', doc = {}) {
  const docId = toText(doc?.id)
  if (!kbId || !docId) return
  await pool.query(
    `
    INSERT INTO ${knowledgeBaseDocumentTable}
    (id, kb_id, source_type, name, url, mime_type, size_bytes, status, chunk_count, vector_count, retry_count, error_message, vector_path, content_base64, created_at, updated_at, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz,$17::timestamptz)
    ON CONFLICT (id)
    DO UPDATE SET
      kb_id = EXCLUDED.kb_id,
      source_type = EXCLUDED.source_type,
      name = EXCLUDED.name,
      url = EXCLUDED.url,
      mime_type = EXCLUDED.mime_type,
      size_bytes = EXCLUDED.size_bytes,
      status = EXCLUDED.status,
      chunk_count = EXCLUDED.chunk_count,
      vector_count = EXCLUDED.vector_count,
      retry_count = EXCLUDED.retry_count,
      error_message = EXCLUDED.error_message,
      vector_path = EXCLUDED.vector_path,
      content_base64 = EXCLUDED.content_base64,
      updated_at = EXCLUDED.updated_at,
      completed_at = EXCLUDED.completed_at
    `,
    [
      docId,
      kbId,
      toText(doc.sourceType),
      toText(doc.name),
      toText(doc.url),
      toText(doc.mimeType),
      Number(doc.size || 0),
      toText(doc.status || 'queued'),
      Number(doc.chunkCount || 0),
      Number(doc.vectorCount || 0),
      Number(doc.retryCount || 0),
      toText(doc.errorMessage),
      toText(doc.vectorPath),
      toText(doc.contentBase64),
      doc.createdAt || new Date().toISOString(),
      doc.updatedAt || new Date().toISOString(),
      doc.completedAt || null,
    ],
  )
}

async function upsertKnowledgeBaseRow(kb = null) {
  const id = toText(kb?.id)
  if (!id) return
  await pool.query(
    `
    INSERT INTO ${knowledgeBaseTable} (id, name, config_json, created_at, updated_at)
    VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
    ON CONFLICT (id)
    DO UPDATE SET
      name = EXCLUDED.name,
      config_json = EXCLUDED.config_json,
      updated_at = EXCLUDED.updated_at
    `,
    [
      id,
      toText(kb?.name) || id,
      JSON.stringify(kb?.config || {}),
      kb?.createdAt || new Date().toISOString(),
      kb?.updatedAt || new Date().toISOString(),
    ],
  )
}

async function runKnowledgeDocumentPipeline(kbId = '', docId = '') {
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return
  const doc = (kb.documents || []).find((item) => item.id === docId)
  if (!doc) return
  try {
    doc.status = 'parsing'
    doc.errorMessage = ''
    doc.updatedAt = new Date().toISOString()
    await upsertKnowledgeBaseDocumentRow(kbId, doc)
    schedulePersistKnowledgeBaseStore()
    let text = ''
    const isLegacyMcpTextDoc = toText(doc.sourceType) === 'web' && /^mcp:\/\//i.test(toText(doc.url))
    if (doc.sourceType === 'file' || doc.sourceType === 'search' || isLegacyMcpTextDoc) {
      const payload = toText(doc.contentBase64)
      if (!payload) throw new Error('文件内容为空')
      const fileBuffer = Buffer.from(payload, 'base64')
      if (doc.sourceType === 'file' && isPdfFile(doc.name, doc.mimeType)) {
        text = await extractPdfTextFromBuffer(fileBuffer)
      } else {
        if (doc.sourceType === 'file' && !isPlainTextLikeFile(doc.name, doc.mimeType)) {
          throw new Error('当前仅支持文本类文件自动解析（TXT/MD/HTML/CSV/JSON/XML/PDF）')
        }
        const decoded = fileBuffer.toString('utf8')
        text = /\.html?$/i.test(doc.name) || String(doc.mimeType || '').toLowerCase().includes('html')
          ? stripHtmlTags(decoded)
          : decoded
      }
    } else if (doc.sourceType === 'web') {
      const targetUrl = toText(doc.url)
      if (!/^https?:\/\//i.test(targetUrl)) throw new Error('网页 URL 无效')
      const response = await fetchByNetworkPolicy(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!response.ok) throw new Error(`网页抓取失败（HTTP ${response.status}）`)
      const raw = await response.text()
      doc.contentBase64 = Buffer.from(String(raw || ''), 'utf8').toString('base64')
      doc.size = Buffer.byteLength(String(raw || ''), 'utf8')
      doc.updatedAt = new Date().toISOString()
      await upsertKnowledgeBaseDocumentRow(kbId, doc)
      text = stripHtmlTags(raw)
    } else {
      throw new Error('未知的数据源类型')
    }
    doc.status = 'chunking'
    doc.updatedAt = new Date().toISOString()
    await upsertKnowledgeBaseDocumentRow(kbId, doc)
    schedulePersistKnowledgeBaseStore()
    const chunks = splitIntoChunks(text, 800, 120)
    if (chunks.length === 0) throw new Error('文本为空，无法分段')
    doc.status = 'embedding'
    doc.updatedAt = new Date().toISOString()
    await upsertKnowledgeBaseDocumentRow(kbId, doc)
    schedulePersistKnowledgeBaseStore()
    const dimension = Number(kb.config?.embeddingDimension) || defaultEmbeddingDimension(kb.config?.embeddingModel)
    const embeddingModel = resolveKnowledgeBaseEmbeddingModel(kb)
    const vectors = []
    for (const chunk of chunks) {
      // sequential requests to avoid provider rate burst
      // and keep failure location deterministic
      // eslint-disable-next-line no-await-in-loop
      const vec = await embedTextByProvider(chunk, embeddingModel, knowledgeVectorStoreDim)
      vectors.push(vec)
    }
    await pool.query(`DELETE FROM ${knowledgeBaseVectorTable} WHERE doc_id = $1`, [doc.id])
    for (let i = 0; i < chunks.length; i += 1) {
      const storeVector = normalizeVectorForStorage(vectors[i], knowledgeVectorStoreDim)
      await pool.query(
        `
        INSERT INTO ${knowledgeBaseVectorTable}
        (kb_id, doc_id, chunk_index, chunk_text, embedding_model, embedding_dim, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
        `,
        [
          kbId,
          doc.id,
          i,
          chunks[i],
          embeddingModel,
          Number(dimension || 1536),
          toPgVectorLiteral(storeVector),
        ],
      )
    }
    await fs.mkdir(knowledgeBaseAssetDir, { recursive: true })
    const vectorPath = path.join(knowledgeBaseAssetDir, `${kbId}_${docId}.json`)
    await fs.writeFile(vectorPath, JSON.stringify({
      kbId,
      docId,
      embeddingModel,
      embeddingDimension: dimension,
      chunks,
      vectors,
      generatedAt: new Date().toISOString(),
    }), 'utf8')
    doc.chunkCount = chunks.length
    doc.vectorCount = vectors.length
    doc.vectorPath = vectorPath
    doc.status = 'success'
    doc.updatedAt = new Date().toISOString()
    doc.completedAt = new Date().toISOString()
    await upsertKnowledgeBaseDocumentRow(kbId, doc)
    schedulePersistKnowledgeBaseStore()
  } catch (error) {
    doc.status = 'failed'
    doc.errorMessage = toText(error?.message || 'unknown error')
    doc.updatedAt = new Date().toISOString()
    await upsertKnowledgeBaseDocumentRow(kbId, doc).catch(() => {})
    schedulePersistKnowledgeBaseStore()
  }
}

console.log(
  `[network-policy] HTTP_PROXY=${process.env.HTTP_PROXY || ''} HTTPS_PROXY=${process.env.HTTPS_PROXY || ''}`,
)
console.log(`[network-policy] NO_PROXY=${process.env.NO_PROXY || ''}`)

app.use(cors())
app.use(express.json({ limit: '25mb' }))
app.use('/api', async (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth')) {
    return next()
  }
  if (!dbReady) {
    await tryInitializeDatabaseIfNeeded('api-request')
  }
  if (!dbReady) {
    return res.status(503).json({
      code: 503,
      message: '数据库暂不可用，请检查 DB 配置或网络连通性',
      data: {
        dbReady,
        dbInitErrorMessage,
      },
    })
  }
  return next()
})

async function tryInitializeDatabaseIfNeeded(reason = 'unknown') {
  if (dbReady) return true
  if (dbReconnectInFlight) {
    await dbReconnectInFlight
    return dbReady
  }
  const now = Date.now()
  if (now - lastDbReconnectAttemptAt < dbReconnectCooldownMs) {
    return false
  }
  lastDbReconnectAttemptAt = now
  dbReconnectInFlight = (async () => {
    try {
      await initDatabase()
      dbReady = true
      dbInitErrorMessage = ''
      console.log(`[db-recovery] database ready (${reason})`)
    } catch (error) {
      dbReady = false
      dbInitErrorMessage = error.message || 'unknown_db_error'
      console.warn(`[db-recovery] database unavailable (${reason}): ${dbInitErrorMessage}`)
    } finally {
      dbReconnectInFlight = null
    }
  })()
  await dbReconnectInFlight
  return dbReady
}

async function initDatabase() {
  const sql = `
    CREATE TABLE IF NOT EXISTS ${inventoryTable} (
      id BIGSERIAL PRIMARY KEY,
      asset_code VARCHAR(64) NOT NULL UNIQUE,
      asset_name VARCHAR(128) NOT NULL,
      department VARCHAR(64) NOT NULL,
      owner VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL,
      location VARCHAR(128) NOT NULL,
      check_date DATE NOT NULL,
      remark TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_asset_inventory_updated_at ON ${inventoryTable}(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_inventory_status ON ${inventoryTable}(status);

    CREATE TABLE IF NOT EXISTS ${crawlTaskTable} (
      id BIGSERIAL PRIMARY KEY,
      task_name VARCHAR(128) NOT NULL,
      nl_command TEXT DEFAULT '',
      source_urls JSONB NOT NULL DEFAULT '[]',
      field_mapping JSONB NOT NULL DEFAULT '{}',
      filter_rules JSONB NOT NULL DEFAULT '{}',
      mode VARCHAR(16) NOT NULL DEFAULT 'incremental',
      frequency VARCHAR(16) NOT NULL DEFAULT 'day',
      request_interval_ms INT NOT NULL DEFAULT 1200,
      parse_status VARCHAR(16) NOT NULL DEFAULT 'parsed',
      parse_confidence NUMERIC(5,2) NOT NULL DEFAULT 0.90,
      compliance_passed BOOLEAN NOT NULL DEFAULT TRUE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      retry_count INT NOT NULL DEFAULT 0,
      max_retry INT NOT NULL DEFAULT 3,
      records_collected INT NOT NULL DEFAULT 0,
      success_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      dirty_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
      error_message TEXT DEFAULT '',
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      created_by VARCHAR(64) DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${crawlLogTable} (
      id BIGSERIAL PRIMARY KEY,
      task_id BIGINT NOT NULL REFERENCES ${crawlTaskTable}(id) ON DELETE CASCADE,
      level VARCHAR(16) NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      attempt INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${crawlQualityTable} (
      id BIGSERIAL PRIMARY KEY,
      task_id BIGINT NOT NULL UNIQUE REFERENCES ${crawlTaskTable}(id) ON DELETE CASCADE,
      total_count INT NOT NULL DEFAULT 0,
      dirty_count INT NOT NULL DEFAULT 0,
      duplicate_count INT NOT NULL DEFAULT 0,
      required_missing_count INT NOT NULL DEFAULT 0,
      quality_passed BOOLEAN NOT NULL DEFAULT TRUE,
      report_json JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_crawl_task_status ON ${crawlTaskTable}(status);
    CREATE INDEX IF NOT EXISTS idx_crawl_task_updated_at ON ${crawlTaskTable}(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crawl_log_task_id ON ${crawlLogTable}(task_id, created_at DESC);

    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS ${knowledgeBaseTable} (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      config_json JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${knowledgeBaseDocumentTable} (
      id VARCHAR(64) PRIMARY KEY,
      kb_id VARCHAR(64) NOT NULL REFERENCES ${knowledgeBaseTable}(id) ON DELETE CASCADE,
      source_type VARCHAR(16) NOT NULL,
      name VARCHAR(600) NOT NULL,
      url TEXT DEFAULT '',
      mime_type VARCHAR(200) DEFAULT '',
      size_bytes BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      chunk_count INT NOT NULL DEFAULT 0,
      vector_count INT NOT NULL DEFAULT 0,
      retry_count INT NOT NULL DEFAULT 0,
      error_message TEXT DEFAULT '',
      vector_path TEXT DEFAULT '',
      content_base64 TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_kb_doc_kb_id ON ${knowledgeBaseDocumentTable}(kb_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_kb_doc_status ON ${knowledgeBaseDocumentTable}(status);

    CREATE TABLE IF NOT EXISTS ${knowledgeBaseVectorTable} (
      id BIGSERIAL PRIMARY KEY,
      kb_id VARCHAR(64) NOT NULL REFERENCES ${knowledgeBaseTable}(id) ON DELETE CASCADE,
      doc_id VARCHAR(64) NOT NULL REFERENCES ${knowledgeBaseDocumentTable}(id) ON DELETE CASCADE,
      chunk_index INT NOT NULL DEFAULT 0,
      chunk_text TEXT NOT NULL DEFAULT '',
      embedding_model VARCHAR(120) NOT NULL DEFAULT 'Qwen/Qwen3-VL-Embedding-8B',
      embedding_dim INT NOT NULL DEFAULT 1536,
      embedding vector(1536),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_kb_vector_doc_id ON ${knowledgeBaseVectorTable}(doc_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_kb_vector_kb_id ON ${knowledgeBaseVectorTable}(kb_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS ${supplierOpinionVectorTable} (
      id BIGSERIAL PRIMARY KEY,
      supplier_name VARCHAR(255) NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      title VARCHAR(500) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      sentiment VARCHAR(32) NOT NULL DEFAULT 'neutral',
      embedding_model VARCHAR(120) NOT NULL DEFAULT 'Qwen/Qwen3-VL-Embedding-8B',
      embedding_dim INT NOT NULL DEFAULT 1536,
      embedding vector(1536),
      chunk_index INT NOT NULL DEFAULT 0,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_opinion_supplier_name ON ${supplierOpinionVectorTable}(supplier_name);
    CREATE INDEX IF NOT EXISTS idx_supplier_opinion_published_at ON ${supplierOpinionVectorTable}(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_opinion_embedding_ivfflat
      ON ${supplierOpinionVectorTable}
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);

    CREATE TABLE IF NOT EXISTS ${crawlInfoTable} (
      id BIGSERIAL PRIMARY KEY,
      source_file VARCHAR(255) NOT NULL DEFAULT '',
      crawl_type VARCHAR(16) NOT NULL DEFAULT '',
      business_entity VARCHAR(64) NOT NULL DEFAULT '',
      model VARCHAR(64) NOT NULL DEFAULT '',
      skill VARCHAR(128) NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      page_url TEXT NOT NULL DEFAULT '',
      page_title VARCHAR(255) NOT NULL DEFAULT '',
      text_sample TEXT NOT NULL DEFAULT '',
      status VARCHAR(32) NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      level1_url TEXT NOT NULL DEFAULT '',
      level2_url TEXT NOT NULL DEFAULT '',
      level3_url TEXT NOT NULL DEFAULT '',
      supplier_url TEXT NOT NULL DEFAULT '',
      level1_title VARCHAR(255) NOT NULL DEFAULT '',
      level2_title VARCHAR(255) NOT NULL DEFAULT '',
      level3_title VARCHAR(255) NOT NULL DEFAULT '',
      supply_chain_info TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplyChainNodeTable} (
      id BIGSERIAL PRIMARY KEY,
      parent_id BIGINT REFERENCES ${supplyChainNodeTable}(id) ON DELETE CASCADE,
      node_level SMALLINT NOT NULL,
      node_title VARCHAR(255) NOT NULL,
      node_url TEXT NOT NULL DEFAULT '',
      business_entity VARCHAR(64) NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      page_url TEXT NOT NULL DEFAULT '',
      page_title VARCHAR(255) NOT NULL DEFAULT '',
      text_sample TEXT NOT NULL DEFAULT '',
      level1_url TEXT NOT NULL DEFAULT '',
      level2_url TEXT NOT NULL DEFAULT '',
      level3_url TEXT NOT NULL DEFAULT '',
      supplier_url TEXT NOT NULL DEFAULT '',
      supply_chain_info TEXT NOT NULL DEFAULT '',
      crawl_info_id BIGINT REFERENCES ${crawlInfoTable}(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${gasSupplyChainNodeTable} (
      id BIGSERIAL PRIMARY KEY,
      parent_id BIGINT REFERENCES ${gasSupplyChainNodeTable}(id) ON DELETE CASCADE,
      node_level SMALLINT NOT NULL,
      node_title VARCHAR(255) NOT NULL,
      node_url TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      synced_supplier_count INT NOT NULL DEFAULT 0,
      synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierBaseTable} (
      id BIGSERIAL PRIMARY KEY,
      node_id BIGINT REFERENCES ${supplyChainNodeTable}(id) ON DELETE SET NULL,
      node_name VARCHAR(255) NOT NULL DEFAULT '',
      model VARCHAR(64) NOT NULL DEFAULT '',
      skill VARCHAR(128) NOT NULL DEFAULT '',
      company_name VARCHAR(255) NOT NULL DEFAULT '',
      main_products TEXT NOT NULL DEFAULT '',
      fit_export TEXT NOT NULL DEFAULT '',
      quality_system VARCHAR(255) NOT NULL DEFAULT '',
      region VARCHAR(120) NOT NULL DEFAULT '',
      contact_action VARCHAR(120) NOT NULL DEFAULT '',
      list_page_url TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      source_file VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${gasSupplierTable} (
      id BIGSERIAL PRIMARY KEY,
      gas_node_id BIGINT REFERENCES ${gasSupplyChainNodeTable}(id) ON DELETE SET NULL,
      gas_node_name VARCHAR(255) NOT NULL DEFAULT '',
      company_name VARCHAR(255) NOT NULL DEFAULT '',
      region VARCHAR(120) NOT NULL DEFAULT '',
      registered_capital VARCHAR(120) NOT NULL DEFAULT '',
      established_date VARCHAR(64) NOT NULL DEFAULT '',
      main_products TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      list_page_url TEXT NOT NULL DEFAULT '',
      model VARCHAR(64) NOT NULL DEFAULT '',
      skill VARCHAR(128) NOT NULL DEFAULT '',
      source_file VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${gasOemTable} (
      id BIGSERIAL PRIMARY KEY,
      oem_name VARCHAR(255) NOT NULL DEFAULT '',
      brand VARCHAR(255) NOT NULL DEFAULT '',
      vehicle_model TEXT NOT NULL DEFAULT '',
      region VARCHAR(120) NOT NULL DEFAULT '',
      registered_capital VARCHAR(120) NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      model VARCHAR(64) NOT NULL DEFAULT '',
      skill VARCHAR(128) NOT NULL DEFAULT '',
      source_file VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_source VARCHAR(16) NOT NULL DEFAULT 'gys',
      related_node_id BIGINT,
      related_node_name VARCHAR(255) NOT NULL DEFAULT '',
      related_node_ids JSONB NOT NULL DEFAULT '[]',
      related_node_names JSONB NOT NULL DEFAULT '[]',
      company_name VARCHAR(255) NOT NULL DEFAULT '',
      company_name_en VARCHAR(255) NOT NULL DEFAULT '',
      legal_representative VARCHAR(120) NOT NULL DEFAULT '',
      org_code VARCHAR(64) NOT NULL DEFAULT '',
      registered_capital VARCHAR(120) NOT NULL DEFAULT '',
      established_date VARCHAR(64) NOT NULL DEFAULT '',
      employees_count VARCHAR(64) NOT NULL DEFAULT '',
      company_type VARCHAR(120) NOT NULL DEFAULT '',
      contact_person VARCHAR(120) NOT NULL DEFAULT '',
      contact_title VARCHAR(120) NOT NULL DEFAULT '',
      phone VARCHAR(80) NOT NULL DEFAULT '',
      mobile VARCHAR(80) NOT NULL DEFAULT '',
      email VARCHAR(160) NOT NULL DEFAULT '',
      website VARCHAR(255) NOT NULL DEFAULT '',
      postal_code VARCHAR(32) NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      company_intro TEXT NOT NULL DEFAULT '',
      fit_situation TEXT NOT NULL DEFAULT '',
      export_situation TEXT NOT NULL DEFAULT '',
      certificates TEXT NOT NULL DEFAULT '',
      company_news TEXT NOT NULL DEFAULT '',
      products JSONB NOT NULL DEFAULT '[]',
      contacts JSONB NOT NULL DEFAULT '[]',
      fit_oems JSONB NOT NULL DEFAULT '[]',
      product_fit_details JSONB NOT NULL DEFAULT '[]',
      export_countries JSONB NOT NULL DEFAULT '[]',
      certificate_items JSONB NOT NULL DEFAULT '[]',
      news_items JSONB NOT NULL DEFAULT '[]',
      company_tags JSONB NOT NULL DEFAULT '[]',
      main_product_names JSONB NOT NULL DEFAULT '[]',
      business_info JSONB NOT NULL DEFAULT '{}',
      industrial_commercial_info JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileCustomerTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      product_name VARCHAR(255) NOT NULL DEFAULT '',
      oem_names JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileProductCaseTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      product_name VARCHAR(255) NOT NULL DEFAULT '',
      vehicle_model VARCHAR(255) NOT NULL DEFAULT '',
      customer_name VARCHAR(255) NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileFinancingTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      financing_date VARCHAR(64) NOT NULL DEFAULT '',
      financing_round VARCHAR(120) NOT NULL DEFAULT '',
      financing_amount VARCHAR(120) NOT NULL DEFAULT '',
      investors TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileSoftwareCopyrightTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      software_name TEXT NOT NULL DEFAULT '',
      version VARCHAR(120) NOT NULL DEFAULT '',
      release_date VARCHAR(64) NOT NULL DEFAULT '',
      software_alias VARCHAR(255) NOT NULL DEFAULT '',
      registration_no VARCHAR(255) NOT NULL DEFAULT '',
      approval_date VARCHAR(64) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfilePatentTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      patent_type VARCHAR(120) NOT NULL DEFAULT '',
      publication_no VARCHAR(120) NOT NULL DEFAULT '',
      publication_date VARCHAR(64) NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      application_no VARCHAR(120) NOT NULL DEFAULT '',
      application_date VARCHAR(64) NOT NULL DEFAULT '',
      inventors TEXT NOT NULL DEFAULT '',
      assignee TEXT NOT NULL DEFAULT '',
      agency VARCHAR(255) NOT NULL DEFAULT '',
      agent VARCHAR(255) NOT NULL DEFAULT '',
      legal_status VARCHAR(255) NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileAdminLicenseTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      document_no VARCHAR(255) NOT NULL DEFAULT '',
      authority VARCHAR(255) NOT NULL DEFAULT '',
      decision_date VARCHAR(64) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status VARCHAR(120) NOT NULL DEFAULT '',
      valid_until VARCHAR(64) NOT NULL DEFAULT '',
      category VARCHAR(120) NOT NULL DEFAULT '',
      region VARCHAR(120) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileAdminLicenseGsTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      permit_no VARCHAR(255) NOT NULL DEFAULT '',
      permit_name TEXT NOT NULL DEFAULT '',
      valid_from VARCHAR(64) NOT NULL DEFAULT '',
      valid_to VARCHAR(64) NOT NULL DEFAULT '',
      authority VARCHAR(255) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileTradeCreditTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      customs_office VARCHAR(255) NOT NULL DEFAULT '',
      business_type VARCHAR(120) NOT NULL DEFAULT '',
      registration_date VARCHAR(64) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      registration_code VARCHAR(120) NOT NULL DEFAULT '',
      administrative_region VARCHAR(120) NOT NULL DEFAULT '',
      economic_region VARCHAR(120) NOT NULL DEFAULT '',
      credit_level VARCHAR(120) NOT NULL DEFAULT '',
      annual_report_status VARCHAR(120) NOT NULL DEFAULT '',
      validity_period VARCHAR(120) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileCourtNoticeTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      case_no VARCHAR(255) NOT NULL DEFAULT '',
      hearing_date VARCHAR(64) NOT NULL DEFAULT '',
      cause TEXT NOT NULL DEFAULT '',
      plaintiff TEXT NOT NULL DEFAULT '',
      defendant TEXT NOT NULL DEFAULT '',
      court VARCHAR(255) NOT NULL DEFAULT '',
      tribunal VARCHAR(255) NOT NULL DEFAULT '',
      region VARCHAR(120) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileProductionBaseTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      base_name VARCHAR(255) NOT NULL DEFAULT '',
      region VARCHAR(255) NOT NULL DEFAULT '',
      postal_code VARCHAR(64) NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      phone VARCHAR(255) NOT NULL DEFAULT '',
      main_products TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileNewsTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      source VARCHAR(255) NOT NULL DEFAULT '',
      publish_date VARCHAR(64) NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierProfileEquipmentTable} (
      id BIGSERIAL PRIMARY KEY,
      profile_id BIGINT NOT NULL REFERENCES ${supplierProfileTable}(id) ON DELETE CASCADE,
      sort_order INT NOT NULL DEFAULT 0,
      equipment_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierOemDictTable} (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierCountryDictTable} (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${supplierCertDictTable} (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${gasSupplierPortraitSettingTable} (
      setting_key VARCHAR(64) PRIMARY KEY,
      settings_json JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_crawl_info_source_file ON ${crawlInfoTable}(source_file, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crawl_info_business_entity ON ${crawlInfoTable}(business_entity);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_node_parent ON ${supplyChainNodeTable}(parent_id, node_level);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_node_source ON ${supplyChainNodeTable}(source_url, business_entity);
    CREATE INDEX IF NOT EXISTS idx_gas_supply_chain_node_parent ON ${gasSupplyChainNodeTable}(parent_id, node_level);
    CREATE INDEX IF NOT EXISTS idx_gas_supply_chain_node_source ON ${gasSupplyChainNodeTable}(source_url);
    CREATE INDEX IF NOT EXISTS idx_supplier_base_node ON ${supplierBaseTable}(node_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_base_company ON ${supplierBaseTable}(company_name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_base_unique
      ON ${supplierBaseTable}(COALESCE(node_id, 0), company_name, detail_url);
    CREATE INDEX IF NOT EXISTS idx_gas_supplier_node ON ${gasSupplierTable}(gas_node_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gas_supplier_company ON ${gasSupplierTable}(company_name, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gas_supplier_unique
      ON ${gasSupplierTable}(COALESCE(gas_node_id, 0), company_name, detail_url);
    CREATE INDEX IF NOT EXISTS idx_gas_oem_name ON ${gasOemTable}(oem_name, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_company ON ${supplierProfileTable}(company_name, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_source_company ON ${supplierProfileTable}(profile_source, company_name, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_customer_profile ON ${supplierProfileCustomerTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_product_case_profile ON ${supplierProfileProductCaseTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_financing_profile ON ${supplierProfileFinancingTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_software_copyright_profile ON ${supplierProfileSoftwareCopyrightTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_patent_profile ON ${supplierProfilePatentTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_admin_license_profile ON ${supplierProfileAdminLicenseTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_admin_license_gs_profile ON ${supplierProfileAdminLicenseGsTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_trade_credit_profile ON ${supplierProfileTradeCreditTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_court_notice_profile ON ${supplierProfileCourtNoticeTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_production_base_profile ON ${supplierProfileProductionBaseTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_news_profile ON ${supplierProfileNewsTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_equipment_profile ON ${supplierProfileEquipmentTable}(profile_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_supplier_oem_dict_sort ON ${supplierOemDictTable}(sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_supplier_country_dict_sort ON ${supplierCountryDictTable}(sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_supplier_cert_dict_sort ON ${supplierCertDictTable}(sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_gas_supplier_portrait_setting_updated_at ON ${gasSupplierPortraitSettingTable}(updated_at DESC);
    DROP INDEX IF EXISTS idx_supply_chain_node_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supply_chain_node_unique
      ON ${supplyChainNodeTable}(COALESCE(parent_id, 0), node_level, node_title, source_url);
    DROP INDEX IF EXISTS idx_gas_supply_chain_node_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gas_supply_chain_node_unique
      ON ${gasSupplyChainNodeTable}(COALESCE(parent_id, 0), node_level, node_title, source_url);

    ALTER TABLE ${supplyChainNodeTable}
      DROP CONSTRAINT IF EXISTS supply_chain_node_node_level_check;
    ALTER TABLE ${supplyChainNodeTable}
      ADD CONSTRAINT supply_chain_node_node_level_check CHECK (node_level BETWEEN 1 AND 5);
    ALTER TABLE ${gasSupplyChainNodeTable}
      DROP CONSTRAINT IF EXISTS gas_supply_chain_node_node_level_check;
    ALTER TABLE ${gasSupplyChainNodeTable}
      ADD CONSTRAINT gas_supply_chain_node_node_level_check CHECK (node_level BETWEEN 1 AND 5);

    ALTER TABLE ${gasOemTable} ADD COLUMN IF NOT EXISTS brand VARCHAR(255) NOT NULL DEFAULT '';
    ALTER TABLE ${gasOemTable} ADD COLUMN IF NOT EXISTS vehicle_model TEXT NOT NULL DEFAULT '';
    DROP INDEX IF EXISTS idx_gas_oem_unique;
    ALTER TABLE ${gasOemTable} DROP COLUMN IF EXISTS source_url;
    WITH ranked_gas_oem AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY oem_name ORDER BY updated_at DESC, id DESC) AS rn
      FROM ${gasOemTable}
    )
    DELETE FROM ${gasOemTable} t
    USING ranked_gas_oem r
    WHERE t.id = r.id AND r.rn > 1;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gas_oem_unique
      ON ${gasOemTable}(oem_name);

    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS contacts JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS fit_oems JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS product_fit_details JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS export_countries JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS certificate_items JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS news_items JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS company_tags JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS main_product_names JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS business_info JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS industrial_commercial_info JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS profile_source VARCHAR(16) NOT NULL DEFAULT 'gys';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_id BIGINT;
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_name VARCHAR(255) NOT NULL DEFAULT '';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_ids JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_names JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS org_code VARCHAR(64) NOT NULL DEFAULT '';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS source_supplier_id BIGINT REFERENCES ${gasSupplierTable}(id) ON DELETE SET NULL;
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS supplier_profile_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE ${supplierProfileTradeCreditTable} ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_source_supplier ON ${supplierProfileTable}(source_supplier_id);

    CREATE TABLE IF NOT EXISTS ${chatSessionTable} (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      owner VARCHAR(64) NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ${chatMessageTable} (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES ${chatSessionTable}(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session_updated_at ON ${chatSessionTable}(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_session_pinned ON ${chatSessionTable}(pinned DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_message_session ON ${chatMessageTable}(session_id, id ASC);

    CREATE TABLE IF NOT EXISTS ${langchainSessionStateTable} (
      id BIGSERIAL PRIMARY KEY,
      owner VARCHAR(128) NOT NULL,
      chat_type VARCHAR(32) NOT NULL DEFAULT 'multi_chat',
      sessions_json JSONB NOT NULL DEFAULT '[]',
      current_session VARCHAR(128) NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ${preciseSourcingRunTable} (
      id BIGSERIAL PRIMARY KEY,
      owner VARCHAR(128) NOT NULL,
      trace_version VARCHAR(64) NOT NULL DEFAULT '',
      user_input TEXT NOT NULL DEFAULT '',
      selected_tools JSONB NOT NULL DEFAULT '[]',
      selected_kb_ids JSONB NOT NULL DEFAULT '[]',
      selected_db_tables JSONB NOT NULL DEFAULT '[]',
      model_name VARCHAR(255) NOT NULL DEFAULT '',
      answer TEXT NOT NULL DEFAULT '',
      query_statements JSONB NOT NULL DEFAULT '{}',
      evidence JSONB NOT NULL DEFAULT '{}',
      traces JSONB NOT NULL DEFAULT '[]',
      react JSONB NOT NULL DEFAULT '{}',
      artifacts JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_precise_sourcing_run_owner_created
      ON ${preciseSourcingRunTable}(owner, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_precise_sourcing_run_trace_version
      ON ${preciseSourcingRunTable}(trace_version);
    CREATE TABLE IF NOT EXISTS ${modelProviderTable} (
      id BIGSERIAL PRIMARY KEY,
      provider_name VARCHAR(64) NOT NULL UNIQUE,
      provider_type VARCHAR(64) NOT NULL DEFAULT 'OpenAI',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      api_key TEXT NOT NULL DEFAULT '',
      api_base_url TEXT NOT NULL DEFAULT '',
      models_json JSONB NOT NULL DEFAULT '[]',
      fetched_models_json JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ${modelProviderModelTable} (
      id BIGSERIAL PRIMARY KEY,
      provider_name VARCHAR(64) NOT NULL,
      model_id VARCHAR(255) NOT NULL,
      group_name VARCHAR(128) NOT NULL DEFAULT 'Other',
      capability_video BOOLEAN NOT NULL DEFAULT FALSE,
      capability_reasoning BOOLEAN NOT NULL DEFAULT FALSE,
      capability_tool BOOLEAN NOT NULL DEFAULT TRUE,
      owned_by VARCHAR(255) NOT NULL DEFAULT '',
      object_type VARCHAR(64) NOT NULL DEFAULT '',
      source_type VARCHAR(32) NOT NULL DEFAULT 'saved',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider_name, model_id),
      CONSTRAINT fk_model_provider_model_provider
        FOREIGN KEY (provider_name)
        REFERENCES ${modelProviderTable}(provider_name)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_model_provider_updated_at ON ${modelProviderTable}(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_model_provider_model_provider ON ${modelProviderModelTable}(provider_name, sort_order ASC);
    CREATE INDEX IF NOT EXISTS idx_model_provider_model_group ON ${modelProviderModelTable}(provider_name, group_name);
    ALTER TABLE ${modelProviderTable} ADD COLUMN IF NOT EXISTS provider_type VARCHAR(64) NOT NULL DEFAULT 'OpenAI';
    ALTER TABLE ${langchainSessionStateTable} ADD COLUMN IF NOT EXISTS id BIGSERIAL;
    ALTER TABLE ${langchainSessionStateTable} ADD COLUMN IF NOT EXISTS chat_type VARCHAR(32) NOT NULL DEFAULT 'multi_chat';
    UPDATE ${langchainSessionStateTable}
    SET id = nextval(pg_get_serial_sequence('${schemaName}.langchain_multi_chat_state', 'id'))
    WHERE id IS NULL;
    DO $$
    DECLARE
      pk_name text;
    BEGIN
      SELECT c.conname INTO pk_name
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'p'
        AND t.relname = 'langchain_multi_chat_state'
        AND n.nspname = '${schemaName}'
      LIMIT 1;
      IF pk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', '${schemaName}', 'langchain_multi_chat_state', pk_name);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END $$;
    ALTER TABLE ${langchainSessionStateTable} ALTER COLUMN id SET NOT NULL;
    ALTER TABLE ${langchainSessionStateTable} ADD PRIMARY KEY (id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_langchain_multi_chat_state_owner_type
      ON ${langchainSessionStateTable}(owner, chat_type);
    CREATE INDEX IF NOT EXISTS idx_langchain_multi_chat_state_updated_at ON ${langchainSessionStateTable}(updated_at DESC);
  `
  await pool.query(sql)
  await pool.query(
    `
    UPDATE ${supplierProfileTable}
    SET profile_source = 'gas'
    WHERE website ILIKE '%gasgoo%' AND profile_source <> 'gas'
    `,
  )
  await pool.query(
    `
    UPDATE ${supplierProfileTable}
    SET profile_source = 'gys'
    WHERE COALESCE(profile_source, '') = '' OR profile_source NOT IN ('gys', 'gas')
    `,
  )
  await pool.query(
    `
    INSERT INTO ${supplyChainNodeTable}
      (parent_id, node_level, node_title, node_url, source_url, business_entity, updated_at)
    VALUES
      (NULL, 1, $1, '', '', '供应链', NOW())
    ON CONFLICT (COALESCE(parent_id, 0), node_level, node_title, source_url) DO NOTHING
    `,
    [supplyChainRootTitle],
  )
  await pool.query(
    `
    INSERT INTO ${supplierOemDictTable} (name, sort_order, updated_at)
    VALUES
      ('一汽丰田', 10, NOW()),
      ('广汽丰田', 20, NOW()),
      ('广汽本田', 30, NOW()),
      ('东风本田', 40, NOW()),
      ('东风日产', 50, NOW()),
      ('奇瑞汽车', 60, NOW())
    ON CONFLICT (name) DO NOTHING
    `,
  )
  await pool.query(
    `
    INSERT INTO ${supplierCountryDictTable} (name, sort_order, updated_at)
    VALUES
      ('日本', 10, NOW()),
      ('美国', 20, NOW()),
      ('波兰', 30, NOW()),
      ('巴西', 40, NOW()),
      ('东南亚', 50, NOW()),
      ('欧洲', 60, NOW()),
      ('南美洲', 70, NOW()),
      ('亚洲', 80, NOW())
    ON CONFLICT (name) DO NOTHING
    `,
  )
  await pool.query(
    `
    INSERT INTO ${supplierCertDictTable} (name, sort_order, updated_at)
    VALUES
      ('16949系列', 10, NOW()),
      ('ISO9000系列', 20, NOW()),
      ('VDA认证', 30, NOW()),
      ('ISO14000', 40, NOW())
    ON CONFLICT (name) DO NOTHING
    `,
  )
  await fs.mkdir(crawlExportDir, { recursive: true })
  await restoreSupplierTaskStore()
  await restoreGasSupplyChainTaskStore()
}

function parseNaturalCommand(command) {
  const text = String(command || '').trim()
  if (!text) {
    return {
      parseStatus: 'failed',
      parseConfidence: 0,
      reason: '自然语言指令为空',
      taskName: '',
      mode: 'incremental',
      frequency: 'day',
      sources: [],
      filterRules: {},
    }
  }

  const mode = /全量/.test(text) ? 'full' : 'incremental'
  const frequency = /每周|按周|周更/.test(text) ? 'week' : 'day'
  const sourceHints = []
  if (/企业官网/.test(text)) sourceHints.push('企业官网')
  if (/行业|平台/.test(text)) sourceHints.push('行业平台')
  if (/招投标/.test(text)) sourceHints.push('招投标网站')
  if (/专利|认证/.test(text)) sourceHints.push('专利/认证平台')
  if (/新闻|资讯/.test(text)) sourceHints.push('新闻资讯')

  const fallbackSources = ['企业官网', '行业平台', '招投标网站', '专利/认证平台', '新闻资讯']
  const parsedSources = sourceHints.length > 0 ? sourceHints : fallbackSources

  return {
    parseStatus: 'parsed',
    parseConfidence: 0.92,
    reason: '',
    taskName: text.slice(0, 64),
    mode,
    frequency,
    sources: parsedSources.map((name, idx) => ({
      name,
      url: `https://source-${idx + 1}.example.com`,
    })),
    filterRules: {
      keyword: '智能网联新能源汽车',
      region: '全国',
    },
  }
}

function complianceCheck(command, sourceUrls) {
  const text = `${command || ''} ${JSON.stringify(sourceUrls || [])}`
  const blockedPatterns = ['绕过验证码', '撞库', '无限制抓取', '攻击', '破解']
  const hit = blockedPatterns.find((item) => text.includes(item))
  if (hit) {
    return { passed: false, reason: `命中合规风险词: ${hit}` }
  }
  return { passed: true, reason: '' }
}

async function appendTaskLog(taskId, level, message, attempt = 1) {
  await pool.query(
    `INSERT INTO ${crawlLogTable} (task_id, level, message, attempt) VALUES ($1, $2, $3, $4)`,
    [taskId, level, message, attempt],
  )
}

async function simulateTaskExecution(taskId, trigger = 'start') {
  const taskRes = await pool.query(`SELECT * FROM ${crawlTaskTable} WHERE id = $1`, [taskId])
  const task = taskRes.rows[0]
  if (!task) {
    return { ok: false, code: 404, message: '任务不存在' }
  }
  if (!task.compliance_passed) {
    await pool.query(
      `UPDATE ${crawlTaskTable}
       SET status='failed', error_message=$2, ended_at=NOW(), updated_at=NOW()
       WHERE id=$1`,
      [taskId, '合规校验未通过，禁止执行'],
    )
    await appendTaskLog(taskId, 'error', '合规校验失败，任务终止', task.retry_count + 1)
    return { ok: false, code: 400, message: '合规校验未通过，禁止执行' }
  }

  const nextRetry = trigger === 'retry' ? task.retry_count + 1 : task.retry_count
  await pool.query(
    `UPDATE ${crawlTaskTable}
     SET status='running', started_at=NOW(), ended_at=NULL, error_message='', retry_count=$2, updated_at=NOW()
     WHERE id=$1`,
    [taskId, nextRetry],
  )
  await appendTaskLog(taskId, 'info', '调度引擎已启动，开始采集数据源', nextRetry + 1)

  const total = 120 + (Number(taskId) % 37)
  const dirty = (Number(taskId) % 5) + (trigger === 'retry' ? 1 : 0)
  const duplicate = Number(taskId) % 4
  const missing = Number(taskId) % 3
  const successRate = Number((((total - dirty) / total) * 100).toFixed(2))
  const dirtyRate = Number(((dirty / total) * 100).toFixed(2))
  const qualityPassed = dirtyRate <= 0.5
  const finalStatus = qualityPassed ? 'success' : 'failed'

  await appendTaskLog(taskId, 'info', '数据清洗与标准化完成，正在写入MPP数据库', nextRetry + 1)
  if (!qualityPassed) {
    await appendTaskLog(taskId, 'warning', '脏数据率超过阈值，任务标记失败', nextRetry + 1)
  } else {
    await appendTaskLog(taskId, 'info', '任务执行完成，已写入目标数据库', nextRetry + 1)
  }

  await pool.query(
    `INSERT INTO ${crawlQualityTable}
      (task_id, total_count, dirty_count, duplicate_count, required_missing_count, quality_passed, report_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (task_id) DO UPDATE
     SET total_count = EXCLUDED.total_count,
         dirty_count = EXCLUDED.dirty_count,
         duplicate_count = EXCLUDED.duplicate_count,
         required_missing_count = EXCLUDED.required_missing_count,
         quality_passed = EXCLUDED.quality_passed,
         report_json = EXCLUDED.report_json,
         updated_at = NOW()`,
    [
      taskId,
      total,
      dirty,
      duplicate,
      missing,
      qualityPassed,
      JSON.stringify({
        total,
        dirty,
        duplicate,
        requiredMissing: missing,
        qualityPassed,
        trigger,
      }),
    ],
  )

  await pool.query(
    `UPDATE ${crawlTaskTable}
     SET status=$2, records_collected=$3, success_rate=$4, dirty_rate=$5, ended_at=NOW(), updated_at=NOW(),
         error_message=$6
     WHERE id=$1`,
    [taskId, finalStatus, total, successRate, dirtyRate, qualityPassed ? '' : '脏数据率超过阈值'],
  )

  return { ok: true, code: 200, message: qualityPassed ? '任务执行成功' : '任务执行完成，但质量未达标' }
}

function parsePromptInstruction(promptText) {
  const text = String(promptText || '')
  const allUrls = [...text.matchAll(/https?:\/\/[^\s,，]+/g)].map((item) => item[0].trim())
  const crawlTypeMatch = text.match(/爬取类型[:：]?\s*(全量|增量)/)
  const entityMatch = text.match(/映射业务实体[:：]?\s*([^\n\r]+)/)
  const inferredCrawlType = /全量/.test(text) ? '全量' : /增量/.test(text) ? '增量' : ''
  const inferredEntity = (() => {
    const options = ['供应链', '供应商', '企业', '产品', '招标', '汽车流通', '交易', '口碑']
    return options.find((item) => text.includes(item)) || ''
  })()
  return {
    crawlType: crawlTypeMatch?.[1] || inferredCrawlType || '增量',
    businessEntity: entityMatch?.[1]?.trim() || inferredEntity || '供应商',
    urls: [...new Set(allUrls)],
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? stripHtml(match[1]).slice(0, 200) : ''
}

function extractLinks(html, baseUrl) {
  const links = []
  const regex = /href\s*=\s*["']([^"'#]+)["']/gi
  let match = regex.exec(String(html || ''))
  while (match) {
    const raw = String(match[1] || '').trim()
    if (raw && !raw.startsWith('javascript:') && !raw.startsWith('mailto:')) {
      try {
        links.push(new URL(raw, baseUrl).toString())
      } catch {}
    }
    match = regex.exec(String(html || ''))
  }
  return [...new Set(links)]
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (/[,"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function parseCsvRows(csvText) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < csvText.length; i += 1) {
    const ch = csvText[i]
    const next = csvText[i + 1]
    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += ch
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function parseCsvObjects(csvText) {
  const rows = parseCsvRows(csvText)
  if (rows.length === 0) return []
  const headers = rows[0].map((item) => String(item || '').replace(/^\uFEFF/, '').trim())
  return rows.slice(1).filter((r) => r.some((item) => String(item || '').trim())).map((row) => {
    const obj = {}
    headers.forEach((header, idx) => {
      obj[header] = String(row[idx] ?? '').trim()
    })
    return obj
  })
}

function toText(value) {
  return String(value || '').trim()
}

function toJsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (_key, current) => (typeof current === 'bigint' ? Number(current) : current)))
}

function parseJsonValueFromText(text = '') {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function parseJsonValueFromMixedText(text = '') {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  const direct = parseJsonValueFromText(trimmed)
  if (direct !== null) return direct
  const lines = trimmed.split(/\r?\n/g)
  const start = Math.max(0, lines.length - 120)
  for (let i = lines.length - 1; i >= start; i -= 1) {
    const candidate = lines.slice(i).join('\n').trim()
    if (!candidate || (!candidate.startsWith('{') && !candidate.startsWith('['))) continue
    const parsed = parseJsonValueFromText(candidate)
    if (parsed !== null) return parsed
  }
  return null
}

function normalizeLocalExtractorArgs(input, fallbackJson = '[]') {
  if (Array.isArray(input)) {
    return input.map((item) => toText(item)).filter(Boolean)
  }
  const text = toText(input)
  if (text) {
    const parsed = parseJsonValueFromMixedText(text)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => toText(item)).filter(Boolean)
    }
    return text.split(/\r?\n/g).map((item) => toText(item)).filter(Boolean)
  }
  const parsedFallback = parseJsonValueFromText(fallbackJson)
  if (Array.isArray(parsedFallback)) {
    return parsedFallback.map((item) => toText(item)).filter(Boolean)
  }
  return []
}

async function fileExists(filePath = '') {
  const normalized = toText(filePath)
  if (!normalized) return false
  try {
    await fs.access(normalized)
    return true
  } catch {
    return false
  }
}

function buildWebAccessDefaultStartScriptCandidates() {
  const userHome = toText(process.env.USERPROFILE || process.env.HOME)
  const candidates = [
    webAccessCheckDepsScriptDefault,
    path.join(process.cwd(), '.agents', 'skills', 'web-access', 'scripts', 'check-deps.mjs'),
    path.join(process.cwd(), '..', '.agents', 'skills', 'web-access', 'scripts', 'check-deps.mjs'),
    path.join(userHome, '.codex', 'skills', 'web-access', 'scripts', 'check-deps.mjs'),
    'C:\\Users\\aoyon\\.codex\\skills\\web-access\\scripts\\check-deps.mjs',
  ]
  return [...new Set(candidates.map((item) => toText(item)).filter(Boolean))]
}

function buildWebAccessProjectStartScriptCandidates() {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'start-web-access.ps1'),
    path.join(process.cwd(), '..', 'scripts', 'start-web-access.ps1'),
  ]
  return [...new Set(candidates.map((item) => toText(item)).filter(Boolean))]
}

async function resolveWebAccessStartConfig() {
  const command = toText(webAccessStartCommandDefault)
  const args = normalizeLocalExtractorArgs(webAccessStartArgsJsonDefault, '[]')
  if (command) {
    return {
      command,
      args,
      cwd: toText(webAccessStartCwdDefault) || process.cwd(),
      mode: 'env',
    }
  }

  const projectCandidates = buildWebAccessProjectStartScriptCandidates()
  for (const scriptPath of projectCandidates) {
    if (await fileExists(scriptPath)) {
      return {
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        cwd: path.dirname(scriptPath),
        mode: 'project-script',
        scriptPath,
      }
    }
  }

  const candidates = buildWebAccessDefaultStartScriptCandidates()
  for (const scriptPath of candidates) {
    if (await fileExists(scriptPath)) {
      return {
        command: process.execPath,
        args: [scriptPath],
        cwd: path.dirname(scriptPath),
        mode: 'builtin',
        scriptPath,
      }
    }
  }

  return null
}

function normalizeGasSupplyChainTaskRow(input, taskMeta = {}, fallbackSourceUrl = '') {
  if (!input || typeof input !== 'object') return null
  const nodeLevel = Number(input.nodeLevel ?? input.node_level ?? 0)
  const nodeTitle = toText(input.nodeTitle ?? input.node_title)
  if (!Number.isInteger(nodeLevel) || nodeLevel < 1 || nodeLevel > 5 || !nodeTitle) return null
  const sourceUrl = toText(input.sourceUrl ?? input.source_url) || toText(fallbackSourceUrl)
  const pageUrl = toText(input.pageUrl ?? input.page_url) || sourceUrl
  const level1Title = toText(input.level1Title ?? input.level1_title) || (nodeLevel === 1 ? nodeTitle : '')
  const level2Title = toText(input.level2Title ?? input.level2_title) || (nodeLevel === 2 ? nodeTitle : '')
  const level3Title = toText(input.level3Title ?? input.level3_title) || (nodeLevel === 3 ? nodeTitle : '')
  const lineage = toText(input.lineage) || [level1Title, level2Title, level3Title].filter(Boolean).join(' > ') || nodeTitle
  return {
    sourceUrl,
    pageUrl,
    model: toText(input.model) || toText(taskMeta.model),
    skill: toText(input.skill) || toText(taskMeta.skill),
    mode: toText(input.mode) || toText(taskMeta.mode || 'full'),
    nodeLevel,
    nodeCode: toText(input.nodeCode ?? input.node_code),
    nodeTitle,
    nodeUrl: toText(input.nodeUrl ?? input.node_url),
    parentCode: toText(input.parentCode ?? input.parent_code),
    parentTitle: toText(input.parentTitle ?? input.parent_title),
    parentUrl: toText(input.parentUrl ?? input.parent_url),
    level1Code: toText(input.level1Code ?? input.level1_code),
    level1Title,
    level1Url: toText(input.level1Url ?? input.level1_url),
    level2Code: toText(input.level2Code ?? input.level2_code),
    level2Title,
    level2Url: toText(input.level2Url ?? input.level2_url),
    level3Code: toText(input.level3Code ?? input.level3_code),
    level3Title,
    level3Url: toText(input.level3Url ?? input.level3_url),
    lineage,
    status: toText(input.status) || 'success',
    errorMessage: toText(input.errorMessage ?? input.error_message),
  }
}

function normalizeGasSupplyChainTaskRows(inputRows = [], taskMeta = {}, fallbackSourceUrl = '') {
  if (!Array.isArray(inputRows)) return []
  const rows = []
  for (const item of inputRows) {
    const normalized = normalizeGasSupplyChainTaskRow(item, taskMeta, fallbackSourceUrl)
    if (normalized) rows.push(normalized)
  }
  return rows
}

function parsePositiveBigintId(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  try {
    const asBigInt = BigInt(text)
    if (asBigInt <= 0n) return null
    return asBigInt.toString()
  } catch {
    return null
  }
}

function makeRuntimeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseStringArray(input) {
  const list = Array.isArray(input) ? input : []
  return [...new Set(list.map((item) => toText(item)).filter(Boolean))]
}

async function upsertSupplierDictItems(client, tableName, names = []) {
  const values = parseStringArray(names)
  if (values.length === 0) return
  await client.query(
    `
    INSERT INTO ${tableName} (name, sort_order, updated_at)
    SELECT item.name, 1000 + item.ord, NOW()
    FROM UNNEST($1::text[]) WITH ORDINALITY AS item(name, ord)
    ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
    `,
    [values],
  )
}

function parseBigintArray(input) {
  const list = Array.isArray(input) ? input : []
  const ids = []
  for (const item of list) {
    const num = Number(item)
    if (Number.isInteger(num) && num > 0) ids.push(num)
  }
  return [...new Set(ids)]
}

function parseBigintArrayLoose(input) {
  if (Array.isArray(input)) return parseBigintArray(input)
  const text = String(input || '').trim()
  if (!text) return []
  return parseBigintArray(text.split(/[,\s，；;|]+/g))
}

function mergeSupplierNodeRefs(existingIds, existingNames, incomingId, incomingName) {
  const ids = parseBigintArray(existingIds)
  const names = parseStringArray(existingNames)
  const parsedIncomingId = Number(incomingId)
  if (Number.isInteger(parsedIncomingId) && parsedIncomingId > 0) {
    if (!ids.includes(parsedIncomingId)) ids.push(parsedIncomingId)
  }
  const normalizedName = toText(incomingName)
  if (normalizedName && !names.includes(normalizedName)) names.push(normalizedName)
  return { ids, names }
}

function splitSupplierProductTexts(text = '') {
  const cleaned = cleanSupplierFieldText(String(text || '')
    .replace(/(?:主要产品|主营产品)[:：]?/g, ' '))
  if (!cleaned) return []
  const parts = cleaned
    .split(/[，,；;、|｜/]+/g)
    .map((item) => cleanSupplierFieldText(item))
    .filter((item) => item.length >= 2)
    .filter((item) => !/^(首页|主要产品|企业简介|联系方式|新闻发布|更多)$/.test(item))
  return [...new Set(parts)].slice(0, 30)
}

function splitSupplierTextTokens(text = '') {
  return cleanSupplierFieldText(text)
    .split(/[，,；;、|｜/]+/g)
    .map((item) => cleanSupplierFieldText(item))
    .filter(Boolean)
}

function isSupplierProductNoise(text = '') {
  const value = cleanSupplierFieldText(text)
  if (!value) return true
  if (/^>\s*所有产品$/i.test(value) || /^所有产品$/i.test(value)) return true
  if (/汽车行业电子商务平台|汽车供应商网|中国汽车供应商网|全面展示中国最优质汽车供应商/i.test(value)) return true
  if (/^-\s*.+\s*-\s*-\s*及汽车零部件供应商的汽车行业电子商务平台$/i.test(value)) return true
  if (/^(?:首页|更多|公司简介|联系我们|企业证书|公司新闻|产品展示|重点产品|主营产品|主要产品)$/.test(value)) return true
  return false
}

function sanitizeSupplierCertificatesText(text = '') {
  const value = cleanSupplierFieldText(text)
  if (!value) return ''
  if (looksLikeSupplierTabMenuNoise(value)) return ''
  if (/公司视频/.test(value) && !/(IATF|ISO|VDA|QS|TS|认证|证书|体系|高新技术企业)/i.test(value)) return ''
  return value
}

function normalizeSupplierProductName(text = '') {
  return cleanSupplierFieldText(String(text || '')
    .replace(/^(?:产品名称|名称|产品分类|产品展示|主要产品|主营产品|重点产品)[:：]?\s*/g, '')
    .replace(/(?:点击查看|查看详情|更多|立即咨询)$/g, '')
    .replace(/[.。;；,，]+$/g, ''))
}

function dedupeSupplierProductNames(names = []) {
  const result = []
  for (const item of Array.isArray(names) ? names : []) {
    const name = normalizeSupplierProductName(item)
    if (!name || name.length < 2) continue
    if (isSupplierProductNoise(name)) continue
    if (!result.includes(name)) result.push(name)
  }
  return result.slice(0, 80)
}

function buildSupplierProductsFromNames(names = []) {
  return parseSupplierProfileProducts(
    dedupeSupplierProductNames(names).map((name) => ({
      id: makeRuntimeId('p'),
      name,
      model: '',
      application: '',
      material: '',
      advantages: '',
      appearance: '',
      precision: '',
      scenarios: '',
      imageUrl: '',
      parameters: '',
    })),
  )
}

function buildSupplierProductFitDetails(productNames = [], oemNames = []) {
  const names = dedupeSupplierProductNames(productNames)
  const oems = parseStringArray(oemNames)
  if (names.length === 0 || oems.length === 0) return []
  const rows = []
  for (const productName of names) {
    for (const oemName of oems) {
      rows.push({
        id: makeRuntimeId('f'),
        productName,
        oemName,
      })
    }
  }
  return parseSupplierProductFitDetails(rows)
}

function parseSupplierProfileContacts(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `c-${Date.now()}-${idx + 1}`,
        contactPerson: toText(data.contactPerson),
        contactTitle: toText(data.contactTitle),
        phone: toText(data.phone),
        mobile: toText(data.mobile),
        email: toText(data.email),
      }
    })
    .filter((item) => item.contactPerson || item.contactTitle || item.phone || item.mobile || item.email)
}

function parseSupplierProfileProducts(input) {
  const rawList = Array.isArray(input) ? input : []
  return rawList
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `p-${Date.now()}-${idx + 1}`,
        name: toText(data.name),
        model: toText(data.model),
        application: toText(data.application),
        material: toText(data.material),
        advantages: toText(data.advantages),
        appearance: toText(data.appearance),
        precision: toText(data.precision),
        scenarios: toText(data.scenarios),
        imageUrl: toText(data.imageUrl),
        parameters: toText(data.parameters),
      }
    })
    .filter((item) => item.name || item.model || item.application || item.material || item.advantages || item.appearance || item.precision || item.scenarios || item.parameters || item.imageUrl)
}

function parseSupplierProductFitDetails(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `f-${Date.now()}-${idx + 1}`,
        productName: toText(data.productName),
        oemName: toText(data.oemName),
      }
    })
    .filter((item) => item.productName || item.oemName)
}

function parseSupplierNewsItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `n-${Date.now()}-${idx + 1}`,
        title: toText(data.title),
        source: toText(data.source),
        publishDate: toText(data.publishDate),
        content: toText(data.content),
      }
    })
    .filter((item) => item.title || item.source || item.publishDate || item.content)
}

function parseSupplierCompanyTags(input) {
  return parseStringArray(input).slice(0, 24)
}

function normalizeSupplierProfileSource(input = '') {
  return String(input || '').trim().toLowerCase() === 'gas' ? 'gas' : 'gys'
}

function detectSupplierProfileSource(...inputs) {
  for (const input of inputs) {
    const text = toText(input)
    if (!text) continue
    if (normalizeSupplierProfileSource(text) === 'gas') return 'gas'
    const host = safeHostFromUrl(text)
    if (host.includes('gasgoo.com')) return 'gas'
  }
  return 'gys'
}

function normalizeSupplierProfileView(input = '') {
  const value = String(input || '').trim().toLowerCase()
  if (value === 'gas') return 'gas'
  if (value === 'gys') return 'gys'
  return ''
}

function normalizeSupplierHomepageOnly(input = false) {
  if (input === true || input === 1) return true
  const value = String(input || '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

function normalizeSupplierAllowPlaywrightDetail(input = false) {
  if (input === true || input === 1) return true
  const value = String(input || '').trim().toLowerCase()
  return value === 'true' || value === '1' || value === 'yes' || value === 'on'
}

function parseSupplierBusinessInfo(input) {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const result = {}
  const businessFieldLabels = new Set([
    '人员规模', '研发人数', '年销售额', '体系认证', '公司网址', '配套客户', '直接配套客户', '间接配套客户',
    '直接出口经验', '年出口额', '出口市场', '出口国家', '主营产品', '主要产品',
  ])
  for (const [key, value] of Object.entries(data)) {
    const nextKey = cleanSupplierFieldText(key)
    if (!nextKey) continue
    if (Array.isArray(value)) {
      const normalizedArray = parseStringArray(value)
      if (normalizedArray.length === 0) continue
      result[nextKey] = normalizedArray
      continue
    }
    const nextValue = cleanSupplierFieldText(value)
    if (!nextValue) continue
    // Guard against parser noise like "实缴资本: 实缴资本"
    if (nextValue === nextKey) continue
    // Guard against shifted-cell noise like "人员规模: 年销售额"
    if (businessFieldLabels.has(nextValue) && nextValue !== nextKey) continue
    result[nextKey] = nextValue
  }
  return result
}

function sanitizeSupplierBusinessMetric(value = '', ownLabels = []) {
  const labels = Array.isArray(ownLabels) ? ownLabels : []
  const text = trimSupplierTextAtNextLabel(
    stripSupplierFieldLabel(value, labels),
    labels,
  )
  return cleanSupplierFieldText(text)
}

function parseSupplierCustomerItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `sc-${Date.now()}-${idx + 1}`,
        productName: cleanSupplierFieldText(data.productName),
        oemNames: parseStringArray(data.oemNames),
      }
    })
    .filter((item) => item.productName || item.oemNames.length > 0)
}

function parseSupplierProductCaseItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `pc-${Date.now()}-${idx + 1}`,
        productName: cleanSupplierFieldText(data.productName),
        vehicleModel: cleanSupplierFieldText(data.vehicleModel),
        customerName: cleanSupplierFieldText(data.customerName),
        description: cleanSupplierFieldText(data.description),
      }
    })
    .filter((item) => item.productName || item.vehicleModel || item.customerName || item.description)
}

function parseSupplierFinancingItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `fi-${Date.now()}-${idx + 1}`,
        financingDate: cleanSupplierFieldText(data.financingDate),
        round: cleanSupplierFieldText(data.round),
        amount: cleanSupplierFieldText(data.amount),
        investors: cleanSupplierFieldText(data.investors),
      }
    })
    .filter((item) => item.financingDate || item.round || item.amount || item.investors)
}

function parseSupplierSoftwareCopyrightItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `sw-${Date.now()}-${idx + 1}`,
        softwareName: cleanSupplierFieldText(data.softwareName),
        version: cleanSupplierFieldText(data.version),
        releaseDate: cleanSupplierFieldText(data.releaseDate),
        softwareAlias: cleanSupplierFieldText(data.softwareAlias),
        registrationNo: cleanSupplierFieldText(data.registrationNo),
        approvalDate: cleanSupplierFieldText(data.approvalDate),
      }
    })
    .filter((item) => Object.values(item).some((value, index) => index > 0 && value))
}

function parseGasgooRowValueByAliases(row = {}, aliases = []) {
  const source = row && typeof row === 'object' ? row : {}
  for (const alias of aliases || []) {
    const aliasText = cleanSupplierFieldText(alias)
    if (!aliasText) continue
    const hit = Object.keys(source).find((key) => cleanSupplierFieldText(key) === aliasText)
    if (!hit) continue
    const value = cleanSupplierFieldText(source[hit])
    if (value) return value
  }
  return ''
}

function looksLikeDateText(text = '') {
  return /\d{4}[-/.年]\d{1,2}([-/.\s月]\d{1,2})?/.test(cleanSupplierFieldText(text))
}

function looksLikeVersionText(text = '') {
  return /(?:^|\b)(v?\d+(?:\.\d+){0,3}|[A-Z]\d+(?:\.\d+){0,3})\b/i.test(cleanSupplierFieldText(text))
}

function parseSupplierPatentItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `pt-${Date.now()}-${idx + 1}`,
        patentType: cleanSupplierFieldText(data.patentType),
        publicationNo: cleanSupplierFieldText(data.publicationNo),
        publicationDate: cleanSupplierFieldText(data.publicationDate),
        title: cleanSupplierFieldText(data.title),
        applicationNo: cleanSupplierFieldText(data.applicationNo),
        applicationDate: cleanSupplierFieldText(data.applicationDate),
        inventors: cleanSupplierFieldText(data.inventors),
        assignee: cleanSupplierFieldText(data.assignee),
        agency: cleanSupplierFieldText(data.agency),
        agent: cleanSupplierFieldText(data.agent),
        legalStatus: cleanSupplierFieldText(data.legalStatus),
        summary: cleanSupplierFieldText(data.summary),
      }
    })
    .filter((item) => Object.values(item).some((value, index) => index > 0 && value))
}

function parseSupplierAdminLicenseItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `al-${Date.now()}-${idx + 1}`,
        documentNo: cleanSupplierFieldText(data.documentNo),
        authority: cleanSupplierFieldText(data.authority),
        decisionDate: cleanSupplierFieldText(data.decisionDate),
        content: cleanSupplierFieldText(data.content),
        status: cleanSupplierFieldText(data.status),
        validUntil: cleanSupplierFieldText(data.validUntil),
        category: cleanSupplierFieldText(data.category),
        region: cleanSupplierFieldText(data.region),
      }
    })
    .filter((item) => Object.values(item).some((value, index) => index > 0 && value))
}

function parseSupplierAdminLicenseGsItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `algs-${Date.now()}-${idx + 1}`,
        permitNo: cleanSupplierFieldText(data.permitNo),
        permitName: cleanSupplierFieldText(data.permitName),
        validFrom: cleanSupplierFieldText(data.validFrom),
        validTo: cleanSupplierFieldText(data.validTo),
        authority: cleanSupplierFieldText(data.authority),
        content: cleanSupplierFieldText(data.content),
      }
    })
    .filter((item) => Object.values(item).some((value, index) => index > 0 && value))
}

function parseSupplierTradeCreditItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `tc-${Date.now()}-${idx + 1}`,
        customsOffice: cleanSupplierFieldText(data.customsOffice),
        businessType: cleanSupplierFieldText(data.businessType),
        registrationDate: cleanSupplierFieldText(data.registrationDate),
        content: cleanSupplierFieldText(data.content),
        registrationCode: cleanSupplierFieldText(data.registrationCode),
        administrativeRegion: cleanSupplierFieldText(data.administrativeRegion),
        economicRegion: cleanSupplierFieldText(data.economicRegion),
        creditLevel: cleanSupplierFieldText(data.creditLevel),
        annualReportStatus: cleanSupplierFieldText(data.annualReportStatus),
        validityPeriod: cleanSupplierFieldText(data.validityPeriod),
      }
    })
    .filter((item) => Object.values(item).some((value, index) => index > 0 && value))
}

function parseSupplierEquipmentItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `eq-${Date.now()}-${idx + 1}`,
        equipmentName: cleanSupplierFieldText(data.equipmentName || data.name || data.value),
      }
    })
    .filter((item) => item.equipmentName)
}

function parseSupplierCourtNoticeItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `cn-${Date.now()}-${idx + 1}`,
        caseNo: cleanSupplierFieldText(data.caseNo),
        hearingDate: cleanSupplierFieldText(data.hearingDate),
        cause: cleanSupplierFieldText(data.cause),
        plaintiff: cleanSupplierFieldText(data.plaintiff),
        defendant: cleanSupplierFieldText(data.defendant),
        court: cleanSupplierFieldText(data.court),
        tribunal: cleanSupplierFieldText(data.tribunal),
        region: cleanSupplierFieldText(data.region),
      }
    })
    .filter((item) => Object.values(item).some((value, index) => index > 0 && value))
}

function parseSupplierProductionBaseItems(input) {
  const list = Array.isArray(input) ? input : []
  return list
    .map((item, idx) => {
      const data = item && typeof item === 'object' ? item : {}
      return {
        id: toText(data.id) || `pb-${Date.now()}-${idx + 1}`,
        baseName: cleanSupplierFieldText(data.baseName),
        region: cleanSupplierFieldText(data.region),
        postalCode: cleanSupplierFieldText(data.postalCode),
        address: cleanSupplierFieldText(data.address),
        phone: cleanSupplierFieldText(data.phone),
        mainProducts: cleanSupplierFieldText(data.mainProducts),
      }
    })
    .filter((item) => Object.values(item).some((value, index) => index > 0 && value))
}

function extractSupplierNewsItemsFromHtml(html = '', baseUrl = '') {
  const source = String(html || '')
  if (!source) return []
  const items = []
  for (const matched of source.matchAll(/<div[^>]*class=["'][^"']*\btwhunpai\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div class="clear"><\/div>\s*<\/div>/gi)) {
    const block = String(matched?.[0] || '')
    const href = toText(textByRegex(block, /<div[^>]*class=["'][^"']*\bhunpai_nr\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["']/i))
    const title = cleanSupplierFieldText(
      textByRegex(block, /<div[^>]*class=["'][^"']*\bhunpai_nr\b[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i),
    )
    const content = cleanSupplierFieldText(textByRegex(block, /<p>([\s\S]*?)<\/p>/i))
    const sourceText = cleanSupplierFieldText(textByRegex(block, /<i>\s*来源[:：]?\s*([^<]+)<\/i>/i))
    const publishDate = cleanSupplierFieldText(textByRegex(block, /<i>\s*发布时间[:：]?\s*([^<]+)<\/i>/i))
    if (!title && !content) continue
    let normalizedSource = sourceText
    if (href) {
      try {
        normalizedSource = new URL(href, baseUrl).toString()
      } catch {
        normalizedSource = sourceText || href
      }
    }
    items.push({
      id: makeRuntimeId('n'),
      title,
      source: normalizedSource || sourceText,
      publishDate,
      content,
    })
  }
  return parseSupplierNewsItems(items)
}

function extractSupplierOemCandidatesFromText(text = '') {
  const source = cleanSupplierFieldText(text)
  if (!source) return []
  const segments = []
  for (const matched of source.matchAll(/(?:配套情况|配套说明)[:：]?\s*([^]{0,1200}?)(?:(?:出口情况|出口国家|出口|认证体系|认证说明|认证|企业证书|公司新闻|新闻发布)[:：]|$)/gi)) {
    segments.push(cleanSupplierFieldText(matched?.[1] || ''))
  }
  if (segments.length === 0) segments.push(source)
  const tokens = segments
    .join('，')
    .split(/[，,；;、\/\s]+/g)
    .map((item) => cleanSupplierFieldText(item))
    .filter(Boolean)
  const allowPattern = /(集团|汽车|奔驰|宝马|大众|奥迪|特斯拉|蔚来|小鹏|威马|问界|智界|小米|智己|深蓝|飞凡|极氪|岚图|银河|起亚|戴姆勒|福田|客车|通用五菱|宝骏|名爵|荣威|福特|现代|丰田|本田|日产|比亚迪|赛力斯|沃尔沃|雪佛兰|别克|广汽埃安|零跑|厦门金旅|厦门金龙|苏州金龙|申沃|海马|中车时代|广通)/i
  const rejectPattern = /(零部件|高技术|高新技术|产品|方案|系统|平台|项目|材料|工艺|设备|服务|技术|研发|再制造|等多种|等)/i
  return [...new Set(tokens
    .map((item) => item.replace(/^(?:配套说明|配套情况)[:：]?/g, '').replace(/^(?:配套)/g, '').replace(/等$/g, '').trim())
    .filter((item) => item.length >= 2 && item.length <= 24 && allowPattern.test(item))
    .filter((item) => !rejectPattern.test(item)))].slice(0, 80)
}

function normalizeOemMatchKey(name = '') {
  return cleanSupplierFieldText(name)
    .toLowerCase()
    .replace(/[（）()\-\s·,，.。/]/g, '')
    .replace(/(汽车集团|汽车|集团|股份有限公司|有限公司|有限责任公司|股份|公司)$/g, '')
}

function resolveGasOemMatchName(rawName = '', gasOemIndex = []) {
  const cleaned = cleanSupplierFieldText(rawName)
  if (!cleaned) return ''
  const normalized = normalizeOemMatchKey(cleaned)
  if (!normalized) return cleaned
  const exact = gasOemIndex.find((item) => item.norm === normalized)
  if (exact) return exact.name
  const contains = gasOemIndex.find((item) => item.norm.includes(normalized) || normalized.includes(item.norm))
  if (contains) return contains.name
  return cleaned
}

function extractSupplierCountryCandidatesFromText(text = '') {
  const source = cleanSupplierFieldText(text)
  if (!source) return []
  const candidates = []
  const explicit = cleanSupplierFieldText(
    textByRegex(source, /(?:出口国家|出口地区|出口市场)[:：]?\s*([^]{0,240}?)(?:(?:出口说明|认证体系|认证说明|认证|企业证书|公司新闻|新闻发布)[:：]|$)/i),
  )
  const baseText = explicit || source
  const countryPattern = /(中国香港|中国澳门|中国台湾|美国|德国|韩国|法国|日本|英国|意大利|西班牙|葡萄牙|荷兰|比利时|瑞典|挪威|芬兰|丹麦|瑞士|奥地利|波兰|捷克|匈牙利|罗马尼亚|斯洛伐克|斯洛文尼亚|克罗地亚|塞尔维亚|俄罗斯|乌克兰|白俄罗斯|加拿大|墨西哥|巴西|阿根廷|智利|秘鲁|哥伦比亚|南非|埃及|摩洛哥|阿尔及利亚|尼日利亚|肯尼亚|沙特|阿联酋|土耳其|以色列|印度|巴基斯坦|泰国|越南|马来西亚|新加坡|印度尼西亚|菲律宾|澳大利亚|新西兰|欧洲|东南亚|南美洲|亚洲)/g
  for (const matched of baseText.matchAll(countryPattern)) {
    candidates.push(cleanSupplierFieldText(matched[0]))
  }
  return [...new Set(candidates)].slice(0, 50)
}

function extractSupplierCertificationCandidatesFromText(text = '') {
  const source = cleanSupplierFieldText(text)
  if (!source) return []
  const candidates = []
  const explicit = cleanSupplierFieldText(
    textByRegex(source, /(?:认证体系|认证说明|企业证书|质量体系)[:：]?\s*([^]{0,360}?)(?:(?:公司新闻|新闻发布|联系方式|联系人|电话|地址)[:：]|$)/i),
  )
  const baseText = explicit || source
  const certPattern = /(IATF\s*16949|ISO\s*9001|ISO\s*14000|ISO\s*14001|ISO\s*45001|ISO\s*27001|ISO\s*50001|ISO\s*9000系列|16949系列|VDA认证|OHSAS\s*18001|高新技术企业)/gi
  for (const matched of baseText.matchAll(certPattern)) {
    candidates.push(cleanSupplierFieldText(matched[0]).replace(/\s+/g, ''))
  }
  return [...new Set(candidates)].slice(0, 30)
}

function buildSessionTitleByPrompt(prompt = '') {
  const cleaned = String(prompt || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return '新会话'
  const matched = cleaned.match(/映射业务实体[:：]?\s*([^\s，,。]+)/)
  const entity = matched?.[1] ? `${matched[1]}采集` : ''
  const urlMatched = cleaned.match(/https?:\/\/([^/\s]+)/i)
  const domain = urlMatched?.[1] || ''
  const head = cleaned.slice(0, 20)
  return (entity && domain)
    ? `${entity} - ${domain}`
    : (entity || head || '新会话')
}

function parseTagMap(selectedTags = []) {
  const data = Array.isArray(selectedTags) ? selectedTags : []
  const model = data.find((item) => String(item.key || '').startsWith('model:'))?.label || ''
  const skill = data.find((item) => String(item.key || '').startsWith('skill:'))?.label || ''
  const task = data.find((item) => String(item.key || '').startsWith('task:'))?.label || ''
  return { model, skill, task, raw: data }
}

function shouldAutoTriggerCrawl(content = '', selectedTags = []) {
  const text = toText(content)
  const hasUrl = /https?:\/\/[^\s,，]+/i.test(text)
  if (!hasUrl) return false
  const data = Array.isArray(selectedTags) ? selectedTags : []
  const selectedTask = data.some((item) => String(item.key || '').startsWith('task:') && /互联网数据获取/.test(String(item.label || '')))
  const selectedSkill = data.some((item) => String(item.key || '').startsWith('skill:') && supplierSkillOptions.includes(String(item.label || '')))
  const looksLikeCrawl = /爬取|采集|crawl|抓取|抓这个|直接执行/i.test(text)
  return selectedTask || selectedSkill || looksLikeCrawl
}

async function executePromptCrawl({ prompt = '', selectedTags = [], sessionId = null }) {
  const parsed = parsePromptInstruction(prompt)
  if (!parsed.urls || parsed.urls.length === 0) {
    throw new Error('未在输入内容中识别到可爬取URL')
  }
  const tagMap = parseTagMap(selectedTags)
  const pickedModel = tagMap.model
  const pickedSkill = tagMap.skill
  const runLogs = []
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  runLogs.push(`${nowText()} | 收到请求：URL ${parsed.urls.length} 个，爬取类型 ${parsed.crawlType}`)
  const allRows = []
  for (const url of parsed.urls) {
    runLogs.push(`${nowText()} | 开始抓取：${url}`)
    const rows = await crawlAndCollectRows(url, parsed.crawlType, {
      businessEntity: parsed.businessEntity,
      model: pickedModel,
      skill: pickedSkill,
    })
    allRows.push(...rows)
    runLogs.push(`${nowText()} | 完成抓取：${url}，获得 ${rows.length} 条`)
  }

  const fileName = `crawl_result_${Date.now()}.csv`
  const absPath = path.join(crawlExportDir, fileName)
  const header = [
    'crawl_type',
    'business_entity',
    'model',
    'skill',
    'source_url',
    'page_url',
    'page_title',
    'text_sample',
    'status',
    'error_message',
    'level1_url',
    'level2_url',
    'level3_url',
    'supplier_url',
    'level1_title',
    'level2_title',
    'level3_title',
    'supply_chain_info',
  ]
  const lines = [
    header.join(','),
    ...allRows.map((row) =>
      [
        row.crawlType,
        row.businessEntity,
        row.model,
        row.skill,
        row.sourceUrl,
        row.pageUrl,
        row.pageTitle,
        row.textSample,
        row.status,
        row.errorMessage,
        row.level1Url || '',
        row.level2Url || '',
        row.level3Url || '',
        row.supplierUrl || '',
        row.level1Title || '',
        row.level2Title || '',
        row.level3Title || '',
        row.supplyChainInfo || '',
      ]
        .map(csvEscape)
        .join(','),
    ),
  ]
  await fs.writeFile(absPath, lines.join('\n'), 'utf-8')

  const level1Count = allRows.filter((item) => item.level1Url).length
  const level2Count = allRows.filter((item) => item.level2Url).length
  const level3Count = allRows.filter((item) => item.level3Url).length
  const supplierCount = allRows.filter((item) => item.supplierUrl).length
  runLogs.push(`${nowText()} | CSV 已生成：${fileName}（总计 ${allRows.length} 条）`)

  if (sessionId) {
    const sid = Number(sessionId)
    if (Number.isInteger(sid) && sid > 0) {
      await saveSessionMessage(sid, 'user', prompt, {
        type: 'question',
        selectedTags,
      })
      await saveSessionMessage(
        sid,
        'assistant',
        `已完成抓取并生成 CSV：${fileName}，共 ${allRows.length} 条`,
        {
          type: 'crawl_result',
          runLogs,
          result: {
            fileName,
            downloadUrl: `/api/crawl-exports/${encodeURIComponent(fileName)}`,
            totalRows: allRows.length,
            successRows: allRows.filter((item) => item.status === 'success').length,
            failedRows: allRows.filter((item) => item.status !== 'success').length,
          },
        },
      )
    }
  }

  return {
    fileName,
    filePath: absPath,
    downloadUrl: `/api/crawl-exports/${encodeURIComponent(fileName)}`,
    totalRows: allRows.length,
    successRows: allRows.filter((item) => item.status === 'success').length,
    failedRows: allRows.filter((item) => item.status !== 'success').length,
    level1Count,
    level2Count,
    level3Count,
    supplierCount,
    runLogs,
    preview: allRows.slice(0, 10),
  }
}

function parseUrlText(urlText = '') {
  const text = String(urlText || '').trim()
  if (!text) return []
  const parts = text
    .split(/[\n\r,，;；、]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
  const urls = []
  for (const part of parts) {
    const matched = part.match(/https?:\/\/[^\s]+/i)
    if (!matched) continue
    const raw = matched[0].replace(/[，。,]+$/g, '')
    try {
      urls.push(new URL(raw).toString())
    } catch {
      // ignore invalid url
    }
  }
  return [...new Set(urls)]
}

function normalizeSupplierTaskUrlKey(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    if (parsed.pathname.includes('category.php')) {
      parsed.searchParams.delete('page')
    }
    return parsed.toString()
  } catch {
    return ''
  }
}

function isSupplierListUrl(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    const host = parsed.hostname.toLowerCase()
    const pathname = parsed.pathname || '/'
    const hasQuery = Boolean(parsed.search)
    // 排除纯站点根路径，例如 https://www.chinaautosupplier.com/
    if (!hasQuery && (pathname === '/' || pathname === '')) return false
    if (host.includes('chinaautosupplier.com') && !hasQuery && pathname === '/') return false
    return true
  } catch {
    return false
  }
}

function parseInlineRedirectUrl(html, currentUrl) {
  const page = String(html || '')
  const scriptBlocks = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((item) => String(item[1] || ''))
  if (scriptBlocks.length === 0) return ''

  const redirectRegexes = [
    /(?:^|[;{]\s*)(?:window\.)?location\.href\s*=\s*["']([^"']+)["']/i,
    /(?:^|[;{]\s*)(?:window\.)?location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
    /(?:^|[;{]\s*)(?:window\.)?location\.assign\s*\(\s*["']([^"']+)["']\s*\)/i,
  ]

  for (const scriptContent of scriptBlocks) {
    const normalized = scriptContent.replace(/\s+/g, ' ').trim()
    for (const regex of redirectRegexes) {
      const matched = normalized.match(regex)
      if (!matched?.[1]) continue
      try {
        return new URL(matched[1], currentUrl).toString()
      } catch {
        // ignore invalid redirect url
      }
    }
  }
  return ''
}

function shouldFollowSupplierInlineRedirect(currentUrl = '', redirectUrl = '') {
  try {
    const current = new URL(currentUrl)
    const next = new URL(redirectUrl)
    if (current.host !== next.host) return false

    const currentPath = (current.pathname || '').toLowerCase()
    const nextPath = (next.pathname || '').toLowerCase()

    if (currentPath === nextPath) return true

    // 登录/验证页跳转到目标列表页，允许跟随
    if (/\/(?:member\/login|login|verify)\.php$/i.test(currentPath) && /(category|parts|search|index)\.php$/i.test(nextPath)) {
      return true
    }

    // 供应商抓取目标页通常是 category.php，避免误跟随页面里的 onclick 到 parts.php
    if (currentPath.includes('category.php') && !nextPath.includes('category.php')) return false

    // query 中保留核心筛选键才允许跳转
    const currentCid = current.searchParams.get('cid') || ''
    const currentPid = current.searchParams.get('pid') || ''
    const currentCatid = current.searchParams.get('catid') || ''
    const nextCid = next.searchParams.get('cid') || ''
    const nextPid = next.searchParams.get('pid') || ''
    const nextCatid = next.searchParams.get('catid') || ''
    if (currentCid && nextCid && currentCid !== nextCid) return false
    if (currentPid && nextPid && currentPid !== nextPid) return false
    if (currentCatid && nextCatid && currentCatid !== nextCatid) return false
    return true
  } catch {
    return false
  }
}

function buildSupplierUrlCandidates(urlText = '') {
  const candidates = new Set()
  try {
    const parsed = new URL(String(urlText || '').trim())
    candidates.add(parsed.toString())
    const host = parsed.hostname.toLowerCase()
    if (host.includes('qcgys.com')) {
      const c = new URL(parsed.toString())
      c.hostname = 'www.chinaautosupplier.com'
      candidates.add(c.toString())
    } else if (host.includes('chinaautosupplier.com')) {
      const c = new URL(parsed.toString())
      c.hostname = 'www.qcgys.com'
      candidates.add(c.toString())
    }
  } catch {
    // ignore
  }
  return [...candidates]
}

function buildSupplierDetailUrlCandidates(urlText = '') {
  const candidates = new Set()
  try {
    const parsed = new URL(String(urlText || '').trim())
    candidates.add(parsed.toString())
    const host = parsed.hostname.toLowerCase()
    if (host.includes('qcgys.com')) {
      const c = new URL(parsed.toString())
      c.hostname = 'www.chinaautosupplier.com'
      candidates.add(c.toString())
    } else if (host.includes('chinaautosupplier.com')) {
      const c = new URL(parsed.toString())
      c.hostname = 'www.qcgys.com'
      candidates.add(c.toString())
    }
  } catch {
    // ignore invalid detail url
  }
  return [...candidates]
}

function isSupplierDetailEntryUrl(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    const host = String(parsed.hostname || '').toLowerCase()
    const pathname = String(parsed.pathname || '').toLowerCase()
    if (host.includes('gasgoo.com')) {
      // Gasgoo 分类/分页入口，属于列表页，不是企业详情页
      if (/^\/supplier\/(?:oem|index)\.html$/.test(pathname)) return false
      if (/^\/supplier\/c-\d+(?:-\d+)?\.html$/.test(pathname)) return false
    }
    if (/^[^.]+\.cn\.gasgoo\.com$/.test(host) && (pathname === '/' || pathname === '')) return true
    if (pathname.includes('company.php')) return true
    if (parsed.searchParams.get('mid')) return true
    if (/(supplier|detail|company)/.test(pathname) && !pathname.includes('category.php')) return true
    return false
  } catch {
    return false
  }
}

function isWebAccessSkill(skill = '') {
  return /(^|[^a-z])web-access([^a-z]|$)/i.test(toText(skill))
}

function isGasgooSupplierUrl(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    const host = String(parsed.hostname || '').toLowerCase()
    const pathname = String(parsed.pathname || '').toLowerCase()
    if (/^[^.]+\.cn\.gasgoo\.com$/.test(host) || host === 'cn.gasgoo.com') return true
    if (host === 'i.gasgoo.com' && /^\/supplier\/\d+\/?$/.test(pathname)) return true
    if (host.endsWith('.gasgoo.com') && /^\/supplier\/\d+\/?$/.test(pathname)) return true
    return false
  } catch {
    return false
  }
}

const supplierDetailSubpageKeywords = [
  'contact', 'linkman', 'lx', 'tel', 'phone', 'mail',
  'product', 'goods',
  'fit', 'oem', 'export',
  'cert', 'certificate', 'iso', 'iatf',
  'news', 'article', 'notice',
  'intro', 'about', 'company',
  '联系', '联系方式', '联系我们',
  '产品', '配套', '出口',
  '证书', '认证',
  '新闻', '资讯',
  '简介', '介绍',
]

const supplierDetailTabLabelMap = new Map([
  ['首页', 'home'],
  ['公司简介', 'intro'],
  ['重点产品', 'goods'],
  ['配套情况', 'fit'],
  ['出口情况', 'export'],
  ['企业证书', 'cert'],
  ['公司视频', 'video'],
  ['公司新闻', 'news'],
  ['联系我们', 'contact'],
])

function classifySupplierDetailTab(label = '', urlText = '') {
  const cleanLabel = cleanSupplierFieldText(label)
  if (supplierDetailTabLabelMap.has(cleanLabel)) {
    return supplierDetailTabLabelMap.get(cleanLabel)
  }
  try {
    const pathname = new URL(String(urlText || '').trim()).pathname.toLowerCase()
    if (/\/company_intro\.php$/i.test(pathname)) return 'intro'
    if (/\/company_goods\.php$/i.test(pathname)) return 'goods'
    if (/\/company_goods_parts\.php$/i.test(pathname)) return 'fit'
    if (/\/company_goods_export\.php$/i.test(pathname)) return 'export'
    if (/\/company_list\.php$/i.test(pathname)) return 'cert'
    if (/\/company_news\.php$/i.test(pathname)) return 'news'
    if (/\/company_contact\.php$/i.test(pathname)) return 'contact'
    if (/\/company_video\.php$/i.test(pathname)) return 'video'
    if (/\/company\.php$/i.test(pathname)) return 'home'
  } catch {
    // ignore invalid url
  }
  return ''
}

function buildSupplierDetailTabUrls(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    const mid = toText(parsed.searchParams.get('mid'))
    if (!mid) return []
    const routes = [
      'company_intro.php',
      'company_goods.php',
      'company_goods_parts.php',
      'company_goods_export.php',
      'company_list.php',
      'company_video.php',
      'company_news.php',
      'company_contact.php',
    ]
    return routes.map((route) => {
      const next = new URL(parsed.toString())
      next.pathname = `/${route}`
      next.search = ''
      next.searchParams.set('mid', mid)
      if (route === 'company_news.php') next.searchParams.set('catid', '4')
      return next.toString()
    })
  } catch {
    return []
  }
}

function isSupplierDetailDomReady(html = '', plain = '') {
  const htmlText = String(html || '')
  const bodyText = cleanSupplierFieldText(String(plain || ''))
  if (htmlText.length >= 9000) return true
  if (/(公司简介|重点产品|配套情况|出口情况|企业证书|公司视频|公司新闻|联系我们)/.test(bodyText)) return true
  if (/(业务信息|工商信息|知识产权|法律诉讼|行政许可)/.test(bodyText)) return true
  if (/company_(?:intro|goods|goods_parts|goods_export|list|video|news|contact)\.php\?mid=/i.test(htmlText)) return true
  return false
}

function extractKeyValuePairsFromTableHtml(html = '') {
  const source = String(html || '')
  const pairs = {}
  for (const row of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cellNodes = [...String(row?.[1] || '').matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    if (cellNodes.length < 2) continue
    const cells = cellNodes.map((cell) => {
      const tag = String(cell?.[1] || '').toLowerCase()
      const attrs = String(cell?.[2] || '')
      const text = cleanSupplierHtmlBlockText(cell?.[3] || '')
      const classText = toText((attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] || '')).toLowerCase()
      const isLabel = tag === 'th' || /\btdbg\b/.test(classText)
      return { text, isLabel }
    })

    // Prefer explicit label cells (<th> or class="tdbg"), which is the common GAS detail table pattern.
    for (let idx = 0; idx + 1 < cells.length; idx += 1) {
      if (!cells[idx].isLabel) continue
      const key = cleanSupplierFieldText(cells[idx].text || '')
      const value = cleanSupplierFieldText(cells[idx + 1].text || '')
      if (!key || !value) continue
      if (!pairs[key] || value.length > pairs[key].length) {
        pairs[key] = value
      }
    }

    // Fallback: generic pair-by-position for tables without explicit label class.
    for (let idx = 0; idx + 1 < cells.length; idx += 2) {
      const key = cleanSupplierFieldText(cells[idx].text || '')
      const value = cleanSupplierFieldText(cells[idx + 1].text || '')
      if (!key || !value) continue
      if (!pairs[key] || value.length > pairs[key].length) {
        pairs[key] = value
      }
    }
  }
  return pairs
}

function extractGasgooSectionFromPlain(plain = '', startLabel = '', endLabels = []) {
  const body = cleanSupplierFieldText(String(plain || ''))
  const start = cleanSupplierFieldText(startLabel)
  const ends = Array.isArray(endLabels) ? endLabels.map((item) => cleanSupplierFieldText(item)).filter(Boolean) : []
  if (!body || !start) return ''
  const startIdx = body.indexOf(start)
  if (startIdx < 0) return ''
  const sliceStart = startIdx + start.length
  let sliceEnd = body.length
  for (const end of ends) {
    const idx = body.indexOf(end, sliceStart)
    if (idx > sliceStart && idx < sliceEnd) sliceEnd = idx
  }
  return cleanSupplierFieldText(body.slice(sliceStart, sliceEnd))
}

function extractGasgooCompanyTagsFromHtml(html = '') {
  const tags = []
  for (const matched of String(html || '').matchAll(/<div[^>]*class=["'][^"']*\bidentification\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const block = String(matched?.[1] || '')
    for (const span of block.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)) {
      const text = cleanSupplierFieldText(span?.[1] || '')
      if (text) tags.push(text)
    }
  }
  return parseSupplierCompanyTags(tags)
}

function extractSupplierSpanLabeledValue(html = '', labels = [], maxLen = 200) {
  const ownLabels = Array.isArray(labels) ? labels.map((item) => cleanSupplierFieldText(item)).filter(Boolean) : []
  if (!ownLabels.length) return ''
  for (const matched of String(html || '').matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)) {
    const text = cleanSupplierHtmlBlockText(matched?.[1] || '')
    if (!text) continue
    for (const label of ownLabels) {
      const pattern = new RegExp(`^${escapeSupplierRegexText(label)}\\s*[:：]\\s*([\\s\\S]{1,${Math.max(24, maxLen)}})$`, 'i')
      const picked = cleanSupplierFieldText(text.match(pattern)?.[1] || '')
      if (picked) return picked
    }
  }
  return ''
}

function extractGasgooTableRowsAfterTitle(html = '', title = '') {
  const source = String(html || '')
  const label = escapeSupplierRegexText(title)
  if (!source || !label) return []
  const pattern = new RegExp(
    `<div[^>]*class=["'][^"']*dtitle[^"']*["'][^>]*>[\\s\\S]*?${label}[\\s\\S]*?<\\/div>[\\s\\S]*?<table[^>]*>[\\s\\S]*?<tbody[^>]*>([\\s\\S]*?)<\\/tbody>[\\s\\S]*?<\\/table>`,
    'i',
  )
  const body = source.match(pattern)?.[1] || ''
  if (!body) return []
  const rows = []
  const rawRows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  if (rawRows.length === 0) return rows
  const headerCells = [...String(rawRows[0]?.[1] || '').matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map((cell) => cleanSupplierHtmlBlockText(cell?.[1] || ''))
    .filter(Boolean)
  if (headerCells.length === 0) return rows
  for (let idx = 1; idx < rawRows.length; idx += 1) {
    const cells = [...String(rawRows[idx]?.[1] || '').matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map((cell) => cleanSupplierHtmlBlockText(cell?.[1] || ''))
    if (cells.length === 0) continue
    const row = {}
    let valueOffset = 0
    const hasSerialHeader = /^(序号|排序)$/.test(cleanSupplierFieldText(headerCells[0] || ''))
    const hasLeadingSerialCell = /^(\d+|[-—])$/.test(cleanSupplierFieldText(cells[0] || ''))
    // 仅在“行数据比表头多 1 列且首列是序号值”时偏移，避免把正常列整体错位。
    if (!hasSerialHeader && hasLeadingSerialCell && cells.length === headerCells.length + 1) {
      valueOffset = 1
    }
    const maxCols = Math.min(headerCells.length, cells.length - valueOffset)
    for (let col = 0; col < maxCols; col += 1) {
      const header = headerCells[col]
      const value = cells[col + valueOffset]
      if (!header) continue
      row[header] = value
    }
    if (Object.keys(row).length > 0) rows.push(row)
  }
  return rows
}

function extractGasgooKeyValueSectionByTitle(html = '', title = '') {
  const source = String(html || '')
  const label = escapeSupplierRegexText(title)
  if (!source || !label) return {}
  const pattern = new RegExp(
    `<div[^>]*class=["'][^"']*dtitle[^"']*["'][^>]*>[\\s\\S]*?${label}[\\s\\S]*?<\\/div>[\\s\\S]*?<table[^>]*>[\\s\\S]*?<tbody[^>]*>([\\s\\S]*?)<\\/tbody>[\\s\\S]*?<\\/table>`,
    'i',
  )
  const body = source.match(pattern)?.[1] || ''
  if (!body) return {}
  const pairs = {}
  for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cellNodes = [...String(row?.[1] || '').matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    if (cellNodes.length < 2) continue
    const cells = cellNodes.map((cell) => {
      const tag = String(cell?.[1] || '').toLowerCase()
      const attrs = String(cell?.[2] || '')
      const text = cleanSupplierHtmlBlockText(cell?.[3] || '')
      const classText = toText((attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] || '')).toLowerCase()
      const isLabel = tag === 'th' || /\btdbg\b/.test(classText)
      return { text, isLabel }
    })

    for (let idx = 0; idx + 1 < cells.length; idx += 1) {
      if (!cells[idx].isLabel) continue
      const key = cleanSupplierFieldText(cells[idx].text || '')
      const value = cleanSupplierFieldText(cells[idx + 1].text || '')
      if (!key || !value || key === value) continue
      if (!pairs[key] || value.length > pairs[key].length) {
        pairs[key] = value
      }
    }

    for (let idx = 0; idx + 1 < cells.length; idx += 2) {
      const key = cleanSupplierFieldText(cells[idx].text || '')
      const value = cleanSupplierFieldText(cells[idx + 1].text || '')
      if (!key || !value || key === value) continue
      if (!pairs[key] || value.length > pairs[key].length) {
        pairs[key] = value
      }
    }
  }
  return parseSupplierBusinessInfo(pairs)
}

function parseGasgooCustomerItems(text = '') {
  const source = cleanSupplierFieldText(String(text || '')
    .replace(/直接配套[:：]?/g, '')
    .replace(/间接配套[:：]?/g, ''))
  if (!source) return []
  const items = []
  for (const matched of source.matchAll(/([^:：；;]{2,40})[:：]\s*([\s\S]*?)(?=(?:[^:：；;]{2,40}[:：])|$)/g)) {
    const productName = cleanSupplierFieldText(matched?.[1] || '')
    const oemNames = parseStringArray(
      cleanSupplierFieldText(matched?.[2] || '')
        .split(/[，,；;、]/g)
        .map((item) => cleanSupplierFieldText(item)),
    )
    if (!productName && oemNames.length === 0) continue
    items.push({
      id: makeRuntimeId('sc'),
      productName,
      oemNames,
    })
  }
  if (items.length === 0) {
    const oemNames = parseStringArray(
      source
        .split(/[，,；;、\/\s]+/g)
        .map((item) => cleanSupplierFieldText(item)),
    ).filter((item) => item.length >= 2 && item.length <= 40)
      .filter((item) => /(汽车|集团|奔驰|宝马|大众|奥迪|特斯拉|蔚来|小鹏|本田|丰田|日产|福特|现代|比亚迪|沃尔沃|别克|雪佛兰|零跑|广汽|上汽|一汽|东风|长安|奇瑞|吉利)/i.test(item))
      .filter((item) => !/(零部件|高技术|产品|方案|系统|平台|项目|材料|工艺|设备|服务|技术|研发|再制造|等多种|等)/i.test(item))
    if (oemNames.length > 0) {
      items.push({
        id: makeRuntimeId('sc'),
        productName: '',
        oemNames,
      })
    }
  }
  return parseSupplierCustomerItems(items)
}

function parseGasgooFinancingItems(rows = []) {
  return parseSupplierFinancingItems(rows.map((row) => ({
    id: makeRuntimeId('fi'),
    financingDate: row['融资时间'] || '',
    round: row['融资轮次'] || '',
    amount: row['融资金额'] || '',
    investors: row['投资方'] || '',
  })))
}

function parseGasgooSoftwareCopyrightItems(rows = []) {
  return parseSupplierSoftwareCopyrightItems(rows.map((row) => {
    let softwareName = parseGasgooRowValueByAliases(row, ['软件名称', '软件全称', '名称'])
    let version = parseGasgooRowValueByAliases(row, ['版本号', '版本', '软件版本', '软件版本号'])
    let releaseDate = parseGasgooRowValueByAliases(row, ['发布日期', '软件发布日期', '首次发表日期', '开发完成日期'])
    const softwareAlias = parseGasgooRowValueByAliases(row, ['软件简称', '简称'])
    const registrationNo = parseGasgooRowValueByAliases(row, ['登记号', '登记编号', '登记号/登记批准号'])
    const approvalDate = parseGasgooRowValueByAliases(row, ['登记批准日期', '批准日期', '登记日期', '登记批准时间'])
    // 部分站点表头错位，尝试自动纠正“版本号/发布日期”互串。
    if (looksLikeDateText(version) && !looksLikeDateText(releaseDate) && looksLikeVersionText(releaseDate)) {
      const old = version
      version = releaseDate
      releaseDate = old
    }
    if (!softwareName) {
      softwareName = parseGasgooRowValueByAliases(row, ['软件名称（全称）', '软件名称(全称)'])
    }
    return {
      id: makeRuntimeId('sw'),
      softwareName,
      version,
      releaseDate,
      softwareAlias,
      registrationNo,
      approvalDate,
    }
  }))
}

function parseGasgooPatentItems(rows = []) {
  return parseSupplierPatentItems(rows.map((row) => ({
    id: makeRuntimeId('pt'),
    patentType: parseGasgooRowValueByAliases(row, ['专利类型', '类型']),
    publicationNo: parseGasgooRowValueByAliases(row, ['公开（公告）号', '公开公告号', '公告号', '公开号']),
    publicationDate: parseGasgooRowValueByAliases(row, ['公开（公告）日期', '公开公告日期', '公告日期', '公开日期']),
    title: parseGasgooRowValueByAliases(row, ['名称', '专利名称']),
  })))
}

function parseGasgooAdminLicenseItems(rows = []) {
  return parseSupplierAdminLicenseItems(rows.map((row) => ({
    id: makeRuntimeId('al'),
    documentNo: parseGasgooRowValueByAliases(row, ['决定文书号', '许可文件编号', '文书编号', '文件编号']),
    authority: parseGasgooRowValueByAliases(row, ['许可机关', '决定机关', '机关']),
    decisionDate: parseGasgooRowValueByAliases(row, ['决定日期', '有效期自', '批准日期']),
    content: parseGasgooRowValueByAliases(row, ['内容', '许可内容']),
  })))
}

function parseGasgooAdminLicenseGsItems(rows = []) {
  return parseSupplierAdminLicenseGsItems(rows.map((row) => ({
    id: makeRuntimeId('algs'),
    permitNo: parseGasgooRowValueByAliases(row, ['许可文件编号', '文件编号', '许可证编号']),
    permitName: parseGasgooRowValueByAliases(row, ['许可文件名称', '许可文件名', '许可名称', '文件名称']),
    validFrom: parseGasgooRowValueByAliases(row, ['有效期自', '有效期起', '起始日期', '开始日期']),
    validTo: parseGasgooRowValueByAliases(row, ['有效期至', '有效期止', '截止日期', '结束日期']),
    authority: parseGasgooRowValueByAliases(row, ['许可机关', '决定机关', '机关']),
    content: parseGasgooRowValueByAliases(row, ['许可内容', '内容']),
  })))
}

function parseGasgooTradeCreditItems(rows = []) {
  return parseSupplierTradeCreditItems(rows.map((row) => ({
    id: makeRuntimeId('tc'),
    customsOffice: row['注册海关'] || '',
    businessType: row['经营类别'] || '',
    registrationDate: row['注册日期'] || '',
  })))
}

function parseGasgooCourtNoticeItems(rows = []) {
  return parseSupplierCourtNoticeItems(rows.map((row) => ({
    id: makeRuntimeId('cn'),
    caseNo: parseGasgooRowValueByAliases(row, ['案号']),
    hearingDate: parseGasgooRowValueByAliases(row, ['开庭时间', '开庭日期']),
    cause: parseGasgooRowValueByAliases(row, ['案由']),
    plaintiff: parseGasgooRowValueByAliases(row, ['公告人/原告/上诉人/申请人', '原告', '上诉人', '申请人']),
    defendant: parseGasgooRowValueByAliases(row, ['被告人/被告/被上诉人/被申诉人', '被告', '被上诉人', '被申诉人']),
  })))
}

function parseGasgooProductionBaseItems(html = '') {
  const items = []
  for (const matched of String(html || '').matchAll(/class=["'][^"']*hiddenproduction[^"']*["'][^>]*data-value=["']([^"']+)["']/gi)) {
    const parts = decodeBasicHtmlEntities(matched?.[1] || '').split('|')
    items.push({
      id: makeRuntimeId('pb'),
      baseName: cleanSupplierFieldText(parts[0] || ''),
      region: cleanSupplierFieldText(parts[1] || ''),
      postalCode: cleanSupplierFieldText(parts[2] || ''),
      address: cleanSupplierFieldText(parts[3] || ''),
      phone: cleanSupplierFieldText(parts[4] || ''),
      mainProducts: cleanSupplierFieldText(parts[6] || ''),
    })
  }
  return parseSupplierProductionBaseItems(items)
}

function extractGasgooSupplierOverviewFromHtml(html = '', detailUrl = '') {
  const plain = decodeBasicHtmlEntities(stripHtml(String(html || ''))).replace(/\s+/g, ' ').trim()
  const title = extractTitle(html) || ''
  const tablePairs = extractKeyValuePairsFromTableHtml(html)
  const businessRows = extractGasgooTableRowsAfterTitle(html, '业务信息')
  const businessInfo = parseSupplierBusinessInfo({
    ...extractGasgooKeyValueSectionByTitle(html, '业务信息'),
    ...(businessRows[0] || {}),
  })
  const industrialRows = extractGasgooTableRowsAfterTitle(html, '工商信息')
  const industrialCommercialInfo = parseSupplierBusinessInfo({
    ...extractGasgooKeyValueSectionByTitle(html, '工商信息'),
    ...(industrialRows[0] || {}),
  })
  const financingItems = parseGasgooFinancingItems(extractGasgooTableRowsAfterTitle(html, '融资信息'))
  const softwareRows = extractGasgooTableRowsAfterTitle(html, '软件著作权')
  const softwareCopyrightItems = parseGasgooSoftwareCopyrightItems(
    softwareRows.length > 0 ? softwareRows : extractGasgooTableRowsAfterTitle(html, '软件著作权信息'),
  )
  const patentItems = parseGasgooPatentItems(extractGasgooTableRowsAfterTitle(html, '专利信息'))
  const adminLicenseItems = parseGasgooAdminLicenseItems(extractGasgooTableRowsAfterTitle(html, '行政许可【信用中国】'))
  const adminLicenseGsRows = extractGasgooTableRowsAfterTitle(html, '行政许可【工商局】')
  const adminLicenseGsItems = parseGasgooAdminLicenseGsItems(
    adminLicenseGsRows.length > 0
      ? adminLicenseGsRows
      : extractGasgooTableRowsAfterTitle(html, '行政许可（工商局）'),
  )
  const tradeCreditItems = parseGasgooTradeCreditItems(extractGasgooTableRowsAfterTitle(html, '进出口信用'))
  const courtNoticeItems = parseGasgooCourtNoticeItems(extractGasgooTableRowsAfterTitle(html, '开庭公告'))
  const productionBaseItems = parseGasgooProductionBaseItems(html)
  const companyTags = extractGasgooCompanyTagsFromHtml(html)
  const companyName = sanitizeSupplierCompanyName(
    textByRegex(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || textByRegex(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
    || title,
  )
  const companyIntro = extractGasgooSectionFromPlain(
    plain,
    '公司简介',
    ['业务信息', '联系我们', '工商信息', '生产基地', '企业员工'],
  )
  const mainProducts = cleanSupplierFieldText([
    tablePairs['主要产品'] || '',
    tablePairs['主营产品'] || '',
    tablePairs['冲压'] || '',
    tablePairs['铸造'] || '',
    tablePairs['热成形'] || '',
    tablePairs['非金属复合材料'] || '',
    tablePairs['焊接大总成'] || '',
  ].filter(Boolean).join('；'))
  const qualitySystem = cleanSupplierFieldText(
    tablePairs['体系认证']
    || tablePairs['认证体系']
    || extractGasgooSectionFromPlain(plain, '体系认证', ['公司网址', '直接配套客户', '间接配套客户']),
  )
  const contactAction = cleanSupplierFieldText([
    tablePairs['联系人'] || '',
    tablePairs['公司电话'] || '',
    tablePairs['邮箱'] || '',
    tablePairs['地址'] || '',
  ].filter(Boolean).join('；'))
  const directCustomers = cleanSupplierFieldText(
    businessInfo['直接配套客户']
    || tablePairs['直接配套客户']
    || textByRegex(plain, /直接配套客户[:：]?\s*([^]{0,240}?)(?:间接配套客户|体系认证|公司网址|主营产品|$)/i),
  )
  const indirectCustomers = cleanSupplierFieldText(
    businessInfo['间接配套客户']
    || tablePairs['间接配套客户']
    || textByRegex(plain, /间接配套客户[:：]?\s*([^]{0,240}?)(?:体系认证|公司网址|主营产品|$)/i),
  )
  const pairedCustomers = cleanSupplierFieldText(
    businessInfo['配套客户']
    || tablePairs['配套客户']
    || [directCustomers ? `直接配套：${directCustomers}` : '', indirectCustomers ? `间接配套：${indirectCustomers}` : ''].filter(Boolean).join('；'),
  )
  const exportCountriesText = cleanSupplierFieldText(
    businessInfo['出口市场']
    || businessInfo['出口国家']
    || tablePairs['出口市场']
    || tablePairs['出口国家']
    || textByRegex(plain, /(?:出口市场|出口国家)[:：]?\s*([^]{0,240}?)(?:主营产品|体系认证|公司网址|$)/i),
  )
  const directExportExp = cleanSupplierFieldText(
    businessInfo['直接出口经验']
    || tablePairs['直接出口经验']
    || textByRegex(plain, /直接出口经验[:：]?\s*([^]{0,120}?)(?:年出口额|出口市场|出口国家|$)/i),
  )
  const annualExportAmount = cleanSupplierFieldText(
    businessInfo['年出口额']
    || tablePairs['年出口额']
    || textByRegex(plain, /年出口额[:：]?\s*([^]{0,120}?)(?:出口市场|出口国家|主营产品|$)/i),
  )
  const businessInfoEmployeesScale = sanitizeSupplierBusinessMetric(
    businessInfo['人员规模'],
    ['人员规模', '员工人数'],
  )
  const businessInfoRdHeadcount = sanitizeSupplierBusinessMetric(
    businessInfo['研发人数'],
    ['研发人数'],
  )
  const businessInfoAnnualSales = sanitizeSupplierBusinessMetric(
    businessInfo['年销售额'],
    ['年销售额'],
  )
  const rdHeadcount = cleanSupplierFieldText(
    businessInfoRdHeadcount
    || tablePairs['研发人数']
    || textByRegex(plain, /研发人数[:：]?\s*([^]{0,120}?)(?:年销售额|人员规模|体系认证|$)/i),
  )
  const annualSales = cleanSupplierFieldText(
    businessInfoAnnualSales
    || tablePairs['年销售额']
    || textByRegex(plain, /年销售额[:：]?\s*([^]{0,120}?)(?:研发人数|人员规模|体系认证|$)/i),
  )
  const employeesScale = cleanSupplierFieldText(
    businessInfoEmployeesScale
    || tablePairs['人员规模']
    || tablePairs['员工人数']
    || textByRegex(plain, /(?:人员规模|员工人数)[:：]?\s*([^]{0,120}?)(?:研发人数|年销售额|体系认证|$)/i),
  )
  const businessMainProducts = cleanSupplierFieldText(
    businessInfo['主营产品']
    || tablePairs['主营产品']
    || tablePairs['主要产品']
    || mainProducts,
  )
  const normalizedBusinessInfo = parseSupplierBusinessInfo({
    ...businessInfo,
    人员规模: businessInfoEmployeesScale || employeesScale,
    研发人数: businessInfoRdHeadcount || rdHeadcount,
    年销售额: businessInfoAnnualSales || annualSales,
    体系认证: businessInfo['体系认证'] || qualitySystem,
    公司网址: businessInfo['公司网址'] || tablePairs['公司网址'] || '',
    配套客户: pairedCustomers,
    直接配套客户: directCustomers,
    间接配套客户: indirectCustomers,
    直接出口经验: businessInfo['直接出口经验'] || directExportExp,
    年出口额: businessInfo['年出口额'] || annualExportAmount,
    出口市场: exportCountriesText,
    主营产品: businessMainProducts,
  })
  const normalizedIndustrialCommercialInfo = parseSupplierBusinessInfo({
    ...industrialCommercialInfo,
    法定代表人: industrialCommercialInfo['法定代表人'] || tablePairs['法定代表人'] || tablePairs['法人代表'] || '',
    注册资本: industrialCommercialInfo['注册资本'] || tablePairs['注册资本'] || tablePairs['注册资本(金)'] || '',
    实缴资本: industrialCommercialInfo['实缴资本'] || tablePairs['实缴资本'] || '',
    统一社会信用代码: industrialCommercialInfo['统一社会信用代码'] || tablePairs['统一社会信用代码'] || '',
    成立时间: industrialCommercialInfo['成立时间'] || industrialCommercialInfo['成立日期'] || tablePairs['成立时间'] || tablePairs['成立日期'] || '',
    所属地: industrialCommercialInfo['所属地'] || tablePairs['所属地'] || tablePairs['地区'] || tablePairs['地址'] || '',
    人员规模: industrialCommercialInfo['人员规模'] || tablePairs['人员规模'] || tablePairs['员工人数'] || '',
    注册地址: industrialCommercialInfo['注册地址'] || tablePairs['注册地址'] || tablePairs['地址'] || '',
  })
  const fitSituationText = cleanSupplierFieldText([directCustomers, indirectCustomers].filter(Boolean).join('；'))
  const exportSituationText = cleanSupplierFieldText([directExportExp, annualExportAmount, exportCountriesText].filter(Boolean).join('；'))
  const normalized = normalizeSupplierDetailAtomicFields({
    companyName,
    companyIntro,
    mainProducts: businessMainProducts || mainProducts,
    fitSituation: fitSituationText,
    exportSituation: exportSituationText,
    fitExport: cleanSupplierFieldText([fitSituationText, exportSituationText].filter(Boolean).join('；')),
    qualitySystem,
    contactAction,
    legalRepresentative: tablePairs['法定代表人'] || tablePairs['法人代表'] || '',
    registeredCapital: tablePairs['注册资本'] || tablePairs['注册资本(金)'] || '',
    establishedDate: tablePairs['成立日期'] || tablePairs['成立时间'] || '',
    employeesCount: employeesScale || tablePairs['员工人数'] || tablePairs['人员规模'] || '',
    companyType: tablePairs['企业类型'] || tablePairs['公司类型'] || tablePairs['企业性质'] || '',
    orgCode: tablePairs['统一社会信用代码'] || tablePairs['组织机构代码'] || '',
    address: tablePairs['地址'] || '',
    website: tablePairs['公司网址'] || '',
    detailUrl,
    supplierProfileUrl: detailUrl,
  })
  normalized.companyIntro = cleanSupplierFieldText(normalized.companyIntro)
  normalized.mainProducts = cleanSupplierFieldText(normalized.mainProducts)
  normalized.qualitySystem = cleanSupplierFieldText(normalized.qualitySystem)
  normalized.contactAction = cleanSupplierFieldText(normalized.contactAction)
  return {
    ...normalized,
    companyTags,
    businessInfo: normalizedBusinessInfo,
    industrialCommercialInfo: normalizedIndustrialCommercialInfo,
    customerItems: parseGasgooCustomerItems(
      normalizedBusinessInfo['配套客户']
      || normalizedBusinessInfo['直接配套客户']
      || normalizedBusinessInfo['间接配套客户']
      || '',
    ),
    mainProductNames: dedupeSupplierProductNames(splitSupplierProductTexts(
      normalizedBusinessInfo['主营产品'] || normalized.mainProducts || '',
    )),
    productCaseItems: [],
    financingItems,
    softwareCopyrightItems,
    patentItems,
    adminLicenseItems,
    adminLicenseGsItems,
    tradeCreditItems,
    courtNoticeItems,
    productionBaseItems,
    newsItems: extractSupplierNewsItemsFromHtml(html, detailUrl),
  }
}

function discoverSupplierDetailTabLinksFromHtml(html = '', baseUrl = '') {
  const source = String(html || '')
  if (!source) return []
  const links = []
  const seen = new Set()
  const navBlocks = [
    ...source.matchAll(/<div[^>]*class=["'][^"']*\bm_nav\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi),
  ]
  const candidates = navBlocks.length > 0 ? navBlocks.map((item) => item?.[1] || '') : [source]
  for (const block of candidates) {
    for (const matched of block.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = toText(matched?.[1] || '')
      const label = cleanSupplierFieldText(matched?.[2] || '')
      if (!href || !label) continue
      try {
        const absolute = new URL(href, baseUrl).toString()
        const tabKey = classifySupplierDetailTab(label, absolute)
        if (!tabKey || !isLikelySupplierDetailSubpageUrl(absolute, baseUrl)) continue
        const dedupeKey = `${tabKey}@@${absolute}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        links.push({ label, url: absolute, tabKey })
      } catch {
        // ignore invalid url
      }
    }
  }
  return links.slice(0, 24)
}

function looksLikeSupplierTabMenuNoise(value = '') {
  const text = cleanSupplierFieldText(value)
  if (!text) return false
  const tabs = ['首页', '公司简介', '重点产品', '配套情况', '出口情况', '企业证书', '公司视频', '公司新闻', '联系我们']
  const hit = tabs.filter((token) => text.includes(token)).length
  return hit >= 3
}

async function withTimeout(promise, timeoutMs = 60000, message = 'operation timeout') {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1000, Number(timeoutMs || 0)))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForSupplierDetailDomReady(page) {
  const checkpoints = [
    Math.max(600, Math.floor(supplierPlaywrightWaitMs * 0.5)),
    supplierPlaywrightWaitMs,
    Math.max(2200, Math.floor(supplierPlaywrightWaitMs * 1.8)),
    Math.max(4200, Math.floor(supplierPlaywrightWaitMs * 3)),
  ]
  for (const waitMs of checkpoints) {
    await page.waitForTimeout(waitMs)
    const html = await page.content().catch(() => '')
    const plain = await page.evaluate(() => String(document.body?.innerText || '')).catch(() => '')
    if (isSupplierDetailDomReady(html, plain)) return
  }
}

function isLikelySupplierDetailSubpageUrl(urlText = '', baseUrl = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    const base = baseUrl ? new URL(String(baseUrl || '').trim()) : null
    if (!/^https?:$/i.test(parsed.protocol)) return false
    const pathLower = String(parsed.pathname || '').toLowerCase()
    if (/\/(?:category|search|parts|index)\.php$/i.test(pathLower) && !/company\.php/i.test(pathLower)) return false
    if (base && parsed.host !== base.host) return false
    if (isSupplierDetailEntryUrl(parsed.toString())) return true
    if (/\/company_(?:intro|goods|goods_parts|goods_export|list|news|contact)\.php$/i.test(pathLower)) return true
    return false
  } catch {
    return false
  }
}

async function discoverSupplierDetailSubpageUrls(page, baseUrl = '') {
  const currentUrl = toText(baseUrl) || toText(page?.url?.() || '')
  if (!currentUrl) return []
  const collected = new Set()
  const keywordRegex = new RegExp(
    supplierDetailSubpageKeywords
      .map((item) => escapeRegexText(item))
      .filter(Boolean)
      .join('|'),
    'i',
  )
  const current = (() => {
    try {
      return new URL(currentUrl)
    } catch {
      return null
    }
  })()
  const currentMid = toText(current?.searchParams?.get('mid'))
  const rawItems = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('a[href], [data-href], [data-url], [onclick], button'))
    return nodes.slice(0, 1200).map((node) => ({
      text: String(node.textContent || '').trim(),
      href: String(node.getAttribute('href') || '').trim(),
      dataHref: String(node.getAttribute('data-href') || node.getAttribute('data-url') || '').trim(),
      onclick: String(node.getAttribute('onclick') || '').trim(),
      cls: String(node.getAttribute('class') || '').trim(),
      id: String(node.getAttribute('id') || '').trim(),
      name: String(node.getAttribute('name') || '').trim(),
    }))
  }).catch(() => [])
  for (const item of rawItems) {
    const mixed = `${toText(item.text)} ${toText(item.href)} ${toText(item.dataHref)} ${toText(item.onclick)} ${toText(item.cls)} ${toText(item.id)} ${toText(item.name)}`
    const hrefCandidates = [
      toText(item.href),
      toText(item.dataHref),
      ...String(item.onclick || '')
        .match(/["']([^"']{2,280})["']/g)?.map((token) => token.replace(/^["']|["']$/g, '')) || [],
    ]
    for (const href of hrefCandidates) {
      if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue
      try {
        const absolute = new URL(href, currentUrl).toString()
        const parsedAbsolute = new URL(absolute)
        if (current && parsedAbsolute.host !== current.host) continue
        const sameMid = currentMid
          && toText(parsedAbsolute.searchParams.get('mid'))
          && toText(parsedAbsolute.searchParams.get('mid')) === currentMid
        const isCompanyRoute = /\/company(?:_[a-z_]+)?\.php$/i.test(toText(parsedAbsolute.pathname))
        const textLikely = keywordRegex.test(mixed)
        if (!sameMid && !textLikely && !isLikelySupplierDetailSubpageUrl(absolute, currentUrl)) continue
        if (!(isCompanyRoute || isLikelySupplierDetailSubpageUrl(absolute, currentUrl) || (sameMid && textLikely))) continue
        collected.add(absolute)
      } catch {
        // ignore invalid discovered url
      }
    }
  }
  return [...collected].slice(0, 24)
}

function discoverSupplierDetailSubpageUrlsFromHtml(html = '', baseUrl = '') {
  const source = String(html || '')
  const links = new Set()
  const patterns = [
    /(?:href|data-href|data-url)\s*=\s*["']([^"']+)["']/gi,
    /location\.href\s*=\s*["']([^"']+)["']/gi,
  ]
  for (const pattern of patterns) {
    for (const matched of source.matchAll(pattern)) {
      const href = toText(matched?.[1] || '')
      if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue
      try {
        const absolute = new URL(href, baseUrl).toString()
        if (!isLikelySupplierDetailSubpageUrl(absolute, baseUrl)) continue
        links.add(absolute)
      } catch {
        // ignore invalid discovered url
      }
    }
  }
  return [...links].slice(0, 24)
}

function createSupplierTaskId() {
  const randomTail = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `${Date.now()}${randomTail}`
}

function normalizeSupplierTask(task) {
  return {
    taskId: task.taskId,
    nodeId: task.nodeId,
    nodeName: task.nodeName,
    model: task.model,
    skill: task.skill,
    homepageOnly: Boolean(task.homepageOnly),
    allowPlaywrightDetail: Boolean(task.allowPlaywrightDetail),
    status: task.status,
    progress: task.progress,
    totalUrls: task.totalUrls,
    processedUrls: task.processedUrls,
    totalRows: task.totalRows,
    estimatedTotalRows: task.estimatedTotalRows || 0,
    successRows: task.successRows,
    failedRows: task.failedRows,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    urls: task.urls,
    fileName: task.fileName,
    downloadUrl: task.downloadUrl,
    imported: task.imported,
    importSummary: task.importSummary,
    cancelRequested: Boolean(task.cancelRequested),
    errorMessage: task.errorMessage,
    runLogs: task.runLogs.slice(-300),
  }
}

function serializeSupplierTask(task) {
  return {
    ...normalizeSupplierTask(task),
    sourceUrl: task.sourceUrl || '',
    urlNodeMetaMap: task.urlNodeMetaMap || {},
    filePath: task.filePath || '',
    records: Array.isArray(task.records) ? task.records : [],
    baseRowsBeforeCurrentUrl: Number(task.baseRowsBeforeCurrentUrl || 0),
    allowPlaywrightDetail: Boolean(task.allowPlaywrightDetail),
  }
}

async function persistSupplierTaskStore() {
  const payload = [...supplierCrawlTaskStore.values()]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 80)
    .map(serializeSupplierTask)
  await fs.mkdir(path.dirname(supplierTaskStoreFile), { recursive: true })
  await fs.writeFile(supplierTaskStoreFile, JSON.stringify(payload, null, 2), 'utf8')
}

function schedulePersistSupplierTaskStore() {
  supplierTaskStorePersistPending = true
  supplierTaskStorePersistPromise = supplierTaskStorePersistPromise
    .catch(() => {})
    .then(async () => {
      if (!supplierTaskStorePersistPending) return
      supplierTaskStorePersistPending = false
      await persistSupplierTaskStore()
    })
    .catch(() => {})
}

function markSupplierTaskFailed(task, error) {
  if (!task) return
  const messageText = toText(error?.message || error) || '任务执行失败'
  task.status = 'failed'
  task.errorMessage = messageText
  task.progress = 100
  task.endedAt = new Date().toISOString()
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  task.runLogs.push(`${nowText()} | 执行失败：${messageText}`)
  schedulePersistSupplierTaskStore()
}

function launchSupplierCrawlTask(task, reason = 'manual') {
  if (!task) return
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  if (reason === 'resume') {
    task.runLogs.push(`${nowText()} | 服务恢复：自动续跑已开始`)
  }
  task.errorMessage = ''
  task.endedAt = null
  schedulePersistSupplierTaskStore()
  void runSupplierCrawlTask(task).catch((error) => {
    markSupplierTaskFailed(task, error)
  })
}

function scheduleAutoResumeSupplierTasks() {
  if (supplierAutoResumeScheduled || supplierAutoResumeTaskIds.length === 0) return
  supplierAutoResumeScheduled = true
  setTimeout(() => {
    supplierAutoResumeScheduled = false
    const ids = [...new Set(supplierAutoResumeTaskIds.splice(0, supplierAutoResumeTaskIds.length))]
    for (const taskId of ids) {
      const task = supplierCrawlTaskStore.get(taskId)
      if (!task) continue
      if (task.status !== 'pending') continue
      if (task.cancelRequested) continue
      launchSupplierCrawlTask(task, 'resume')
    }
  }, 1200)
}

async function restoreSupplierTaskStore() {
  try {
    const raw = await fs.readFile(supplierTaskStoreFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
    let changed = false
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const taskId = toText(item.taskId)
      if (!taskId) continue
      const task = {
        taskId,
        nodeId: item.nodeId ?? null,
        nodeName: toText(item.nodeName),
        sourceUrl: toText(item.sourceUrl),
        urlNodeMetaMap: item.urlNodeMetaMap && typeof item.urlNodeMetaMap === 'object' ? item.urlNodeMetaMap : {},
        model: toText(item.model) || codexModelOptions[0],
        skill: toText(item.skill) || supplierSkillOptions[0],
        homepageOnly: normalizeSupplierHomepageOnly(item.homepageOnly),
        allowPlaywrightDetail: normalizeSupplierAllowPlaywrightDetail(item.allowPlaywrightDetail),
        urls: Array.isArray(item.urls) ? item.urls.map((url) => toText(url)).filter(Boolean) : [],
        status: toText(item.status) || 'pending',
        progress: Math.max(0, Math.min(100, Number(item.progress || 0))),
        totalUrls: Math.max(0, Number(item.totalUrls || 0)),
        processedUrls: Math.max(0, Number(item.processedUrls || 0)),
        totalRows: Math.max(0, Number(item.totalRows || 0)),
        estimatedTotalRows: Math.max(0, Number(item.estimatedTotalRows || 0)),
        successRows: Math.max(0, Number(item.successRows || 0)),
        failedRows: Math.max(0, Number(item.failedRows || 0)),
        createdAt: toText(item.createdAt) || new Date().toISOString(),
        startedAt: toText(item.startedAt) || null,
        endedAt: toText(item.endedAt) || null,
        fileName: toText(item.fileName),
        filePath: toText(item.filePath),
        downloadUrl: toText(item.downloadUrl),
        imported: Boolean(item.imported),
        importSummary: item.importSummary || null,
        cancelRequested: Boolean(item.cancelRequested),
        errorMessage: toText(item.errorMessage),
        runLogs: Array.isArray(item.runLogs) ? item.runLogs.map((line) => toText(line)).filter(Boolean).slice(-300) : [],
        records: Array.isArray(item.records) ? item.records : [],
        baseRowsBeforeCurrentUrl: Math.max(0, Number(item.baseRowsBeforeCurrentUrl || 0)),
      }
      if (['pending', 'running', 'cancelling'].includes(task.status)) {
        const canResume = ['pending', 'running'].includes(task.status) && !task.cancelRequested
        if (canResume) {
          task.status = 'pending'
          task.progress = Math.max(1, Math.min(95, Number(task.progress || 1)))
          task.startedAt = null
          task.endedAt = null
          task.errorMessage = ''
          task.runLogs.push(`${nowText()} | 服务重启，任务进入自动续跑队列`)
          supplierAutoResumeTaskIds.push(taskId)
        } else {
          task.status = 'cancelled'
          task.progress = 100
          task.endedAt = new Date().toISOString()
          task.errorMessage = task.errorMessage || '任务在服务重启前已取消'
          task.runLogs.push(`${nowText()} | 服务重启，任务按取消状态结束`)
        }
        changed = true
      }
      supplierCrawlTaskStore.set(taskId, task)
    }
    if (changed) schedulePersistSupplierTaskStore()
    scheduleAutoResumeSupplierTasks()
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[supplier-task-store] restore failed:', error.message || error)
    }
  }
}

function createGasSupplyChainTaskId() {
  const randomTail = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `gas${Date.now()}${randomTail}`
}

function normalizeGasSupplyChainTask(task) {
  return {
    taskId: task.taskId,
    sourceUrl: task.sourceUrl,
    model: task.model,
    skill: task.skill,
    mode: task.mode,
    status: task.status,
    progress: task.progress,
    totalUrls: task.totalUrls,
    processedUrls: task.processedUrls,
    totalRows: task.totalRows,
    estimatedTotalRows: task.estimatedTotalRows || 0,
    successRows: task.successRows,
    failedRows: task.failedRows,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    urls: task.urls,
    fileName: task.fileName,
    downloadUrl: task.downloadUrl,
    imported: task.imported,
    importSummary: task.importSummary,
    cancelRequested: Boolean(task.cancelRequested),
    localExtractorEnabled: Boolean(resolveGasSyncLocalExtractorConfig(task)),
    errorMessage: task.errorMessage,
    runLogs: Array.isArray(task.runLogs) ? task.runLogs.slice(-300) : [],
  }
}

function serializeGasSupplyChainTask(task) {
  return {
    ...normalizeGasSupplyChainTask(task),
    localExtractorCommand: toText(task.localExtractorCommand),
    localExtractorArgs: normalizeLocalExtractorArgs(task.localExtractorArgs),
    localExtractorCwd: toText(task.localExtractorCwd),
    localExtractorTimeoutMs: Math.max(5000, Number(task.localExtractorTimeoutMs || gasSyncLocalExtractTimeoutMsDefault)),
    filePath: task.filePath || '',
    records: Array.isArray(task.records) ? task.records : [],
  }
}

async function persistGasSupplyChainTaskStore() {
  const payload = [...gasSupplyChainTaskStore.values()]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 80)
    .map(serializeGasSupplyChainTask)
  await fs.mkdir(path.dirname(gasSupplyChainTaskStoreFile), { recursive: true })
  await fs.writeFile(gasSupplyChainTaskStoreFile, JSON.stringify(payload, null, 2), 'utf8')
}

function schedulePersistGasSupplyChainTaskStore() {
  gasSupplyChainTaskStorePersistPending = true
  gasSupplyChainTaskStorePersistPromise = gasSupplyChainTaskStorePersistPromise
    .catch(() => {})
    .then(async () => {
      if (!gasSupplyChainTaskStorePersistPending) return
      gasSupplyChainTaskStorePersistPending = false
      await persistGasSupplyChainTaskStore()
    })
    .catch(() => {})
}

async function restoreGasSupplyChainTaskStore() {
  try {
    const raw = await fs.readFile(gasSupplyChainTaskStoreFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
    let changed = false
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const taskId = toText(item.taskId)
      if (!taskId) continue
      const task = {
        taskId,
        sourceUrl: toText(item.sourceUrl) || 'https://i.gasgoo.com/',
        model: toText(item.model) || codexModelOptions[0],
        skill: toText(item.skill) || 'web-access',
        mode: toText(item.mode) || 'full',
        urls: Array.isArray(item.urls) ? item.urls.map((url) => toText(url)).filter(Boolean) : [],
        localExtractorCommand: toText(item.localExtractorCommand),
        localExtractorArgs: normalizeLocalExtractorArgs(item.localExtractorArgs),
        localExtractorCwd: toText(item.localExtractorCwd),
        localExtractorTimeoutMs: Math.max(5000, Number(item.localExtractorTimeoutMs || gasSyncLocalExtractTimeoutMsDefault)),
        status: toText(item.status) || 'pending',
        progress: Math.max(0, Math.min(100, Number(item.progress || 0))),
        totalUrls: Math.max(0, Number(item.totalUrls || 0)),
        processedUrls: Math.max(0, Number(item.processedUrls || 0)),
        totalRows: Math.max(0, Number(item.totalRows || 0)),
        estimatedTotalRows: Math.max(0, Number(item.estimatedTotalRows || 0)),
        successRows: Math.max(0, Number(item.successRows || 0)),
        failedRows: Math.max(0, Number(item.failedRows || 0)),
        createdAt: toText(item.createdAt) || new Date().toISOString(),
        startedAt: toText(item.startedAt) || null,
        endedAt: toText(item.endedAt) || null,
        fileName: toText(item.fileName),
        filePath: toText(item.filePath),
        downloadUrl: toText(item.downloadUrl),
        imported: Boolean(item.imported),
        importSummary: item.importSummary || null,
        cancelRequested: Boolean(item.cancelRequested),
        errorMessage: toText(item.errorMessage),
        runLogs: Array.isArray(item.runLogs) ? item.runLogs.map((line) => toText(line)).filter(Boolean).slice(-300) : [],
        records: Array.isArray(item.records) ? item.records : [],
      }
      if (['pending', 'running', 'cancelling'].includes(task.status)) {
        task.status = 'failed'
        task.progress = 100
        task.endedAt = new Date().toISOString()
        task.errorMessage = task.errorMessage || '服务重启导致任务中断，请重新提交抓取'
        task.runLogs.push(`${nowText()} | 服务重启，任务已标记为中断`)
        changed = true
      }
      gasSupplyChainTaskStore.set(taskId, task)
    }
    if (changed) schedulePersistGasSupplyChainTaskStore()
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[gas-supply-chain-task-store] restore failed:', error.message || error)
    }
  }
}

function parseGasSupplyChainOnclick(onclickText = '') {
  const boomMatched = String(onclickText || '').match(/JumpOtherBoom\('([^']+)'\)/)
  if (boomMatched?.[1]) {
    return {
      type: 'boom',
      url: boomMatched[1],
      rootCode: '',
      secondCode: '',
      thirdCode: '',
    }
  }
  const matched = String(onclickText || '').match(/JumpOther\((\d+),(\d+),(\d+)\)/)
  if (!matched) return null
  return {
    type: 'jump',
    url: '',
    rootCode: matched[1],
    secondCode: matched[2],
    thirdCode: matched[3],
  }
}

function buildGasgooCategoryUrl(categoryCode = '') {
  const code = toText(categoryCode)
  return code ? `https://i.gasgoo.com/supplier/c-${code}.html` : ''
}

function extractGasgooCategoryCodeFromUrl(url = '') {
  const matched = String(url || '').match(/(?:boom\/)?c-(\d+)\.html/i)
  return matched ? toText(matched[1]) : ''
}

function toAbsoluteUrlByBase(baseUrl = '', href = '') {
  const value = toText(href)
  if (!value) return ''
  try {
    return new URL(value, baseUrl || 'https://i.gasgoo.com/').toString()
  } catch {
    return ''
  }
}

function stripHtmlKeepText(html = '') {
  return decodeBasicHtmlEntities(
    String(html || '')
      .replace(/<s\b[^>]*>[\s\S]*?<\/s>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function isGasgooCaptchaPage(html = '') {
  const text = String(html || '')
  if (!text) return false
  return /TencentCaptcha|WafCaptcha|ssl\.captcha\.qq\.com/i.test(text)
}

function parseGasgooSupplyChainNodesFromHtml(html, sourceUrl, taskMeta = {}) {
  const page = String(html || '')
  const rootMap = new Map()
  const rootMatches = [...page.matchAll(/<li\s+onclick="JumpOther\((\d+),0,0\)"[^>]*id="menucid\1"[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi)]
  for (const match of rootMatches) {
    const rootCode = toText(match[1])
    const rootTitle = stripHtmlKeepText(match[2])
    if (!rootCode || !rootTitle) continue
    rootMap.set(rootCode, {
      code: rootCode,
      title: rootTitle,
      url: buildGasgooCategoryUrl(rootCode),
    })
  }

  const panelStarts = [...page.matchAll(/<div class="secMenu2022 cid(\d+)"/gi)]
    .map((match) => ({ rootCode: toText(match[1]), index: match.index ?? 0 }))
    .filter((item) => item.rootCode && rootMap.has(item.rootCode))

  const rows = []
  for (const root of rootMap.values()) {
    rows.push({
      sourceUrl,
      pageUrl: sourceUrl,
      model: taskMeta.model || '',
      skill: taskMeta.skill || '',
      mode: taskMeta.mode || 'full',
      nodeLevel: 1,
      nodeCode: root.code,
      nodeTitle: root.title,
      nodeUrl: root.url,
      parentCode: '',
      parentTitle: '',
      parentUrl: '',
      level1Code: root.code,
      level1Title: root.title,
      level1Url: root.url,
      level2Code: '',
      level2Title: '',
      level2Url: '',
      level3Code: '',
      level3Title: '',
      level3Url: '',
      lineage: root.title,
      status: 'success',
      errorMessage: '',
    })
  }

  for (let index = 0; index < panelStarts.length; index += 1) {
    const current = panelStarts[index]
    const nextIndex = index + 1 < panelStarts.length ? panelStarts[index + 1].index : page.length
    const panelHtml = page.slice(current.index, nextIndex)
    const root = rootMap.get(current.rootCode)
    if (!root) continue
    const dlMatches = [...panelHtml.matchAll(/<dl>[\s\S]*?<\/dl>/gi)].map((match) => match[0])
    for (const dlHtml of dlMatches) {
      const dtMatched = dlHtml.match(/<dt>[\s\S]*?<a[^>]*?(?:onclick="([^"]+)")?[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/dt>/i)
      if (!dtMatched) continue
      const secondTitle = stripHtmlKeepText(dtMatched[2])
      if (!secondTitle) continue
      const dtInfo = parseGasSupplyChainOnclick(dtMatched[1] || '')
      let secondCode = toText(dtInfo?.secondCode)
      if (!secondCode) {
        const fallbackMatched = dlHtml.match(/JumpOther\(\d+,(\d+),(\d+)\)/)
        if (fallbackMatched?.[1]) secondCode = toText(fallbackMatched[1])
      }
      const secondUrl = toText(dtInfo?.url) || buildGasgooCategoryUrl(secondCode)
      rows.push({
        sourceUrl,
        pageUrl: sourceUrl,
        model: taskMeta.model || '',
        skill: taskMeta.skill || '',
        mode: taskMeta.mode || 'full',
        nodeLevel: 2,
        nodeCode: secondCode,
        nodeTitle: secondTitle,
        nodeUrl: secondUrl,
        parentCode: root.code,
        parentTitle: root.title,
        parentUrl: root.url,
        level1Code: root.code,
        level1Title: root.title,
        level1Url: root.url,
        level2Code: secondCode,
        level2Title: secondTitle,
        level2Url: secondUrl,
        level3Code: '',
        level3Title: '',
        level3Url: '',
        lineage: `${root.title} > ${secondTitle}`,
        status: 'success',
        errorMessage: '',
      })

      const ddMatched = dlHtml.match(/<dd>([\s\S]*?)<\/dd>/i)
      const ddHtml = ddMatched?.[1] || ''
      const thirdMatches = [...ddHtml.matchAll(/<a[^>]*onclick="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      for (const thirdMatch of thirdMatches) {
        const thirdInfo = parseGasSupplyChainOnclick(thirdMatch[1] || '')
        const thirdTitle = stripHtmlKeepText(thirdMatch[2])
        if (!thirdInfo || thirdInfo.type !== 'jump' || !toText(thirdInfo.thirdCode) || !thirdTitle) continue
        rows.push({
          sourceUrl,
          pageUrl: sourceUrl,
          model: taskMeta.model || '',
          skill: taskMeta.skill || '',
          mode: taskMeta.mode || 'full',
          nodeLevel: 3,
          nodeCode: toText(thirdInfo.thirdCode),
          nodeTitle: thirdTitle,
          nodeUrl: buildGasgooCategoryUrl(thirdInfo.thirdCode),
          parentCode: secondCode,
          parentTitle: secondTitle,
          parentUrl: secondUrl,
          level1Code: root.code,
          level1Title: root.title,
          level1Url: root.url,
          level2Code: secondCode,
          level2Title: secondTitle,
          level2Url: secondUrl,
          level3Code: toText(thirdInfo.thirdCode),
          level3Title: thirdTitle,
          level3Url: buildGasgooCategoryUrl(thirdInfo.thirdCode),
          lineage: `${root.title} > ${secondTitle} > ${thirdTitle}`,
          status: 'success',
          errorMessage: '',
        })
      }
    }
  }

  return rows
}

function parseGasgooSupplyChainNodesFromCategoryPageHtml(html, sourceUrl, taskMeta = {}) {
  const page = String(html || '')
  const rootBlocks = [...page.matchAll(/<li\s+id="(\d+)"[\s\S]*?(?=<li\s+id="\d+"|<\/ul>)/gi)]
  const rows = []
  for (const rootMatch of rootBlocks) {
    const rootHtml = String(rootMatch[0] || '')
    const rootCode = toText(rootMatch[1])
    const rootTitleMatched = rootHtml.match(/<a[^>]*>\s*<span>([\s\S]*?)<\/span>\s*<\/a>/i)
    const rootTitle = stripHtmlKeepText(rootTitleMatched?.[1] || '')
    const rootUrl = buildGasgooCategoryUrl(rootCode)
    if (!rootCode || !rootTitle) continue
    rows.push({
      sourceUrl,
      pageUrl: sourceUrl,
      model: taskMeta.model || '',
      skill: taskMeta.skill || '',
      mode: taskMeta.mode || 'full',
      nodeLevel: 1,
      nodeCode: rootCode,
      nodeTitle: rootTitle,
      nodeUrl: rootUrl,
      parentCode: '',
      parentTitle: '',
      parentUrl: '',
      level1Code: rootCode,
      level1Title: rootTitle,
      level1Url: rootUrl,
      level2Code: '',
      level2Title: '',
      level2Url: '',
      level3Code: '',
      level3Title: '',
      level3Url: '',
      lineage: rootTitle,
      status: 'success',
      errorMessage: '',
    })
    const secBlocks = [...rootHtml.matchAll(/<div class="secLeven"[\s\S]*?<\/div>/gi)].map((match) => String(match[0] || ''))
    for (const secHtml of secBlocks) {
      const secondBlocks = [...secHtml.matchAll(/<li[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*(?:<div class="threeLeven"[\s\S]*?<\/div>)?\s*<\/li>/gi)]
      for (const secondMatch of secondBlocks) {
      const secondHref = toText(secondMatch[1])
      const secondTitle = stripHtmlKeepText(secondMatch[2] || '')
      const secondCode = extractGasgooCategoryCodeFromUrl(secondHref)
      const secondUrl = toAbsoluteUrlByBase(sourceUrl, secondHref) || buildGasgooCategoryUrl(secondCode)
      if (!secondTitle) continue
      rows.push({
        sourceUrl,
        pageUrl: sourceUrl,
        model: taskMeta.model || '',
        skill: taskMeta.skill || '',
        mode: taskMeta.mode || 'full',
        nodeLevel: 2,
        nodeCode: secondCode,
        nodeTitle: secondTitle,
        nodeUrl: secondUrl,
        parentCode: rootCode,
        parentTitle: rootTitle,
        parentUrl: rootUrl,
        level1Code: rootCode,
        level1Title: rootTitle,
        level1Url: rootUrl,
        level2Code: secondCode,
        level2Title: secondTitle,
        level2Url: secondUrl,
        level3Code: '',
        level3Title: '',
        level3Url: '',
        lineage: `${rootTitle} > ${secondTitle}`,
        status: 'success',
        errorMessage: '',
      })
        const secondItemHtml = String(secondMatch[0] || '')
        const thirdMatches = [...secondItemHtml.matchAll(/<li[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi)]
        for (const thirdMatch of thirdMatches) {
          const thirdHref = toText(thirdMatch[1])
          const thirdTitle = stripHtmlKeepText(thirdMatch[2] || '')
          const thirdCode = extractGasgooCategoryCodeFromUrl(thirdHref)
          const thirdUrl = toAbsoluteUrlByBase(sourceUrl, thirdHref) || buildGasgooCategoryUrl(thirdCode)
          if (!thirdTitle || thirdTitle === secondTitle) continue
          rows.push({
            sourceUrl,
            pageUrl: sourceUrl,
            model: taskMeta.model || '',
            skill: taskMeta.skill || '',
            mode: taskMeta.mode || 'full',
            nodeLevel: 3,
            nodeCode: thirdCode,
            nodeTitle: thirdTitle,
            nodeUrl: thirdUrl,
            parentCode: secondCode,
            parentTitle: secondTitle,
            parentUrl: secondUrl,
            level1Code: rootCode,
            level1Title: rootTitle,
            level1Url: rootUrl,
            level2Code: secondCode,
            level2Title: secondTitle,
            level2Url: secondUrl,
            level3Code: thirdCode,
            level3Title: thirdTitle,
            level3Url: thirdUrl,
            lineage: `${rootTitle} > ${secondTitle} > ${thirdTitle}`,
            status: 'success',
            errorMessage: '',
          })
        }
      }
    }
  }
  return rows
}

function parseGasgooSupplyChainNodesUnified(html, sourceUrl, taskMeta = {}) {
  const primary = parseGasgooSupplyChainNodesFromHtml(html, sourceUrl, taskMeta)
  const secondary = parseGasgooSupplyChainNodesFromCategoryPageHtml(html, sourceUrl, taskMeta)
  const merged = primary.length > 0 ? [...primary, ...secondary] : secondary
  const unique = []
  const seen = new Set()
  for (const row of merged) {
    const key = [row.nodeLevel, row.nodeCode, row.nodeTitle, row.parentCode, row.parentTitle].map((item) => toText(item)).join('|')
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(row)
  }
  return unique
}

function resolveGasSyncLocalExtractorConfig(task = {}) {
  const command = toText(task.localExtractorCommand) || gasSyncLocalExtractCommandDefault
  if (!command) return null
  return {
    command,
    args: normalizeLocalExtractorArgs(task.localExtractorArgs, gasSyncLocalExtractArgsJsonDefault),
    cwd: toText(task.localExtractorCwd) || gasSyncLocalExtractCwdDefault || process.cwd(),
    timeoutMs: Math.max(5000, Number(task.localExtractorTimeoutMs || gasSyncLocalExtractTimeoutMsDefault || 180000)),
  }
}

async function extractGasSupplyChainRowsFromExtractorPayload(payload, taskMeta = {}, fallbackSourceUrl = '') {
  let candidateRows = []
  if (Array.isArray(payload)) {
    candidateRows = payload
  } else if (payload && typeof payload === 'object') {
    const nestedData = payload.data && typeof payload.data === 'object' ? payload.data : null
    if (Array.isArray(payload.records)) candidateRows = payload.records
    else if (Array.isArray(payload.rows)) candidateRows = payload.rows
    else if (Array.isArray(payload.items)) candidateRows = payload.items
    else if (Array.isArray(payload.data)) candidateRows = payload.data
    else if (Array.isArray(nestedData?.records)) candidateRows = nestedData.records
    else if (Array.isArray(nestedData?.rows)) candidateRows = nestedData.rows
    else if (Array.isArray(nestedData?.items)) candidateRows = nestedData.items
  }
  let rows = normalizeGasSupplyChainTaskRows(candidateRows, taskMeta, fallbackSourceUrl)
  if (rows.length > 0) return rows

  const filePath = toText(payload?.filePath || payload?.csvPath || payload?.outputCsvPath || payload?.data?.filePath || payload?.data?.csvPath)
  if (!filePath) return []
  if (!(await pathExists(filePath))) return []
  const csvText = await fs.readFile(filePath, 'utf8')
  const csvRows = parseCsvObjects(csvText)
  rows = normalizeGasSupplyChainTaskRows(csvRows, taskMeta, fallbackSourceUrl)
  return rows
}

async function runGasSyncLocalExtractor(task, nowText) {
  const config = resolveGasSyncLocalExtractorConfig(task)
  if (!config) return null
  task.runLogs.push(`${nowText()} | 检测到本地提取脚本，开始执行：${config.command}`)
  const childEnv = {
    ...process.env,
    GAS_SYNC_TASK_ID: toText(task.taskId),
    GAS_SYNC_MODE: toText(task.mode || 'full'),
    GAS_SYNC_SOURCE_URL: toText(task.sourceUrl),
    GAS_SYNC_URLS_JSON: JSON.stringify(Array.isArray(task.urls) ? task.urls : []),
    GAS_SYNC_TASK_PAYLOAD_JSON: JSON.stringify({
      taskId: toText(task.taskId),
      mode: toText(task.mode || 'full'),
      model: toText(task.model),
      skill: toText(task.skill),
      sourceUrl: toText(task.sourceUrl),
      urls: Array.isArray(task.urls) ? task.urls : [],
    }),
  }
  const result = await execFileAsync(config.command, config.args, {
    cwd: config.cwd,
    timeout: config.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    env: childEnv,
  })
  const stdoutText = String(result?.stdout || '').trim()
  const stderrText = String(result?.stderr || '').trim()
  if (stderrText) {
    task.runLogs.push(`${nowText()} | 本地脚本 stderr：${stderrText.slice(0, 800)}`)
  }
  const payload = parseJsonValueFromMixedText(stdoutText)
  if (payload === null) {
    throw new Error('本地提取脚本未输出可解析的 JSON 结果，请检查脚本 stdout')
  }
  const rows = await extractGasSupplyChainRowsFromExtractorPayload(payload, {
    model: task.model,
    skill: task.skill,
    mode: task.mode,
  }, task.sourceUrl)
  if (rows.length === 0) {
    throw new Error('本地提取脚本执行成功，但未返回可用节点记录')
  }
  task.runLogs.push(`${nowText()} | 本地脚本提取完成：${rows.length} 条节点`)
  return { rows }
}

async function fetchGasSupplyChainHtmlWithPlaywright(url, context = {}) {
  let session = null
  try {
    session = await createSupplierPlaywrightSession(url, context)
    const page = session.page
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: supplierPlaywrightGotoTimeoutMs })
    } catch {
      await page.goto(url, { waitUntil: 'commit', timeout: supplierPlaywrightGotoTimeoutMs })
    }
    await page.waitForTimeout(supplierPlaywrightWaitMs)
    const finalUrl = page.url()
    const html = await page.content()
    return {
      html: String(html || ''),
      finalUrl,
      sessionMode: session?.mode || '',
      profileLabel: session?.profileLabel || '',
      launchError: session?.launchError || '',
    }
  } finally {
    if (session?.close) {
      await session.close().catch(() => {})
    }
  }
}

async function fetchGasSupplyChainHtmlWithCdp(url, context = {}) {
  let targetId = ''
  let shouldCloseTarget = false
  try {
    const preferredUrl = toText(url)
    let registeredTarget = null
    try {
      const raw = await fs.readFile(gasgooCdpTargetFile, 'utf8')
      const parsed = JSON.parse(String(raw || '{}'))
      if (toText(parsed?.targetId)) {
        registeredTarget = parsed
      }
    } catch {
      registeredTarget = null
    }
    const targetsPayload = await fetchCdpProxyJson('/targets', {}, 15000).catch(() => ({ value: [] }))
    const targets = Array.isArray(targetsPayload?.value) ? targetsPayload.value : []
    const matchedTarget = registeredTarget?.targetId
      ? { targetId: toText(registeredTarget.targetId), url: toText(registeredTarget.url) || preferredUrl }
      : (targets.find((item) => toText(item?.url) === preferredUrl)
        || targets.find((item) => safeHostFromUrl(item?.url || '').includes('gasgoo.com')))
    if (matchedTarget?.targetId) {
      targetId = toText(matchedTarget.targetId)
    } else {
      const created = await fetchCdpProxyJson(`/new?url=${encodeURIComponent(url)}`, {}, 20000)
      targetId = toText(created?.targetId)
      shouldCloseTarget = true
    }
    if (!targetId) {
      throw new Error('CDP proxy did not return targetId')
    }
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const info = await fetchCdpProxyJson(`/info?target=${encodeURIComponent(targetId)}`, {}, 10000)
    const evaluated = await fetchCdpProxyJson(
      `/eval?target=${encodeURIComponent(targetId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `(() => {
          const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
          const toAbs = (value) => {
            try {
              return value ? new URL(value, location.href).toString() : ''
            } catch {
              return ''
            }
          }
          const codeOf = (value) => {
            const matched = String(value || '').match(/(?:boom\\/)?c-(\\d+)\\.html/i)
            return matched ? matched[1] : ''
          }
          try {
            const records = []
            const roots = Array.from(document.querySelectorAll('#container > li[id]'))
            for (const rootLi of roots) {
              const rootCode = clean(rootLi.id)
              const rootAnchor = rootLi.querySelector('a[href]')
              const rootTitle = clean(rootAnchor?.textContent)
              const rootUrl = toAbs(rootAnchor?.getAttribute('href')) || (rootCode ? ('https://i.gasgoo.com/supplier/c-' + rootCode + '.html') : '')
              if (!rootCode || !rootTitle) continue
              records.push({
                sourceUrl: location.href,
                pageUrl: location.href,
                nodeLevel: 1,
                nodeCode: rootCode,
                nodeTitle: rootTitle,
                nodeUrl: rootUrl,
                parentCode: '',
                parentTitle: '',
                parentUrl: '',
                level1Code: rootCode,
                level1Title: rootTitle,
                level1Url: rootUrl,
                level2Code: '',
                level2Title: '',
                level2Url: '',
                level3Code: '',
                level3Title: '',
                level3Url: '',
                lineage: rootTitle,
                status: 'success',
                errorMessage: '',
              })
              const secondItems = Array.from(rootLi.querySelectorAll('.secLeven > ol > li'))
              for (const secondLi of secondItems) {
                const secondA = secondLi.querySelector('a[href]')
                const secondTitle = clean(secondA?.textContent)
                const secondUrl = toAbs(secondA?.getAttribute('href'))
                const secondCode = clean(codeOf(secondUrl))
                if (!secondTitle) continue
                records.push({
                  sourceUrl: location.href,
                  pageUrl: location.href,
                  nodeLevel: 2,
                  nodeCode: secondCode,
                  nodeTitle: secondTitle,
                  nodeUrl: secondUrl,
                  parentCode: rootCode,
                  parentTitle: rootTitle,
                  parentUrl: rootUrl,
                  level1Code: rootCode,
                  level1Title: rootTitle,
                  level1Url: rootUrl,
                  level2Code: secondCode,
                  level2Title: secondTitle,
                  level2Url: secondUrl,
                  level3Code: '',
                  level3Title: '',
                  level3Url: '',
                  lineage: clean([rootTitle, secondTitle].join(' > ')),
                  status: 'success',
                  errorMessage: '',
                })
                const thirdItems = Array.from(secondLi.querySelectorAll('.threeLeven > ol > li > a[href]'))
                for (const thirdA of thirdItems) {
                  const thirdTitle = clean(thirdA.textContent)
                  const thirdUrl = toAbs(thirdA.getAttribute('href'))
                  const thirdCode = clean(codeOf(thirdUrl))
                  if (!thirdTitle) continue
                  records.push({
                    sourceUrl: location.href,
                    pageUrl: location.href,
                    nodeLevel: 3,
                    nodeCode: thirdCode,
                    nodeTitle: thirdTitle,
                    nodeUrl: thirdUrl,
                    parentCode: secondCode,
                    parentTitle: secondTitle,
                    parentUrl: secondUrl,
                    level1Code: rootCode,
                    level1Title: rootTitle,
                    level1Url: rootUrl,
                    level2Code: secondCode,
                    level2Title: secondTitle,
                    level2Url: secondUrl,
                    level3Code: thirdCode,
                    level3Title: thirdTitle,
                    level3Url: thirdUrl,
                    lineage: clean([rootTitle, secondTitle, thirdTitle].join(' > ')),
                    status: 'success',
                    errorMessage: '',
                  })
                }
              }
            }
            return {
              href: location.href,
              title: document.title,
              readyState: document.readyState,
              html: document.documentElement ? document.documentElement.outerHTML : '',
              records,
            }
          } catch (error) {
            return {
              href: location.href,
              title: document.title || '',
              readyState: document.readyState || '',
              html: document.documentElement ? document.documentElement.outerHTML : '',
              records: [],
              evalError: String(error && error.message ? error.message : error || ''),
            }
          }
        })()`,
      },
      20000,
    )
    const payload = evaluated?.value || {}
    const finalUrl = toText(payload.href || info?.url) || url
    const html = String(payload.html || '')
    const records = Array.isArray(payload.records) ? payload.records : []
    if (!html && records.length === 0) {
      throw new Error(`CDP returned empty payload for ${finalUrl}`)
    }
    if (finalUrl.startsWith('chrome-error://')) {
      throw new Error(`CDP opened browser error page: ${toText(payload.title || info?.title) || finalUrl}`)
    }
    return {
      html,
      records,
      finalUrl,
      pageTitle: toText(payload.title || info?.title),
      readyState: toText(payload.readyState || info?.ready),
      sessionMode: shouldCloseTarget ? 'cdp-proxy' : 'cdp-existing-tab',
      profileLabel: 'chrome:remote-debugging',
      launchError: '',
      skill: toText(context?.skill) || 'web-access',
    }
  } finally {
    if (targetId && shouldCloseTarget) {
      await fetchCdpProxyJson(`/close?target=${encodeURIComponent(targetId)}`, {}, 10000).catch(() => {})
    }
  }
}

async function runGasSupplyChainSyncTask(task) {
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  const taskStart = Date.now()
  task.status = 'running'
  task.startedAt = new Date().toISOString()
  task.progress = 1
  task.runLogs.push(`${nowText()} | 任务开始：模式=${task.mode === 'full' ? '全量' : '增量'}，URL=${task.sourceUrl}`)
  task.runLogs.push(`${nowText()} | 抓取技能=${task.skill || 'web-access'}，模型=${task.model || codexModelOptions[0]}`)
  task.runLogs.push(`${nowText()} | 抓取通道=web-access（仅）`)
  schedulePersistGasSupplyChainTaskStore()

  const rows = []
  for (const currentUrl of task.urls) {
      if (task.cancelRequested) {
        task.status = 'cancelled'
        task.endedAt = new Date().toISOString()
        task.progress = 100
        task.runLogs.push(`${nowText()} | 任务已取消，停止抓取`)
        schedulePersistGasSupplyChainTaskStore()
        return
      }

      task.runLogs.push(`${nowText()} | 开始抓取 GAS 首页分类：${currentUrl}`)
      try {
        const response = await fetchWithTimeout(currentUrl, 15000, { Referer: 'https://i.gasgoo.com/' })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const html = await response.text()
        const httpCaptcha = isGasgooCaptchaPage(html)
        if (httpCaptcha) {
          task.runLogs.push(`${nowText()} | HTTP 返回验证码页，尝试走 web-access 的 CDP 会话抓取`)
        } else {
          task.runLogs.push(`${nowText()} | 页面下载完成，开始解析一级/二级/三级节点`)
        }
        let effectiveRows = httpCaptcha
          ? []
          : parseGasgooSupplyChainNodesUnified(html, currentUrl, {
              model: task.model,
              skill: task.skill,
              mode: task.mode,
            })
        task.runLogs.push(`${nowText()} | HTTP 解析结果：${effectiveRows.length} 条`)
        let effectiveUrl = currentUrl
        if (effectiveRows.length === 0) {
          task.runLogs.push(`${nowText()} | HTTP 未解析到节点，尝试使用 CDP Proxy 复用真实 Chrome 会话`)
          try {
            const cdpResult = await withTimeout(
              fetchGasSupplyChainHtmlWithCdp(currentUrl, { skill: 'web-access' }),
              30000,
              'cdp gas supply chain timeout',
            )
            task.runLogs.push(
              `${nowText()} | CDP会话：${cdpResult.sessionMode || 'unknown'}${cdpResult.profileLabel ? `，profile=${cdpResult.profileLabel}` : ''}${cdpResult.pageTitle ? `，title=${cdpResult.pageTitle}` : ''}${cdpResult.readyState ? `，ready=${cdpResult.readyState}` : ''}`,
            )
            effectiveUrl = cdpResult.finalUrl || currentUrl
            const cdpHtml = String(cdpResult.html || '')
            if (isGasgooCaptchaPage(cdpHtml)) {
              throw new Error('验证码拦截：请先在 web-access 浏览器会话中完成验证，然后重试同步任务')
            }
            effectiveRows = Array.isArray(cdpResult.records) && cdpResult.records.length > 0
              ? cdpResult.records.map((item) => ({
                  ...item,
                  sourceUrl: item.sourceUrl || effectiveUrl,
                  pageUrl: item.pageUrl || effectiveUrl,
                  model: task.model || item.model || '',
                  skill: 'web-access',
                  mode: task.mode || item.mode || 'full',
                }))
              : parseGasgooSupplyChainNodesUnified(cdpHtml, effectiveUrl, {
                  model: task.model,
                  skill: 'web-access',
                  mode: task.mode,
                })
            task.runLogs.push(`${nowText()} | CDP 解析结果：${effectiveRows.length} 条`)
          } catch (cdpError) {
            const rawMsg = toText(cdpError?.message || '')
            const friendly = rawMsg.includes('{"error":"Uncaught"}')
              ? 'CDP Proxy 执行脚本异常（Uncaught），请先在 web-access 浏览器中打开目标页并确保页面已完成加载后重试'
              : (rawMsg || 'unknown error')
            task.runLogs.push(`${nowText()} | CDP Proxy 抓取失败：${friendly}`)
            throw cdpError
          }
        }
        if (effectiveRows.length === 0) {
          throw new Error('web-access 会话下仍未解析到供应链节点，请确认该 URL 是否为分类页，或先在浏览器完成验证码后重试')
        }
        rows.push(...effectiveRows)
        task.successRows = effectiveRows.length
        task.totalRows = rows.length
        task.estimatedTotalRows = rows.length
        task.processedUrls += 1
        task.progress = 92
        task.runLogs.push(`${nowText()} | 节点解析完成：一级 ${effectiveRows.filter((item) => item.nodeLevel === 1).length} 条，二级 ${effectiveRows.filter((item) => item.nodeLevel === 2).length} 条，三级 ${effectiveRows.filter((item) => item.nodeLevel === 3).length} 条`)
        schedulePersistGasSupplyChainTaskStore()
      } catch (error) {
        task.failedRows += 1
        task.processedUrls += 1
        task.errorMessage = error.message === 'cdp gas supply chain timeout'
            ? 'CDP Proxy 抓取超时，请确认 Chrome 已开启并允许 remote debugging'
            : (error.message || '抓取失败')
        task.runLogs.push(`${nowText()} | 抓取失败：${task.errorMessage}`)
        throw error
      }
    }

  const fileName = `gas_supply_chain_${Date.now()}.csv`
  const absPath = path.join(crawlExportDir, fileName)
  const header = [
    'source_url',
    'page_url',
    'model',
    'skill',
    'mode',
    'node_level',
    'node_code',
    'node_title',
    'node_url',
    'parent_code',
    'parent_title',
    'parent_url',
    'level1_code',
    'level1_title',
    'level1_url',
    'level2_code',
    'level2_title',
    'level2_url',
    'level3_code',
    'level3_title',
    'level3_url',
    'lineage',
    'status',
    'error_message',
  ]
  const lines = [
    header.join(','),
    ...rows.map((row) => [
      row.sourceUrl,
      row.pageUrl,
      row.model,
      row.skill,
      row.mode,
      row.nodeLevel,
      row.nodeCode,
      row.nodeTitle,
      row.nodeUrl,
      row.parentCode,
      row.parentTitle,
      row.parentUrl,
      row.level1Code,
      row.level1Title,
      row.level1Url,
      row.level2Code,
      row.level2Title,
      row.level2Url,
      row.level3Code,
      row.level3Title,
      row.level3Url,
      row.lineage,
      row.status,
      row.errorMessage,
    ].map(csvEscape).join(',')),
  ]
  await fs.writeFile(absPath, lines.join('\n'), 'utf8')

  task.fileName = fileName
  task.filePath = absPath
  task.downloadUrl = `/api/crawl-exports/${encodeURIComponent(fileName)}`
  task.records = rows
  task.totalRows = rows.length
  task.estimatedTotalRows = rows.length
  task.progress = 100
  task.status = 'done'
  task.endedAt = new Date().toISOString()
  task.runLogs.push(`${nowText()} | CSV 已生成：${fileName}，共 ${rows.length} 条节点`)
  task.runLogs.push(`${nowText()} | 任务完成，总耗时 ${Date.now() - taskStart}ms`)
  schedulePersistGasSupplyChainTaskStore()
}

async function upsertGasSupplyChainNode(client, payload) {
  const existing = await client.query(
    `
    SELECT id, synced_supplier_count AS "syncedSupplierCount"
    FROM ${gasSupplyChainNodeTable}
    WHERE parent_id IS NOT DISTINCT FROM $1
      AND node_level = $2
      AND node_title = $3
    LIMIT 1
    `,
    [payload.parentId, payload.nodeLevel, payload.nodeTitle],
  )
  if (existing.rowCount > 0) {
    const current = existing.rows[0]
    await client.query(
      `
      UPDATE ${gasSupplyChainNodeTable}
      SET
        node_url = $2,
        source_url = $3,
        synced_at = $4,
        updated_at = NOW()
      WHERE id = $1
      `,
      [current.id, payload.nodeUrl || '', payload.sourceUrl || '', payload.syncedAt || null],
    )
    return { id: current.id, created: false, syncedSupplierCount: Number(current.syncedSupplierCount || 0) }
  }
  const inserted = await client.query(
    `
    INSERT INTO ${gasSupplyChainNodeTable}
    (parent_id, node_level, node_title, node_url, source_url, synced_supplier_count, synced_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 0, $6, NOW())
    RETURNING id
    `,
    [payload.parentId, payload.nodeLevel, payload.nodeTitle, payload.nodeUrl || '', payload.sourceUrl || '', payload.syncedAt || null],
  )
  return { id: inserted.rows[0].id, created: true, syncedSupplierCount: 0 }
}

async function importGasSupplyChainTaskRows(records, mode = 'full') {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('没有可入库的 GAS 供应链节点')
  }
  const client = await pool.connect()
  const summary = {
    importedRows: records.length,
    inserted: 0,
    updated: 0,
    level1Inserted: 0,
    level2Inserted: 0,
    level3Inserted: 0,
    level1Updated: 0,
    level2Updated: 0,
    level3Updated: 0,
    syncedSuppliers: 0,
  }
  try {
    await client.query('BEGIN')
    if (mode === 'full') {
      await client.query(`DELETE FROM ${gasSupplyChainNodeTable}`)
    }
    const importTime = new Date().toISOString()
    const level1Rows = records.filter((item) => Number(item.nodeLevel) === 1)
    const level2Rows = records.filter((item) => Number(item.nodeLevel) === 2)
    const level3Rows = records.filter((item) => Number(item.nodeLevel) === 3)
    const level1Map = new Map()
    const level2Map = new Map()

    for (const row of level1Rows) {
      const result = await upsertGasSupplyChainNode(client, {
        parentId: null,
        nodeLevel: 1,
        nodeTitle: toText(row.level1Title || row.nodeTitle),
        nodeUrl: toText(row.level1Url || row.nodeUrl),
        sourceUrl: toText(row.sourceUrl),
        syncedAt: importTime,
      })
      level1Map.set(toText(row.level1Code || row.nodeCode || row.level1Title || row.nodeTitle), result.id)
      if (result.created) {
        summary.inserted += 1
        summary.level1Inserted += 1
      } else {
        summary.updated += 1
        summary.level1Updated += 1
        summary.syncedSuppliers += Number(result.syncedSupplierCount || 0)
      }
    }

    for (const row of level2Rows) {
      const level1Key = toText(row.level1Code || row.level1Title)
      const parentId = level1Map.get(level1Key) || null
      const result = await upsertGasSupplyChainNode(client, {
        parentId,
        nodeLevel: 2,
        nodeTitle: toText(row.level2Title || row.nodeTitle),
        nodeUrl: toText(row.level2Url || row.nodeUrl),
        sourceUrl: toText(row.sourceUrl),
        syncedAt: importTime,
      })
      level2Map.set(toText(row.level2Code || row.nodeCode || row.level2Title || row.nodeTitle), result.id)
      if (result.created) {
        summary.inserted += 1
        summary.level2Inserted += 1
      } else {
        summary.updated += 1
        summary.level2Updated += 1
        summary.syncedSuppliers += Number(result.syncedSupplierCount || 0)
      }
    }

    for (const row of level3Rows) {
      const level2Key = toText(row.level2Code || row.parentCode || row.level2Title || row.parentTitle)
      const parentId = level2Map.get(level2Key) || null
      const result = await upsertGasSupplyChainNode(client, {
        parentId,
        nodeLevel: 3,
        nodeTitle: toText(row.level3Title || row.nodeTitle),
        nodeUrl: toText(row.level3Url || row.nodeUrl),
        sourceUrl: toText(row.sourceUrl),
        syncedAt: importTime,
      })
      if (result.created) {
        summary.inserted += 1
        summary.level3Inserted += 1
      } else {
        summary.updated += 1
        summary.level3Updated += 1
        summary.syncedSuppliers += Number(result.syncedSupplierCount || 0)
      }
    }

    await client.query('COMMIT')
    return {
      ...summary,
      updatedNodes: summary.inserted + summary.updated,
      mode,
      syncedAt: importTime,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function updateSupplierTaskProgressRealtime(task) {
  if (!task) return
  const totalUrls = Math.max(Number(task.totalUrls || 1), 1)
  const processedUrls = Math.max(Number(task.processedUrls || 0), 0)
  const totalRows = Math.max(Number(task.totalRows || 0), 0)
  const estimated = Math.max(Number(task.estimatedTotalRows || 0), totalRows, 0)
  const withinCurrent = estimated > 0 ? Math.min(0.98, totalRows / estimated) : 0
  const progressRatio = (processedUrls + withinCurrent) / totalUrls
  task.progress = Math.min(95, Math.max(1, Math.round(progressRatio * 100)))
}

function textByRegex(text, regex) {
  const matched = String(text || '').match(regex)
  return matched?.[1] ? decodeBasicHtmlEntities(stripHtml(matched[1])) : ''
}

function escapeRegexText(text = '') {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const supplierLabelStopWords = [
  '公司性质',
  '企业性质',
  '企业类型',
  '公司类型',
  '机构代码',
  '组织机构代码',
  '统一社会信用代码',
  '成立日期',
  '成立时间',
  '注册资本',
  '法人代表',
  '法定代表人',
  '单位人数',
  '员工人数',
  '人数',
  '质量体系',
  '认证体系',
  '注册商标',
  '联系方式',
  '联系人',
  '电话',
  '手机',
  '邮箱',
  '地址',
  '邮编',
  '网址',
  '网站',
  '企业简介',
  '公司简介',
  '企业介绍',
  '主要产品',
  '主营产品',
  '新闻发布',
  '公司新闻',
  '公司视频',
]

function stripSupplierFieldLabel(value = '', labels = []) {
  let text = cleanSupplierFieldText(value)
  if (!text) return ''
  for (const label of labels) {
    const token = toText(label)
    if (!token) continue
    text = text.replace(new RegExp(`^${escapeRegexText(token)}\\s*[:：]?\\s*`, 'i'), '').trim()
  }
  return cleanSupplierFieldText(text)
}

function trimSupplierTextAtNextLabel(value = '', ownLabels = []) {
  const text = cleanSupplierFieldText(value)
  if (!text) return ''
  const own = new Set(ownLabels.map((item) => toText(item)).filter(Boolean))
  let cutIndex = -1
  for (const token of supplierLabelStopWords) {
    if (own.has(token)) continue
    const idx = text.indexOf(token)
    if (idx > 0 && (cutIndex < 0 || idx < cutIndex)) cutIndex = idx
  }
  const sliced = cutIndex > 0 ? text.slice(0, cutIndex) : text
  return cleanSupplierFieldText(sliced)
}

function hasSupplierFieldPollution(value = '', ownLabels = []) {
  const text = cleanSupplierFieldText(value)
  if (!text) return false
  const own = new Set(ownLabels.map((item) => toText(item)).filter(Boolean))
  return supplierLabelStopWords.some((token) => !own.has(token) && text.includes(token))
}

function normalizeSupplierDate(value = '') {
  const text = stripSupplierFieldLabel(value, ['成立日期', '成立时间'])
  if (!text) return ''
  const matched = text.match(/((?:19|20)\d{2}\s*[年\-\/.]\s*\d{1,2}\s*[月\-\/.]\s*\d{1,2}\s*日?)/)
  return cleanSupplierFieldText(matched?.[1] || text)
}

function normalizeSupplierRegisteredCapital(value = '') {
  const text = trimSupplierTextAtNextLabel(
    stripSupplierFieldLabel(value, ['注册资本', '注册资金']),
    ['注册资本', '注册资金'],
  )
  if (!text) return ''
  const matched = text.match(/([0-9]+(?:\.[0-9]+)?\s*(?:万|亿)\s*(?:元|人民币|万元|亿元)?)/i)
    || text.match(/([0-9]+(?:\.[0-9]+)?\s*(?:元|人民币))/i)
  return cleanSupplierFieldText(matched?.[1] || text)
}

function normalizeSupplierEmployeesCount(value = '') {
  const text = trimSupplierTextAtNextLabel(
    stripSupplierFieldLabel(value, ['员工人数', '单位人数', '人数']),
    ['员工人数', '单位人数', '人数'],
  )
  if (!text) return ''
  const matched = text.match(/([0-9]{1,9}(?:\.[0-9]+)?\s*(?:人|名)?)/i)
  return cleanSupplierFieldText(matched?.[1] || text)
}

function normalizeSupplierRegion(value = '', address = '') {
  const combined = cleanSupplierFieldText(`${toText(value)} ${toText(address)}`)
  if (!combined) return ''
  const direct = trimSupplierTextAtNextLabel(
    stripSupplierFieldLabel(combined, ['所在地', '所在地区', '地区', '省份', '城市']),
    ['所在地', '所在地区', '地区', '省份', '城市'],
  )
  const source = cleanSupplierFieldText(direct || combined)
  if (!source) return ''
  const provinceMatch = source.match(
    /(北京市|上海市|天津市|重庆市|香港特别行政区|澳门特别行政区|新疆维吾尔自治区|广西壮族自治区|宁夏回族自治区|内蒙古自治区|西藏自治区|(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾)省)/,
  )
  if (provinceMatch?.[1]) {
    const province = cleanSupplierFieldText(provinceMatch[1])
    const tail = source.slice((provinceMatch.index || 0) + province.length)
    const cityCandidates = [...tail.matchAll(/([^\s，,；;:：\-省]{1,12}(?:市|自治州|地区|盟))/g)]
      .map((item) => cleanSupplierFieldText(item?.[1] || ''))
      .filter(Boolean)
    const city = cityCandidates.find((item) => !/^(市辖区|县|省直辖县级行政区划)$/.test(item)) || ''
    if (city && !/^(市辖区|县|省直辖县级行政区划)$/.test(city)) {
      return province.endsWith('市') && city === province ? province : `${province}${city}`
    }
    return province
  }
  const matched = source.match(
    /(北京市|上海市|天津市|重庆市|香港特别行政区|澳门特别行政区|新疆维吾尔自治区|广西壮族自治区|宁夏回族自治区|内蒙古自治区|西藏自治区|[^\s，,；;]{2,8}(?:省|市|自治区|特别行政区)(?:[^\s，,；;]{1,8}(?:市|区|县|州|旗))?)/,
  )
  const picked = cleanSupplierFieldText(matched?.[1] || '')
  if (!picked) return ''
  if (/有限责任公司|股份有限公司|集团|科技有限公司|制造有限|实业有限公司|新能源有限公司/.test(picked)) return ''
  return picked
}

function inferSupplierRegionFromCompanyName(companyName = '') {
  const name = cleanSupplierFieldText(String(companyName || '').replace(/-汽车配套供应商\/厂家$/i, ''))
  if (!name) return ''
  const bracket = name.match(/[（(]([^）)]{2,10})[）)]/)
  const bracketText = cleanSupplierFieldText(bracket?.[1] || '')
  if (bracketText && /(省|市|区|县|州|自治区|特别行政区)/.test(bracketText)) return bracketText
  if (bracketText && /^(北京|上海|天津|重庆|深圳|广州|杭州|苏州|宁波|南京|武汉|成都|西安|郑州|青岛|厦门|福州|大连|沈阳)$/.test(bracketText)) {
    return `${bracketText}市`
  }
  const provinceMatch = name.match(/(北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/)
  if (!provinceMatch?.[1]) return ''
  const base = String(provinceMatch[1] || '')
  if (['北京', '上海', '天津', '重庆', '香港', '澳门'].includes(base)) return `${base}市`
  return `${base}省`
}

function extractDateAndEmployeesPair(dateText = '', employeesText = '') {
  const source = cleanSupplierFieldText(`${toText(dateText)} ${toText(employeesText)}`)
  if (!source) {
    return { establishedDate: '', employeesCount: '' }
  }
  const dateMatched = source.match(/((?:19|20)\d{2}\s*[年\-\/.]\s*\d{1,2}\s*[月\-\/.]\s*\d{1,2}\s*日?)/)
  const employeesMatched = source.match(/(?:员工|单位)?人数?\s*[:：]?\s*([0-9]{1,9}(?:\.[0-9]+)?\s*(?:人|名)?)/i)
  const fallbackEmployees = !employeesMatched
    ? source.match(/(?:\s|^)([0-9]{3,9})(?:\s|$)/)
    : null
  return {
    establishedDate: normalizeSupplierDate(dateMatched?.[1] || dateText),
    employeesCount: normalizeSupplierEmployeesCount(
      employeesMatched?.[1]
      || stripSupplierFieldLabel(employeesText, ['员工人数', '单位人数', '人数'])
      || fallbackEmployees?.[1]
      || ''
    ),
  }
}

function pickSupplierAtomicField(src = {}, field = '', labels = [], maxLen = 200) {
  const ownLabels = Array.isArray(labels) ? labels : []
  const current = cleanSupplierFieldText(src[field] || '')
  const sourceText = cleanSupplierFieldText(Object.values(src).map((v) => toText(v)).join(' '))
  let value = trimSupplierTextAtNextLabel(stripSupplierFieldLabel(current, ownLabels), ownLabels)
  if (!value || hasSupplierFieldPollution(value, ownLabels)) {
    const fromSource = extractSupplierLabeledValue(sourceText, ownLabels, maxLen)
    if (fromSource) value = trimSupplierTextAtNextLabel(fromSource, ownLabels)
  }
  return cleanSupplierFieldText(value)
}

function normalizeSupplierDetailAtomicFields(detail = {}) {
  const src = detail && typeof detail === 'object' ? detail : {}
  const regionSeed = cleanSupplierFieldText(toText(src.region))
  const addressSeed = cleanSupplierFieldText(toText(src.address))
  const normalized = {
    ...src,
    companyType: pickSupplierAtomicField(src, 'companyType', ['公司性质', '企业性质', '企业类型', '公司类型'], 80),
    orgCode: pickSupplierAtomicField(src, 'orgCode', ['机构代码', '组织机构代码', '统一社会信用代码'], 64),
    legalRepresentative: pickSupplierAtomicField(src, 'legalRepresentative', ['法人代表', '法定代表人'], 64),
    establishedDate: pickSupplierAtomicField(src, 'establishedDate', ['成立日期', '成立时间'], 64),
    employeesCount: pickSupplierAtomicField(src, 'employeesCount', ['员工人数', '单位人数', '人数'], 48),
    registeredCapital: pickSupplierAtomicField(src, 'registeredCapital', ['注册资本', '注册资金'], 96),
  }
  const datePair = extractDateAndEmployeesPair(normalized.establishedDate, normalized.employeesCount)
  return {
    ...src,
    ...normalized,
    companyType: cleanSupplierFieldText(
      textByRegex(
        trimSupplierTextAtNextLabel(normalized.companyType, ['公司性质', '企业性质', '企业类型', '公司类型']),
        /(股份制|民营|国有|合资|外资|三资|私营|股份有限公司|有限责任公司)/i,
      ) || trimSupplierTextAtNextLabel(normalized.companyType, ['公司性质', '企业性质', '企业类型', '公司类型']),
    ),
    region: normalizeSupplierRegion(regionSeed, addressSeed) || inferSupplierRegionFromCompanyName(toText(src.companyName)),
    orgCode: trimSupplierTextAtNextLabel(normalized.orgCode, ['机构代码', '组织机构代码', '统一社会信用代码']),
    legalRepresentative: trimSupplierTextAtNextLabel(normalized.legalRepresentative, ['法人代表', '法定代表人']),
    establishedDate: normalizeSupplierDate(datePair.establishedDate),
    employeesCount: normalizeSupplierEmployeesCount(datePair.employeesCount),
    registeredCapital: normalizeSupplierRegisteredCapital(normalized.registeredCapital),
  }
}

function extractSupplierLabeledValue(text = '', labels = [], maxLen = 200) {
  const body = cleanSupplierFieldText(text)
  if (!body) return ''
  const labelPattern = labels.map((item) => escapeRegexText(item)).join('|')
  if (!labelPattern) return ''
  const stopPattern = supplierLabelStopWords.map((item) => escapeRegexText(item)).join('|')
  const pattern = new RegExp(
    `(?:${labelPattern})\\s*[:：]?\\s*([\\s\\S]{1,${Math.max(24, maxLen * 3)}}?)(?=\\s*(?:${stopPattern})\\s*[:：]?\\s*|$)`,
    'i',
  )
  const matched = body.match(pattern)
  return cleanSupplierFieldText((matched?.[1] || '').slice(0, maxLen))
}

function parseJsonObjectFromText(text = '') {
  const raw = String(text || '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    // ignore
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      // ignore
    }
  }
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1))
    } catch {
      // ignore
    }
  }
  return null
}

function normalizeSupplierDetailByLlmOutput(payload = {}) {
  const data = payload && typeof payload === 'object' ? payload : {}
  return normalizeSupplierDetailAtomicFields({
    companyName: cleanSupplierFieldText(toText(data.companyName)),
    companyIntro: cleanSupplierFieldText(toText(data.companyIntro)),
    mainProducts: cleanSupplierFieldText(toText(data.mainProducts)),
    fitSituation: cleanSupplierFieldText(toText(data.fitSituation)),
    exportSituation: cleanSupplierFieldText(toText(data.exportSituation)),
    fitExport: cleanSupplierFieldText(toText(data.fitExport)),
    qualitySystem: cleanSupplierFieldText(toText(data.qualitySystem)),
    region: cleanSupplierFieldText(toText(data.region)),
    contactAction: cleanSupplierFieldText(toText(data.contactAction)),
    companyType: cleanSupplierFieldText(toText(data.companyType)),
    orgCode: cleanSupplierFieldText(toText(data.orgCode)),
    establishedDate: cleanSupplierFieldText(toText(data.establishedDate)),
    registeredCapital: cleanSupplierFieldText(toText(data.registeredCapital)),
    employeesCount: cleanSupplierFieldText(toText(data.employeesCount)),
    legalRepresentative: cleanSupplierFieldText(toText(data.legalRepresentative)),
    newsSummary: cleanSupplierFieldText(toText(data.newsSummary)),
  })
}

async function extractSupplierDetailByLlm({
  html = '',
  plain = '',
  detailUrl = '',
  model = 'gpt-5.4',
}) {
  if (!supplierLlmEnabled || !supplierLlmApiKey) return null
  const cacheKey = `${model}::${detailUrl}::${String(html || '').length}`
  if (supplierDetailLlmCache.has(cacheKey)) {
    return supplierDetailLlmCache.get(cacheKey)
  }
  const prompt = `
你是企业信息抽取器。请根据网页内容抽取供应商信息，只返回 JSON 对象，不要解释。

抽取字段：
- companyName
- companyIntro
- mainProducts
- fitSituation
- exportSituation
- fitExport
- qualitySystem
- region
- contactAction
- companyType
- orgCode
- establishedDate
- registeredCapital
- employeesCount
- legalRepresentative
- newsSummary

要求：
1) 严格语义理解字段，不要把多个字段拼在同一个值里；
2) 对 companyIntro、mainProducts、fitSituation、exportSituation 这四类内容，若网页存在对应 Tab，请返回该 Tab 的原文内容，不要总结、不要改写、不要补充；
3) 保留原文关键数值与单位（如 30000万元、IATF 16949、208）；
4) 字段值不要包含字段名本身（例如 registeredCapital 不能含“注册资本”字样）；
5) establishedDate 只保留日期；employeesCount 只保留人数数字（可带“人”）；
6) 不确定填空字符串；
7) 返回示例：{"companyName":"","companyIntro":"","mainProducts":"","fitSituation":"","exportSituation":"","fitExport":"","qualitySystem":"","region":"","contactAction":"","companyType":"","orgCode":"","establishedDate":"","registeredCapital":"","employeesCount":"","legalRepresentative":"","newsSummary":""}
`
  const inputText = [
    `URL: ${detailUrl}`,
    'PAGE_TEXT:',
    String(plain || '').slice(0, 12000),
    'PAGE_HTML_SNIPPET:',
    String(html || '').slice(0, 8000),
  ].join('\n')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), supplierLlmTimeoutMs)
  try {
    const response = await fetchByNetworkPolicy(`${supplierLlmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supplierLlmApiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: prompt.trim() },
          { role: 'user', content: inputText },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      return null
    }
    const json = await response.json().catch(() => ({}))
    const content = toText(json?.choices?.[0]?.message?.content || '')
    const parsed = parseJsonObjectFromText(content)
    if (!parsed) return null
    const normalized = normalizeSupplierDetailByLlmOutput(parsed)
    supplierDetailLlmCache.set(cacheKey, normalized)
    return normalized
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function mergeSupplierDetailWithLlm(ruleDetail = {}, llmDetail = null) {
  if (!llmDetail) return { ...ruleDetail }
  const merged = { ...ruleDetail }
  const preservedCertificates = cleanSupplierFieldText(toText(ruleDetail.certificates))
  const preservedNewsItems = Array.isArray(ruleDetail.newsItems) ? parseSupplierNewsItems(ruleDetail.newsItems) : []
  const acceptValue = (key, value) => {
    const text = cleanSupplierFieldText(value)
    if (!text) return false
    if (looksLikeSupplierTabMenuNoise(text)) return false
    if (key === 'companyIntro') {
      if (/(?:配套情况|配套说明|出口情况|出口国家|认证体系|认证说明|企业证书|公司视频|公司新闻|新闻发布|联系方式|联系人|电话|手机|邮箱)[:：]/.test(text)) return false
      return text.length >= 20
    }
    if (key === 'qualitySystem') {
      return /(IATF|ISO|VDA|QS|TS|认证|证书)/i.test(text) && !/公司视频/.test(text)
    }
    if (key === 'contactAction') {
      return /(联系人|电话|手机|邮箱|@|1[3-9]\d{9}|0\d{2,3}-?\d{7,8})/i.test(text)
    }
    return true
  }
  for (const [key, value] of Object.entries(llmDetail)) {
    if (acceptValue(key, value)) {
      merged[key] = cleanSupplierFieldText(value)
    }
  }
  merged.fitSituation = sanitizeSupplierTabFieldValue(merged.fitSituation, ['配套情况', '配套说明', '配套'])
  merged.exportSituation = sanitizeSupplierTabFieldValue(merged.exportSituation, ['出口情况', '出口国家', '出口'])
  if (!toText(merged.fitExport)) {
    merged.fitExport = cleanSupplierFieldText([merged.fitSituation, merged.exportSituation].filter(Boolean).join('；'))
  }
  const normalized = normalizeSupplierDetailAtomicFields(merged)
  normalized.certificates = sanitizeSupplierCertificatesText(toText(merged.certificates) || preservedCertificates)
  if (/(?:配套情况|配套说明|出口情况|出口国家|认证体系|认证说明|企业证书|公司视频|公司新闻|新闻发布|联系方式|联系人|电话|手机|邮箱)[:：]/.test(toText(normalized.companyIntro))) normalized.companyIntro = ''
  normalized.mainProducts = dedupeSupplierProductNames(splitSupplierTextTokens(normalized.mainProducts)).join('；')
  normalized.newsItems = Array.isArray(merged.newsItems) && merged.newsItems.length > 0
    ? parseSupplierNewsItems(merged.newsItems)
    : preservedNewsItems
  return normalized
}

function isLikelySupplierDetailHref(href = '') {
  const text = String(href || '').trim().toLowerCase()
  if (!text) return false
  if (text.startsWith('javascript:') || text.startsWith('#')) return false
  if (/category\.php|article\.php|show_article\.php|help\.php|search|login|regist|news|about|contact|sitemap/.test(text)) return false
  if (/(company|supplier|corp|qiye|member|shop|detail|show_|oemhome)/.test(text)) return true
  if (/\.html?$/.test(text) && /(company|supplier|corp|qiye|member|shop|detail|show_|oemhome)/.test(text)) return true
  return false
}

function sanitizeSupplierCompanyName(name = '') {
  let text = decodeBasicHtmlEntities(stripHtml(String(name || ''))).replace(/\s+/g, ' ').trim()
  text = text
    .replace(/^(?:联系方式|公司简介|重点产品|配套情况|出口情况|企业证书|公司新闻|联系我们)\s*[-—–|｜]\s*/i, '')
    .replace(/\s*[-—–|｜]?\s*汽车配套供应商\/厂家.*$/i, '')
    .replace(/\s*[-—–|｜]?\s*汽车供应商\/厂家.*$/i, '')
    .replace(/\s*[-—–|｜]?\s*汽车配套供应商.*$/i, '')
    .replace(/\s*[-—–|｜]\s*汽车供应商网.*$/i, '')
    .replace(/\s*[-—–|｜]\s*中国汽车供应商网.*$/i, '')
    .replace(/\s*[-—–|｜]\s*全面展示中国最优质汽车供应商.*$/i, '')
    .replace(/\s*[-—–|｜]\s*汽车行业电子商务平台.*$/i, '')
    .replace(/\s*[-—–|｜]\s*汽车行业整车厂\/主机厂\s*[-—–|｜]\s*盖世汽车社区.*$/i, '')
    .replace(/\s*[-—–|｜]\s*盖世汽车社区.*$/i, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text
}

function extractGasOemBrandVehicleFromText(text = '') {
  const plain = cleanSupplierFieldText(text)
  if (!plain) return { brand: '', vehicleModel: '' }
  const brand = cleanSupplierFieldText(textByRegex(plain, /(?:^|[；;|｜\s])品牌[:：]\s*([^；;|｜]+)/i))
  const vehicleModel = cleanSupplierFieldText(textByRegex(plain, /(?:^|[；;|｜\s])车型[:：]\s*([^；;|｜]+)/i))
  return { brand, vehicleModel }
}

function isLikelyCompanyName(name = '') {
  const text = sanitizeSupplierCompanyName(name)
  if (!text || text.length < 2 || text.length > 120) return false
  if (/-->|→|>>/.test(text)) return false
  if (/(首页|上一页|下一页|尾页|更多|登录|注册|关于我们|联系我们|帮助中心|网站地图|意见反馈|用户指南|企业推广|供应商入口|广告合作|版权|汽车供应商网)/.test(text)) return false
  if (!/(公司|集团|股份|有限|科技|工业|制造|实业|厂)/.test(text)) return false
  return true
}

function cleanSupplierFieldText(text = '') {
  return toText(decodeBasicHtmlEntities(stripHtml(String(text || '')))
    .replace(/-->|→|>>|›|»/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/首页\s*公司简介\s*重点产品\s*配套情况\s*出口情况\s*企业证书\s*公司视频\s*公司新闻\s*联系我们/g, ' ')
    .replace(/(?:^|[\s|｜,，;；])(?:首页|关于我们|联系我们|网站地图|供应商入口|收藏本站|设为首页|帮助中心|意见反馈|广告合作|用户指南|登录|注册)(?=$|[\s|｜,，;；])/g, ' ')
    .replace(/热门搜索[:：]?[^\n\r。；;]{0,240}/g, ' ')
    .replace(/(?:汽车供应商网|中国汽车供应商网|全面展示中国最优质汽车供应商)/g, ' ')
    .replace(/[|｜]+/g, ' ')
    .replace(/\s{2,}/g, ' '))
}

function extractKnownItemsFromText(text = '', options = []) {
  const src = cleanSupplierFieldText(text)
  if (!src) return []
  const found = []
  for (const option of options) {
    const token = toText(option)
    if (!token) continue
    if (src.includes(token)) found.push(token)
  }
  return [...new Set(found)]
}

function isSupplierFieldLikelyNoise(field = '', value = '') {
  const text = cleanSupplierFieldText(value)
  if (!text) return true
  if (looksLikeSupplierTabMenuNoise(text)) return true
  if (/(欢迎来到|供应商入口|返回首页|加入收藏|免费注册|请登录)/.test(text)) return true
  if (field === 'mainProducts' && text.length > 180) return true
  if (field === 'fitExport' && text.length > 260) return true
  if (field === 'region' && text.length > 120) return true
  if (field === 'newsSummary' && text.length > 260) return true
  if (field === 'qualitySystem' && !/(IATF|ISO|VDA|QS|TS|认证|证书)/i.test(text)) return true
  if (field === 'contactAction' && !/(联系人|电话|手机|邮箱|@|1[3-9]\d{9}|0\d{2,3}-?\d{7,8})/i.test(text)) return true
  return false
}

function sanitizeSupplierTabFieldValue(value = '', labels = []) {
  const text = cleanSupplierFieldText(value)
  if (!text) return ''
  if (looksLikeSupplierTabMenuNoise(text)) return ''
  if (hasSupplierFieldPollution(text, labels)) return ''
  if (/收藏企业|公司简介|重点产品|公司新闻|公司视频|联系我们/i.test(text)) return ''
  return text
}

function shouldUseIncomingSupplierField(field = '', currentValue = '', incomingValue = '') {
  const current = cleanSupplierFieldText(currentValue)
  const incoming = cleanSupplierFieldText(incomingValue)
  if (!incoming || isSupplierFieldLikelyNoise(field, incoming)) return false
  if (!current) return true
  if (looksLikeSupplierTabMenuNoise(current)) return true
  if (hasSupplierFieldPollution(current)) return true
  if (isSupplierFieldLikelyNoise(field, current)) return true
  if (field === 'companyIntro') return incoming.length > current.length + 24
  if (field === 'mainProducts' || field === 'fitExport') return incoming.length > current.length + 8
  if (field === 'qualitySystem') {
    const currentHit = /(IATF|ISO|VDA|QS|TS|认证|证书)/i.test(current)
    const incomingHit = /(IATF|ISO|VDA|QS|TS|认证|证书)/i.test(incoming)
    return incomingHit && !currentHit
  }
  if (field === 'contactAction') {
    const currentHit = /(联系人|电话|手机|邮箱|@|1[3-9]\d{9}|0\d{2,3}-?\d{7,8})/i.test(current)
    const incomingHit = /(联系人|电话|手机|邮箱|@|1[3-9]\d{9}|0\d{2,3}-?\d{7,8})/i.test(incoming)
    return incomingHit && !currentHit
  }
  return false
}

function applySupplierDetailField(detail, field, value) {
  if (shouldUseIncomingSupplierField(field, detail?.[field], value)) {
    detail[field] = cleanSupplierFieldText(value)
  }
}

function cleanSupplierHtmlBlockText(html = '') {
  return cleanSupplierFieldText(
    decodeBasicHtmlEntities(
      String(html || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n'),
    ),
  )
}

function extractSupplierIntroContentFromHtml(html = '', pageTabKey = '') {
  const source = String(html || '')
  if (!source) return ''
  const candidates = []
  const pushCandidate = (value) => {
    const text = cleanSupplierFieldText(value)
    if (text) candidates.push(text)
  }
  if (pageTabKey === 'intro') {
    pushCandidate(textByRegex(source, /<div[^>]*class=["'][^"']*\bdetailContext(?:1)?\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i))
    pushCandidate(textByRegex(source, /<div[^>]*class=["'][^"']*\bdetailContext\b[^"']*\bdetailContext1\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i))
    pushCandidate(textByRegex(source, /<div[^>]*class=["'][^"']*\bqingkuang\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i))
  }
  pushCandidate(textByRegex(source, /<div[^>]*class=["'][^"']*\babout_nr\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i))
  pushCandidate(textByRegex(source, /<div[^>]*class=["'][^"']*\bintro(?:duction)?\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i))
  const rightBlock = source.match(
    /<div[^>]*class=["'][^"']*\bsmall_sub_right\b[^"']*["'][^>]*>([\s\S]*?)<div[^>]*class=["'][^"']*\bsmall_sub_right1\b/i,
  )?.[1] || ''
  if (rightBlock) {
    const paragraphTexts = [...rightBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((matched) => cleanSupplierHtmlBlockText(matched?.[1] || ''))
      .filter(Boolean)
    if (paragraphTexts.length > 0) pushCandidate(paragraphTexts.join('\n'))
    pushCandidate(cleanSupplierHtmlBlockText(rightBlock))
  }
  return candidates
    .map((item) => cleanSupplierFieldText(item))
    .filter((item) => item.length >= 20)
    .filter((item) => !/(?:配套情况|配套说明)[:：]/.test(item))
    .filter((item) => !/(?:出口情况|出口国家)[:：]/.test(item))
    .filter((item) => !looksLikeSupplierTabMenuNoise(item))
    .sort((a, b) => b.length - a.length)[0] || ''
}

function extractSupplierProductNamesFromHtml(html = '') {
  const source = String(html || '')
  const names = []
  const pushName = (value) => {
    const name = normalizeSupplierProductName(value)
    if (name) names.push(name)
  }
  for (const item of source.matchAll(/company_goods_detail\.php[^>]*>[\s\S]{0,120}?名称[:：]?\s*(?:<i>)?([^<]{1,120})(?:<\/i>)?</gi)) {
    pushName(item?.[1] || '')
  }
  for (const item of source.matchAll(/<li[^>]*>\s*<a[^>]*href=["'][^"']*company_goods(?:\.php|\?[^"']*catid=)[^"']*["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi)) {
    pushName(stripHtml(item?.[1] || ''))
  }
  for (const item of source.matchAll(/(?:产品分类|重点产品|主要产品|主营产品)[:：]?\s*([^<]{2,240})/gi)) {
    for (const token of splitSupplierTextTokens(item?.[1] || '')) pushName(token)
  }
  return dedupeSupplierProductNames(names).slice(0, 60)
}

function escapeSupplierRegexText(text = '') {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractSupplierTitledSectionHtmlBlocks(html = '', labels = []) {
  const source = String(html || '').replace(/<!--[\s\S]*?-->/g, ' ')
  const normalizedLabels = Array.isArray(labels)
    ? labels.map((item) => cleanSupplierFieldText(item)).filter(Boolean)
    : []
  if (!source || normalizedLabels.length === 0) return []
  const allTitles = [
    '公司简介', '企业简介', '企业介绍',
    '产品展示', '重点产品', '主要产品', '主营产品', '产品分类',
    '配套情况', '配套说明',
    '出口情况', '出口国家',
    '企业证书', '认证体系', '认证说明',
    '联系我们', '联系方式', '基本信息',
    '公司新闻', '新闻发布', '相关新闻',
  ]
  const labelPattern = normalizedLabels.map((item) => escapeSupplierRegexText(item)).join('|')
  const allTitlePattern = allTitles.map((item) => escapeSupplierRegexText(item)).join('|')
  const headingClassPattern = '(?:right_title|dianpu_l_list_title|small_sub_right1_list_title)'
  const sectionPattern = new RegExp(
    `<(?:h\\d|div)[^>]*class=["'][^"']*${headingClassPattern}[^"']*["'][^>]*>[\\s\\S]*?<span>\\s*(${labelPattern})\\s*<\\/span>[\\s\\S]*?<\\/(?:h\\d|div)>\\s*([\\s\\S]{0,8000}?)(?=<(?:h\\d|div)[^>]*class=["'][^"']*${headingClassPattern}[^"']*["'][^>]*>[\\s\\S]*?<span>\\s*(?:${allTitlePattern})\\s*<\\/span>|$)`,
    'gi',
  )
  const blocks = []
  for (const matched of source.matchAll(sectionPattern)) {
    const block = String(matched?.[2] || '').trim()
    if (block) blocks.push(block)
  }
  return [...new Set(blocks)]
}

function extractSupplierListItemsFromHtmlBlock(html = '', blockPattern) {
  const source = String(html || '')
  const pattern = blockPattern instanceof RegExp ? blockPattern : null
  if (!source || !pattern) return []
  const block = source.match(pattern)?.[1] || ''
  if (!block) return []
  const items = []
  for (const matched of block.matchAll(/<li[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi)) {
    const text = cleanSupplierFieldText(matched?.[1] || '')
    if (text && !items.includes(text)) items.push(text)
  }
  return items
}

function parseSupplierExtraByText(text = '') {
  const normalized = cleanSupplierFieldText(String(text || ''))
  const mainProducts = cleanSupplierFieldText(textByRegex(normalized, /(?:重点产品|主要产品|主营产品|产品展示)[:：]?\s*([^|；;，,。]+)/i))
  const fitExport = cleanSupplierFieldText(textByRegex(normalized, /(?:配套\s*\/?\s*出口|配套出口|出口)[:：]?\s*([^|；;，,。]+)/i))
  const qualitySystem = cleanSupplierFieldText(textByRegex(normalized, /((?:IATF|ISO|VDA|QS|TS)[^|；;，,。]{0,40})/i))
  const region = cleanSupplierFieldText(textByRegex(normalized, /((?:北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)[^|；;，,。]{0,20})/i))
  return {
    mainProducts,
    fitExport,
    qualitySystem,
    region,
  }
}

function isLikelyRegionNoise(region = '', companyName = '') {
  const regionText = cleanSupplierFieldText(toText(region))
  const companyText = sanitizeSupplierCompanyName(toText(companyName))
  if (!regionText) return false
  if (companyText && (regionText === companyText || companyText.includes(regionText) || regionText.includes(companyText))) return true
  if (/有限责任公司|股份有限公司|集团|科技有限公司|制造有限|实业有限公司|新能源有限公司/.test(regionText)) return true
  if (regionText.length > 16 && !/(省|市|区|县|镇|州|新区|开发区|自治州|自治区)$/.test(regionText)) return true
  return false
}

function extractSupplierContactFieldsFromText(text = '') {
  const src = cleanSupplierFieldText(String(text || ''))
  if (!src) {
    return { contactPerson: '', phone: '', mobile: '', email: '' }
  }
  const contactPerson = cleanSupplierFieldText(
    textByRegex(src, /(?:联系人|联\s*系\s*人)[:：]?\s*([^\s，,；;|/]{2,24})/i),
  )
  const mobile = cleanSupplierFieldText(
    textByRegex(src, /(?:手机|移动电话|联系电话)[:：]?\s*(1[3-9]\d{9})/i)
      || textByRegex(src, /\b(1[3-9]\d{9})\b/i),
  )
  const phone = cleanSupplierFieldText(
    textByRegex(src, /(?:电话|座机|热线)[:：]?\s*([0-9\-()（）]{7,24})/i)
      || textByRegex(src, /\b(0\d{2,3}-?\d{7,8})\b/i),
  )
  const email = cleanSupplierFieldText(
    textByRegex(src, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i),
  )
  return { contactPerson, phone, mobile, email }
}

function buildSupplierSuccessRow(params = {}) {
  const companyName = sanitizeSupplierCompanyName(params.companyName)
  if (!isLikelyCompanyName(companyName)) return null
  let detailUrl = ''
  try {
    detailUrl = new URL(params.detailHref || '', params.listPageUrl).toString()
  } catch {
    detailUrl = ''
  }
  const fromText = parseSupplierExtraByText(params.blockText || '')
  const blockText = cleanSupplierFieldText(toText(params.blockText))
  const blockRegion = extractSupplierLabeledValue(blockText, ['所在地', '所在地区', '地区', '地址'], 180)
  const blockRegisteredCapital = extractSupplierLabeledValue(blockText, ['注册资金', '注册资本'], 96)
  const blockEstablishedDate = extractSupplierLabeledValue(blockText, ['成立时间', '成立日期'], 64)
  const mergedMainProducts = cleanSupplierFieldText(toText(params.mainProducts) || fromText.mainProducts)
  const mergedRegion = cleanSupplierFieldText(toText(params.region) || blockRegion || fromText.region)
  const normalizedRegion = normalizeSupplierRegion(mergedRegion, toText(params.address) || toText(params.blockText))
  const finalRegion = cleanSupplierFieldText(normalizedRegion || mergedRegion)
  const brandVehicleFromText = extractGasOemBrandVehicleFromText(
    [toText(params.brand), toText(params.vehicleModel), mergedMainProducts, toText(params.blockText)].filter(Boolean).join('；'),
  )
  const normalizedAtomic = normalizeSupplierDetailAtomicFields({
    companyType: params.companyType,
    orgCode: params.orgCode,
    establishedDate: params.establishedDate || blockEstablishedDate,
    registeredCapital: params.registeredCapital || blockRegisteredCapital,
    employeesCount: params.employeesCount,
    legalRepresentative: params.legalRepresentative,
  })
  return {
    nodeId: params.context?.nodeId || null,
    nodeName: params.context?.nodeName || '',
    model: params.context?.model || '',
    skill: params.context?.skill || '',
    sourceUrl: params.context?.sourceUrl || params.listPageUrl,
    listPageUrl: params.listPageUrl,
    detailUrl,
    companyName,
    brand: cleanSupplierFieldText(toText(params.brand) || brandVehicleFromText.brand),
    vehicleModel: cleanSupplierFieldText(toText(params.vehicleModel) || brandVehicleFromText.vehicleModel),
    mainProducts: mergedMainProducts,
    fitExport: cleanSupplierFieldText(toText(params.fitExport) || fromText.fitExport),
    qualitySystem: cleanSupplierFieldText(toText(params.qualitySystem) || fromText.qualitySystem),
    region: isLikelyRegionNoise(finalRegion, companyName) ? '' : finalRegion,
    contactAction: toText(params.contactAction) || '查看/收藏',
    companyIntro: cleanSupplierFieldText(toText(params.companyIntro)),
    companyType: cleanSupplierFieldText(toText(normalizedAtomic.companyType)),
    orgCode: cleanSupplierFieldText(toText(normalizedAtomic.orgCode)),
    establishedDate: cleanSupplierFieldText(toText(normalizedAtomic.establishedDate)),
    registeredCapital: cleanSupplierFieldText(toText(normalizedAtomic.registeredCapital)),
    employeesCount: cleanSupplierFieldText(toText(normalizedAtomic.employeesCount)),
    legalRepresentative: cleanSupplierFieldText(toText(normalizedAtomic.legalRepresentative)),
    newsSummary: cleanSupplierFieldText(toText(params.newsSummary)),
    status: 'success',
    errorMessage: '',
  }
}

function buildSupplierHtmlDiagnostics(html = '', pageUrl = '') {
  const page = String(html || '')
  const plain = decodeBasicHtmlEntities(stripHtml(page)).replace(/\s+/g, ' ').trim()
  const liAlistsCount = [...page.matchAll(/<li[^>]*class\s*=\s*["'][^"']*\balists\b[^"']*["'][^>]*>/gi)].length
  const trCount = [...page.matchAll(/<tr\b[^>]*>/gi)].length
  const companyLinkCount = [...page.matchAll(/(?:company\.php|free\.php)\?mid=\d+|\/oemhome\/\d+\.html|\/supplier\/\d+\/?(?:\?|["'])?/gi)].length
  return {
    pageTitle: extractTitle(page),
    pageTextLen: plain.length,
    liAlistsCount,
    trCount,
    companyLinkCount,
    pageUrl: toText(pageUrl),
  }
}

function isWafCaptchaHtml(html = '') {
  const page = String(html || '')
  if (!page) return false
  return /TencentCaptcha|TCaptcha\.js|\/WafCaptcha|seqid\s*=.*captcha/i.test(page)
}

function extractSupplierRowsFromCategoryHtml(html, listPageUrl, context = {}) {
  const page = String(html || '')
  const rows = []
  const trMatches = [...page.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  const seenKey = new Set()

  // qcgys/chinaautosupplier 列表主结构：li.alists
  const liMatches = [...page.matchAll(/<li[^>]*class\s*=\s*["'][^"']*\balists\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)]
  for (const li of liMatches) {
    const liHtml = String(li[0] || '')
    const companyFromOnclick = liHtml.match(/onclick\s*=\s*["'][^"']*location\.href\s*=\s*['"]([^'"]*company\.php\?mid=\d+[^'"]*)['"][^"']*["'][^>]*>\s*([^<]+)\s*<\/(?:span|a)>/i)
    const companyFromAnchor = liHtml.match(/<a[^>]*href\s*=\s*["']([^"']*(?:company\.php|free\.php)\?mid=\d+[^"']*)["'][^>]*>\s*([^<]+)\s*<\/a>/i)
    const companyHref = companyFromOnclick?.[1] || companyFromAnchor?.[1] || ''
    const companyName = companyFromOnclick?.[2] || companyFromAnchor?.[2] || ''
    if (!isLikelyCompanyName(companyName)) continue
    const qualitySystem = textByRegex(liHtml, /<span[^>]*class="s3"[^>]*>([\s\S]*?)<\/span>/i)
    const region = textByRegex(liHtml, /<span[^>]*class="s4"[^>]*>([\s\S]*?)<\/span>/i)
    const mainProducts = textByRegex(liHtml, /主要产品[:：]\s*([^<]+)/i)
    const fitExport = textByRegex(liHtml, /配套\/出口[:：]\s*([^<]+)/i)
    const detailHref = companyHref
      || textByRegex(liHtml, /<a[^>]*href="([^"]*free\.php\?mid=\d+[^"]*)"[^>]*>\s*查看\s*<\/a>/i)
    const row = buildSupplierSuccessRow({
      companyName,
      detailHref,
      blockText: decodeBasicHtmlEntities(stripHtml(liHtml)),
      mainProducts,
      fitExport,
      qualitySystem,
      region,
      contactAction: '查看/收藏',
      listPageUrl,
      context,
    })
    if (!row) continue
    const rowKey = `${row.companyName}@@${row.detailUrl}`
    if (seenKey.has(rowKey)) continue
    seenKey.add(rowKey)
    rows.push(row)
  }

  // gasgoo 企业卡片结构：dl + a.comName22 + /oemhome/{id}.html 或 /supplier/{id}/
  const dlMatches = [...page.matchAll(/<dl\b[^>]*>[\s\S]*?<\/dl>/gi)]
  for (const matched of dlMatches) {
    const dlHtml = String(matched[0] || '')
    const companyAnchor = dlHtml.match(/<a[^>]*class\s*=\s*["'][^"']*\bcomName22\b[^"']*["'][^>]*href\s*=\s*["']([^"']*(?:\/oemhome\/\d+\.html|\/supplier\/\d+\/?)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
      || dlHtml.match(/<a[^>]*href\s*=\s*["']([^"']*(?:\/oemhome\/\d+\.html|\/supplier\/\d+\/?)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
    const detailHref = toText(companyAnchor?.[1])
    const companyName = decodeBasicHtmlEntities(stripHtml(companyAnchor?.[2] || ''))
    if (!isLikelyCompanyName(companyName) || !isLikelySupplierDetailHref(detailHref)) continue
    const allSpans = [...dlHtml.matchAll(/<p[^>]*class\s*=\s*["'][^"']*\bfullCar\b[^"']*["'][^>]*>[\s\S]*?<\/p>/gi)]
      .flatMap((block) => [...String(block[0] || '').matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)])
      .map((item) => cleanSupplierFieldText(item?.[1] || ''))
      .filter(Boolean)
    const regionText = allSpans.find((item) => /所在地[:：]/.test(item)) || ''
    const capitalText = allSpans.find((item) => /注册资金[:：]/.test(item)) || ''
    const region = cleanSupplierFieldText(regionText.replace(/^.*?所在地[:：]\s*/i, '') || allSpans[0] || '')
    const registeredCapital = cleanSupplierFieldText(capitalText.replace(/^.*?注册资金[:：]\s*/i, '') || allSpans[1] || '')
    const brandText = textByRegex(dlHtml, /<p[^>]*class\s*=\s*["'][^"']*\bbltxt\b[^"']*["'][^>]*>\s*<strong>\s*品牌[:：]\s*<\/strong>\s*([\s\S]*?)<\/p>/i)
    const modelText = textByRegex(dlHtml, /<p[^>]*class\s*=\s*["'][^"']*\bbltxt\b[^"']*["'][^>]*>\s*<strong>\s*车型[:：]\s*<\/strong>\s*([\s\S]*?)<\/p>/i)
    const row = buildSupplierSuccessRow({
      companyName,
      detailHref,
      blockText: decodeBasicHtmlEntities(stripHtml(dlHtml)),
      brand: brandText,
      vehicleModel: modelText,
      mainProducts: [brandText && `品牌：${brandText}`, modelText && `车型：${modelText}`].filter(Boolean).join('；'),
      region,
      registeredCapital,
      contactAction: '查看',
      listPageUrl,
      context,
    })
    if (!row) continue
    const rowKey = `${row.companyName}@@${row.detailUrl}`
    if (seenKey.has(rowKey)) continue
    seenKey.add(rowKey)
    rows.push(row)
  }

  // gasgoo 整车厂全量索引（异步渲染到 #ManufacturerList）
  const oemIndexAnchors = [
    ...page.matchAll(/<div[^>]*id\s*=\s*["']ManufacturerList["'][^>]*>[\s\S]*?<\/div>/gi),
  ].flatMap((scope) => [...String(scope[0] || '').matchAll(/<a[^>]*href\s*=\s*["']([^"']*\/oemhome\/\d+\.html[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)])
  for (const anchor of oemIndexAnchors) {
    const detailHref = toText(anchor?.[1])
    const companyName = decodeBasicHtmlEntities(stripHtml(anchor?.[2] || ''))
    if (!isLikelyCompanyName(companyName) || !isLikelySupplierDetailHref(detailHref)) continue
    const row = buildSupplierSuccessRow({
      companyName,
      detailHref,
      blockText: companyName,
      contactAction: '查看',
      listPageUrl,
      context,
    })
    if (!row) continue
    const rowKey = `${row.companyName}@@${row.detailUrl}`
    if (seenKey.has(rowKey)) continue
    seenKey.add(rowKey)
    rows.push(row)
  }

  // gasgoo 供应商企业卡片结构：a.comName22 + /supplier/{id}/
  const gasgooSupplierCardAnchors = [
    ...page.matchAll(/<a[^>]*class\s*=\s*["'][^"']*\bcomName22\b[^"']*["'][^>]*href\s*=\s*["']([^"']*\/supplier\/\d+\/?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi),
    ...page.matchAll(/<a[^>]*href\s*=\s*["']([^"']*\/supplier\/\d+\/?[^"']*)["'][^>]*class\s*=\s*["'][^"']*\bcomName22\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi),
  ]
  for (const anchor of gasgooSupplierCardAnchors) {
    const detailHref = toText(anchor?.[1])
    const companyName = decodeBasicHtmlEntities(stripHtml(anchor?.[2] || ''))
    if (!isLikelyCompanyName(companyName) || !isLikelySupplierDetailHref(detailHref)) continue
    const supplierId = toText(detailHref.match(/\/supplier\/(\d+)/i)?.[1] || '')
    const aroundRegex = supplierId
      ? new RegExp(
        `<a[^>]*href\\s*=\\s*["'][^"']*\\/supplier\\/${escapeRegexText(supplierId)}\\/?[^"']*["'][^>]*>[\\s\\S]*?<\\/a>[\\s\\S]{0,1600}?(?:<p[^>]*>[\\s\\S]*?<\\/p>)`,
        'i',
      )
      : null
    const aroundHtml = aroundRegex ? String(page.match(aroundRegex)?.[0] || '') : ''
    const aroundPlain = cleanSupplierHtmlBlockText(aroundHtml)
    const regionFromCard = extractSupplierLabeledValue(aroundPlain, ['所在地', '所在地区', '地区', '地址'], 180)
    const capitalFromCard = extractSupplierLabeledValue(aroundPlain, ['注册资金', '注册资本'], 96)
    const establishedFromCard = extractSupplierLabeledValue(aroundPlain, ['成立时间', '成立日期'], 64)
    const row = buildSupplierSuccessRow({
      companyName,
      detailHref,
      blockText: aroundPlain || companyName,
      region: regionFromCard,
      registeredCapital: capitalFromCard,
      establishedDate: establishedFromCard,
      contactAction: '查看',
      listPageUrl,
      context,
    })
    if (!row) continue
    const rowKey = `${row.companyName}@@${row.detailUrl}`
    if (seenKey.has(rowKey)) continue
    seenKey.add(rowKey)
    rows.push(row)
  }

  for (const tr of trMatches) {
    const trHtml = String(tr[1] || '')
    if (!/查看\s*\/?\s*收藏|查看|收藏/i.test(trHtml)) continue
    const cellMatches = [...trHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    if (cellMatches.length < 1) continue
    const cellTexts = cellMatches.map((item) => decodeBasicHtmlEntities(stripHtml(item[1])))
    const companyCellHtml = String(cellMatches[1]?.[1] || cellMatches[0]?.[1] || '')
    const companyAnchor = [...companyCellHtml.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((item) => ({
        href: item[1],
        text: decodeBasicHtmlEntities(stripHtml(item[2])),
      }))
      .find((item) => isLikelyCompanyName(item.text) && isLikelySupplierDetailHref(item.href))
    if (!companyAnchor?.text) continue
    const mergedText = `${cellTexts.join(' | ')} | ${decodeBasicHtmlEntities(stripHtml(trHtml))}`
    const row = buildSupplierSuccessRow({
      companyName: companyAnchor.text,
      detailHref: companyAnchor.href,
      blockText: mergedText,
      mainProducts: textByRegex(companyCellHtml, /(?:主要产品|主营产品)[:：]\s*([^<]+)/i),
      fitExport: textByRegex(companyCellHtml, /(?:配套\/出口|配套出口|出口)[:：]\s*([^<]+)/i),
      qualitySystem: cellTexts.find((item) => /(ISO|IATF|VDA|QS|TS|9000|9001|16949)/i.test(item)) || '',
      region: cellTexts.find((item) => /(北京|上海|天津|重庆|省|市|自治区|香港|澳门|台湾)/.test(item)) || '',
      contactAction: cellTexts.find((item) => /查看|收藏/.test(item)) || '查看/收藏',
      listPageUrl,
      context,
    })
    if (!row) continue
    const rowKey = `${row.companyName}@@${row.detailUrl}`
    if (seenKey.has(rowKey)) continue
    seenKey.add(rowKey)
    rows.push(row)
  }

  // 兼容非表格列表结构，避免仅依赖 <tr><td> 模式
  const blockMatches = [...page.matchAll(/<(li|div)[^>]*>([\s\S]*?)<\/\1>/gi)]
  for (const block of blockMatches) {
    const blockHtml = String(block[0] || '')
    if (!/查看\s*\/?\s*收藏/i.test(blockHtml)) continue
    if (!/主要产品|主营产品|配套|出口|IATF|ISO/i.test(blockHtml)) continue
    const anchors = [...blockHtml.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((item) => ({
        href: item[1],
        text: decodeBasicHtmlEntities(stripHtml(item[2])),
      }))
      .filter((item) => isLikelyCompanyName(item.text))
    if (anchors.length === 0) continue
    const picked = anchors.find((item) => isLikelySupplierDetailHref(item.href)) || anchors[0]
    const row = buildSupplierSuccessRow({
      companyName: picked.text,
      detailHref: picked.href,
      blockText: decodeBasicHtmlEntities(stripHtml(blockHtml)),
      listPageUrl,
      context,
    })
    if (!row) continue
    const rowKey = `${row.companyName}@@${row.detailUrl}`
    if (seenKey.has(rowKey)) continue
    seenKey.add(rowKey)
    rows.push(row)
  }
  return rows
}

function extractSupplierTotalCountFromText(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ')
  const patterns = [
    /所有企业\s*(\d+)\s*家/i,
    /搜索到[^0-9]{0,20}(\d+)\s*家/i,
    /企业总数[^0-9]{0,10}(\d+)/i,
  ]
  for (const pattern of patterns) {
    const matched = raw.match(pattern)
    const num = Number(matched?.[1] || 0)
    if (Number.isInteger(num) && num > 0) return num
  }
  return 0
}

function extractSupplierTotalCountFromHtml(html = '') {
  const page = String(html || '')
  const manuMatched = page.match(/当前总数[^<]*<b>\s*(\d+)\s*<\/b>/i)
  if (manuMatched?.[1]) {
    const count = Number(manuMatched[1])
    if (Number.isInteger(count) && count > 0) return count
  }
  const searchedMatched = decodeBasicHtmlEntities(stripHtml(page)).match(/搜索到[:：]?.*?所有企业\s*(\d+)\s*家/i)
  if (searchedMatched?.[1]) {
    const count = Number(searchedMatched[1])
    if (Number.isInteger(count) && count > 0) return count
  }
  const text = decodeBasicHtmlEntities(stripHtml(page))
  return extractSupplierTotalCountFromText(text)
}

function extractSupplierPerPageFromHtml(html = '') {
  const page = String(html || '')
  const matched = page.match(/每页[^<]*<b>\s*(\d+)\s*<\/b>/i)
  const parsed = Number(matched?.[1] || 0)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

function extractSupplierPaginationUrlsFromHtml(html = '', currentUrl = '') {
  const urls = new Set()
  const page = String(html || '')
  const pageScopes = [
    ...page.matchAll(/<div[^>]*class="[^"]*\bmanu\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi),
  ].map((item) => String(item[0] || ''))
  const scopedHtml = pageScopes.length > 0 ? pageScopes.join('\n') : page
  const anchorRegex = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let matched = anchorRegex.exec(page)
  while (matched) {
    const href = String(matched[1] || '').trim()
    const label = decodeBasicHtmlEntities(stripHtml(matched[2] || '')).replace(/\s+/g, '')
    const likelyPageLabel = /^(上一页|下一页|上页|下页|尾页|末页|首页|>\>?|<<?|\d{1,4})$/.test(label)
    const likelyPageHref = /(?:^|[?&])(page|p|pg|pn)=\d+/i.test(href) || /page\d+|\/\d+\.html/i.test(href)
    if (href && (likelyPageLabel || likelyPageHref)) {
      try {
        const abs = new URL(href, currentUrl).toString()
        if (abs !== currentUrl) urls.add(abs)
      } catch {
        // ignore invalid page url
      }
    }
    matched = anchorRegex.exec(page)
  }
  if (pageScopes.length > 0) {
    anchorRegex.lastIndex = 0
    urls.clear()
    matched = anchorRegex.exec(scopedHtml)
    while (matched) {
      const href = String(matched[1] || '').trim()
      const label = decodeBasicHtmlEntities(stripHtml(matched[2] || '')).replace(/\s+/g, '')
      const likelyPageLabel = /^(上一页|下一页|上页|下页|尾页|末页|首页|>\>?|<<?|\d{1,4})$/.test(label)
      const likelyPageHref = /(?:^|[?&])(page|p|pg|pn)=\d+/i.test(href) || /page\d+|\/\d+\.html/i.test(href)
      if (href && (likelyPageLabel || likelyPageHref)) {
        try {
          const abs = new URL(href, currentUrl).toString()
          if (abs !== currentUrl) urls.add(abs)
        } catch {
          // ignore invalid page url
        }
      }
      matched = anchorRegex.exec(scopedHtml)
    }
  }
  const scriptPageMatches = [...page.matchAll(/goPage\((\d{1,4})\)/gi)]
  for (const item of scriptPageMatches) {
    const pageNo = Number(item[1] || 0)
    if (!Number.isInteger(pageNo) || pageNo <= 1) continue
    for (const param of ['page', 'p', 'pg', 'pn']) {
      try {
        const next = new URL(currentUrl)
        next.searchParams.set(param, String(pageNo))
        urls.add(next.toString())
      } catch {
        // ignore
      }
    }
  }
  // gasgoo 整车厂分页：/supplier/oem/index-{n}.html
  const oemPageNums = [...page.matchAll(/\/supplier\/oem\/index-(\d{1,4})\.html/gi)]
    .map((item) => Number(item?.[1] || 0))
    .filter((n) => Number.isInteger(n) && n >= 2 && n <= 300)
  if (oemPageNums.length > 0 || isGasgooOemListUrl(currentUrl)) {
    const detectedMaxPage = oemPageNums.length > 0 ? Math.max(...oemPageNums) : 1
    // Gasgoo OEM 列表常只渲染前几页数字，先保底补齐到 15 页，避免第一页后断流。
    const targetMaxPage = isGasgooOemListUrl(currentUrl)
      ? Math.max(detectedMaxPage, 15)
      : detectedMaxPage
    for (let pageNo = 2; pageNo <= targetMaxPage; pageNo += 1) {
      try {
        urls.add(new URL(`/supplier/oem/index-${pageNo}.html`, currentUrl).toString())
      } catch {
        // ignore invalid url
      }
    }
  }
  return [...urls]
}

function extractGasgooSupplierCategoryKey(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    if (!/(^|\.)gasgoo\.com$/i.test(parsed.hostname || '')) return ''
    const pathname = String(parsed.pathname || '').toLowerCase()
    let matched = pathname.match(/^\/supplier\/(c-\d+)(?:-[^\/.]*)?\.html$/i)
    if (matched?.[1]) return String(matched[1]).toLowerCase()
    matched = pathname.match(/^\/supplier\/(c-\d+)(?:-[^\/]*)\/index-\d+\.html$/i)
    if (matched?.[1]) return String(matched[1]).toLowerCase()
    matched = pathname.match(/^\/supplier\/(c-\d+)(?:-[^\/]*)\/?$/i)
    if (matched?.[1]) return String(matched[1]).toLowerCase()
    return ''
  } catch {
    return ''
  }
}

function buildSupplierPaginationPageKey(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    const gasgooCategoryKey = extractGasgooSupplierCategoryKey(urlText)
    if (gasgooCategoryKey) {
      const pageNoMatched = String(parsed.pathname || '').match(/\/index-(\d+)\.html$/i)
      const pageNo = Number(pageNoMatched?.[1] || 1)
      const normalizedPageNo = Number.isInteger(pageNo) && pageNo > 0 ? pageNo : 1
      return `gasgoo:${parsed.host.toLowerCase()}:${gasgooCategoryKey}:${normalizedPageNo}`
    }
    return parsed.toString()
  } catch {
    return String(urlText || '').trim()
  }
}

function isSameSupplierCategoryUrl(baseUrl = '', candidateUrl = '') {
  try {
    const base = new URL(baseUrl)
    const candidate = new URL(candidateUrl)
    if (base.host !== candidate.host) return false
    const baseGasgooCategoryKey = extractGasgooSupplierCategoryKey(baseUrl)
    const candidateGasgooCategoryKey = extractGasgooSupplierCategoryKey(candidateUrl)
    if (baseGasgooCategoryKey && candidateGasgooCategoryKey) {
      return baseGasgooCategoryKey === candidateGasgooCategoryKey
    }
    const isGasgooOemPath = (pathname = '') => /^\/supplier\/oem(?:\.html|\/index-\d+\.html)?$/i.test(pathname || '')
    if (isGasgooOemPath(base.pathname) && isGasgooOemPath(candidate.pathname)) {
      return true
    }
    if (base.pathname !== candidate.pathname) return false
    for (const key of ['cid', 'pid', 'catid']) {
      const baseVal = base.searchParams.get(key) || ''
      const candidateVal = candidate.searchParams.get(key) || ''
      if (baseVal && candidateVal && baseVal !== candidateVal) return false
    }
    return true
  } catch {
    return false
  }
}

function buildSyntheticPaginationUrls(baseUrl = '', totalCount = 0, firstPageRows = 0) {
  const generated = []
  const perPage = Math.min(100, Math.max(1, Number(firstPageRows || 10)))
  const totalPages = Math.ceil(Math.max(0, Number(totalCount || 0)) / perPage)
  if (!totalPages || totalPages <= 1) return generated
  const params = ['page', 'p', 'pg', 'pn']
  for (let pageNo = 2; pageNo <= Math.min(totalPages, 120); pageNo += 1) {
    for (const param of params) {
      try {
        const next = new URL(baseUrl)
        next.searchParams.set(param, String(pageNo))
        generated.push(next.toString())
      } catch {
        // ignore invalid url
      }
    }
  }
  return [...new Set(generated)]
}

function isGasgooOemListUrl(urlText = '') {
  try {
    const parsed = new URL(String(urlText || '').trim())
    if (!/(^|\.)gasgoo\.com$/i.test(parsed.hostname)) return false
    return /^\/supplier\/oem(?:\.html|\/index-\d+\.html)?$/i.test(parsed.pathname || '')
  } catch {
    return false
  }
}

function buildGasgooOemPaginationUrls(baseUrl = '', maxPage = 15) {
  const generated = []
  const upper = Math.max(2, Math.min(80, Number(maxPage || 15)))
  try {
    const parsed = new URL(baseUrl)
    const root = `${parsed.protocol}//${parsed.host}`
    for (let pageNo = 2; pageNo <= upper; pageNo += 1) {
      generated.push(`${root}/supplier/oem/index-${pageNo}.html`)
    }
  } catch {
    // ignore invalid base url
  }
  return [...new Set(generated)]
}

function extractSupplierDetailFromHtml(html = '', detailUrl = '') {
  const plain = decodeBasicHtmlEntities(stripHtml(String(html || ''))).replace(/\s+/g, ' ').trim()
  const pageTabKey = classifySupplierDetailTab('', detailUrl)
  const title = extractTitle(html) || ''
  const introSectionBlocks = extractSupplierTitledSectionHtmlBlocks(html, ['公司简介', '企业简介', '企业介绍'])
  const productSectionBlocks = extractSupplierTitledSectionHtmlBlocks(html, ['产品展示', '重点产品', '主要产品', '主营产品', '产品分类'])
  const fitSectionBlocks = extractSupplierTitledSectionHtmlBlocks(html, ['配套情况', '配套说明'])
  const exportSectionBlocks = extractSupplierTitledSectionHtmlBlocks(html, ['出口情况', '出口国家'])
  const certSectionBlocks = extractSupplierTitledSectionHtmlBlocks(html, ['企业证书', '认证体系', '认证说明'])
  const contactSectionBlocks = extractSupplierTitledSectionHtmlBlocks(html, ['联系我们', '联系方式', '基本信息'])
  const introFromSection = extractSupplierIntroContentFromHtml(html, pageTabKey)
    || introSectionBlocks
      .map((block) => extractSupplierIntroContentFromHtml(block, 'intro') || cleanSupplierHtmlBlockText(block))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0]
    || ''
  const homeProductNames = [
    ...extractSupplierListItemsFromHtmlBlock(
      html,
      /<div[^>]*class=["'][^"']*\bdianpu_l_list\b[^"']*["'][^>]*>[\s\S]*?<span>\s*重点产品\s*<\/span>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i,
    ),
    ...extractSupplierProductNamesFromHtml(html),
    ...productSectionBlocks.flatMap((block) => extractSupplierProductNamesFromHtml(block)),
  ]
  const contactSectionText = contactSectionBlocks
    .map((block) => cleanSupplierHtmlBlockText(block))
    .filter(Boolean)
    .join('；')
  const fitSectionText = fitSectionBlocks
    .map((block) => cleanSupplierHtmlBlockText(block))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || ''
  const exportSectionText = exportSectionBlocks
    .map((block) => cleanSupplierHtmlBlockText(block))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || ''
  const certSectionText = certSectionBlocks
    .map((block) => cleanSupplierHtmlBlockText(block))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || ''
  const qualityItems = extractSupplierListItemsFromHtmlBlock(
    html,
    /<ul[^>]*class=["'][^"']*\buliso\b[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i,
  )
  const newsItems = extractSupplierListItemsFromHtmlBlock(
    html,
    /<h4[^>]*class=["'][^"']*\bright_title\b[^"']*["'][^>]*>[\s\S]*?<span>\s*新闻发布\s*<\/span>[\s\S]*?<\/h4>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i,
  )
  const detailedNewsItems = extractSupplierNewsItemsFromHtml(html, detailUrl)
  const phoneFromSection = cleanSupplierFieldText(
    textByRegex(html, /<i>\s*电话[:：]?\s*<\/i>\s*<em>([\s\S]*?)<\/em>/i)
      || textByRegex(contactSectionText, /(?:电话|座机|热线)[:：]?\s*([0-9\-()（）]{7,24})/i),
  )
  const emailFromSection = cleanSupplierFieldText(
    textByRegex(html, /<i>\s*Email[:：]?\s*<\/i>\s*<em>([\s\S]*?)<\/em>/i)
      || textByRegex(contactSectionText, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i),
  )
  const websiteFromSection = cleanSupplierFieldText(
    textByRegex(html, /<i>\s*网址[:：]?\s*<\/i>\s*<em>([\s\S]*?)<\/em>/i)
      || textByRegex(contactSectionText, /(?:网址|网站|官网)[:：]?\s*((?:https?:\/\/|www\.)[^\s；;，,]+)/i),
  )
  const addressFromSection = cleanSupplierFieldText(
    textByRegex(html, /<i>\s*地址[:：]?\s*<\/i>\s*<span[^>]*>([\s\S]*?)<\/span>/i)
      || textByRegex(contactSectionText, /(?:地址|所在地)[:：]?\s*([^；;\n\r]{4,160})/i),
  )
  const locationFromSpan = cleanSupplierFieldText(
    extractSupplierSpanLabeledValue(html, ['所在地', '所在地区', '地区', '省份', '城市'], 180),
  )
  const registeredCapitalFromSpan = cleanSupplierFieldText(
    extractSupplierSpanLabeledValue(html, ['注册资金', '注册资本'], 96),
  )
  const establishedDateFromSpan = cleanSupplierFieldText(
    extractSupplierSpanLabeledValue(html, ['成立时间', '成立日期'], 64),
  )
  const contactFromSection = cleanSupplierFieldText(
    [contactSectionText, phoneFromSection, emailFromSection, websiteFromSection, addressFromSection].filter(Boolean).join('；'),
  )
  const fitSituationFromSection = cleanSupplierFieldText(
    textByRegex(
      html,
      /<h4[^>]*class=["'][^"']*\bright_title\b[^"']*["'][^>]*>[\s\S]*?<span>\s*配套情况\s*<\/span>[\s\S]*?<\/h4>[\s\S]*?<div[^>]*class=["'][^"']*\bqingkuang\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ),
  ) || fitSectionText
  const exportSituationFromSection = cleanSupplierFieldText(
    textByRegex(
      html,
      /<h4[^>]*class=["'][^"']*\bright_title\b[^"']*["'][^>]*>[\s\S]*?<span>\s*出口情况\s*<\/span>[\s\S]*?<\/h4>[\s\S]*?<div[^>]*class=["'][^"']*\bqingkuang\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ),
  ) || exportSectionText
  const companyName = sanitizeSupplierCompanyName(
    textByRegex(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)
    || textByRegex(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
    || title,
  )
  const mainProducts = (homeProductNames.length > 0 ? homeProductNames.join('；') : '')
    || extractSupplierLabeledValue(plain, ['重点产品', '主要产品', '主营产品', '产品展示'], 360)
    || cleanSupplierFieldText(textByRegex(plain, /(?:重点产品|主要产品|主营产品|产品展示)[:：]?\s*([^。；;]{2,300})/i))
  const fitExport = extractSupplierLabeledValue(plain, ['配套/出口', '配套出口', '配套情况', '出口情况', '出口国家', '出口'], 240)
    || cleanSupplierFieldText(textByRegex(plain, /(?:配套\s*\/?\s*出口|配套出口|出口)[:：]?\s*([^。；;]{2,200})/i))
  const fitSituation = cleanSupplierFieldText(
    fitSituationFromSection
    || extractSupplierLabeledValue(plain, ['配套情况', '配套说明', '配套'], 600)
    || (pageTabKey === 'fit' ? fitExport : ''),
  )
  const exportSituation = cleanSupplierFieldText(
    exportSituationFromSection
    || extractSupplierLabeledValue(plain, ['出口情况', '出口国家', '出口'], 600)
    || (pageTabKey === 'export' ? fitExport : ''),
  )
  const qualitySystem = (qualityItems.length > 0 ? qualityItems.join('；') : '')
    || extractSupplierLabeledValue(plain, ['质量体系', '认证体系', '企业证书'], 120)
    || cleanSupplierFieldText(textByRegex(plain, /((?:IATF|ISO|VDA|QS|TS)[^。；;]{0,120})/i))
  const certificates = cleanSupplierFieldText(
    textByRegex(
      html,
      /<h4[^>]*class=["'][^"']*\bright_title\b[^"']*["'][^>]*>[\s\S]*?<span>\s*企业证书\s*<\/span>[\s\S]*?<\/h4>[\s\S]*?<div[^>]*class=["'][^"']*\bqingkuang\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ),
  ) || certSectionText
    || extractSupplierLabeledValue(plain, ['认证体系', '认证说明', '企业证书'], 400)
  const region = locationFromSpan
    || addressFromSection
    || extractSupplierLabeledValue(plain, ['地区', '所在地', '地址'], 180)
    || cleanSupplierFieldText(textByRegex(plain, /((?:北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)[^。；;]{0,40})/i))
  const contactAction = contactFromSection
    || extractSupplierLabeledValue(plain, ['联系方式', '联系人', '电话', '手机', '邮箱'], 220)
    || cleanSupplierFieldText(textByRegex(plain, /(?:联系方式|联系人|电话|手机|邮箱)[:：]?\s*([^。；;]{2,120})/i))
  const companyType = extractSupplierLabeledValue(plain, ['公司性质', '企业性质', '企业类型', '公司类型'], 80)
  const orgCode = extractSupplierLabeledValue(plain, ['机构代码', '组织机构代码', '统一社会信用代码'], 64)
  const establishedDate = establishedDateFromSpan || extractSupplierLabeledValue(plain, ['成立日期', '成立时间'], 64)
  const registeredCapital = registeredCapitalFromSpan || extractSupplierLabeledValue(plain, ['注册资本', '注册资金'], 96)
  const legalRepresentative = extractSupplierLabeledValue(plain, ['法人代表', '法定代表人'], 64)
  const employeesCount = extractSupplierLabeledValue(plain, ['单位人数', '员工人数', '人数'], 48)
  const companyIntro = introFromSection
    || extractSupplierLabeledValue(plain, ['公司简介', '企业简介', '企业介绍'], 800)
    || cleanSupplierFieldText(
      textByRegex(plain, /(?:公司简介|企业简介|企业介绍)[:：]?\s*([^]{0,400}?)(?:联系方式|联系人|电话|地址|主要产品|主营产品|$)/i),
    )
  const newsTitleFallback = cleanSupplierFieldText(
    textByRegex(html, /<a[^>]*>([^<]{8,120}(?:新闻|资讯|发布|表彰会|大会|活动|项目)[^<]{0,60})<\/a>/i),
  )
  const newsSummary = (newsItems.length > 0 ? newsItems.slice(0, 4).join('；') : '')
    || cleanSupplierFieldText(
    textByRegex(plain, /(?:新闻发布|新闻|公司新闻|资讯)[:：]?\s*([^]{0,260})/i),
  ) || newsTitleFallback
  const normalized = normalizeSupplierDetailAtomicFields({
    companyName: toText(companyName),
    mainProducts: toText(mainProducts),
    fitSituation: toText(fitSituation),
    exportSituation: toText(exportSituation),
    fitExport: toText(fitExport),
    qualitySystem: toText(qualitySystem),
    region: toText(region),
    contactAction: toText(contactAction),
    companyIntro: toText(companyIntro),
    companyType: toText(companyType),
    orgCode: toText(orgCode),
    establishedDate: toText(establishedDate),
    registeredCapital: toText(registeredCapital),
    employeesCount: toText(employeesCount),
    legalRepresentative: toText(legalRepresentative),
    newsSummary: toText(newsSummary),
    detailUrl,
  })
  normalized.companyIntro = cleanSupplierFieldText(normalized.companyIntro)
  if (/(?:配套情况|配套说明|出口情况|出口国家|认证体系|认证说明|企业证书|公司视频|公司新闻|新闻发布|联系方式|联系人|电话|手机|邮箱)[:：]/.test(normalized.companyIntro)) normalized.companyIntro = ''
  normalized.mainProducts = dedupeSupplierProductNames(splitSupplierTextTokens(normalized.mainProducts)).join('；')
  normalized.certificates = sanitizeSupplierCertificatesText(certificates)
  normalized.website = cleanSupplierFieldText(websiteFromSection)
  normalized.address = cleanSupplierFieldText(addressFromSection)
  normalized.newsItems = detailedNewsItems
  if (looksLikeSupplierTabMenuNoise(normalized.companyIntro)) normalized.companyIntro = ''
  if (looksLikeSupplierTabMenuNoise(normalized.mainProducts)) normalized.mainProducts = ''
  if (looksLikeSupplierTabMenuNoise(normalized.fitExport)) normalized.fitExport = ''
  normalized.fitSituation = sanitizeSupplierTabFieldValue(normalized.fitSituation, ['配套情况', '配套说明', '配套'])
  normalized.exportSituation = sanitizeSupplierTabFieldValue(normalized.exportSituation, ['出口情况', '出口国家', '出口'])
  if (hasSupplierFieldPollution(normalized.fitExport, ['配套/出口', '配套出口', '配套情况', '出口情况', '出口国家', '出口'])) {
    normalized.fitExport = ''
  }
  if (looksLikeSupplierTabMenuNoise(normalized.fitExport) || /收藏企业|公司简介|重点产品|公司新闻|公司视频|联系我们/.test(normalized.fitExport)) {
    normalized.fitExport = ''
  }
  if (looksLikeSupplierTabMenuNoise(normalized.companyType) || /收藏企业|公司简介|重点产品|公司新闻|公司视频|联系我们/.test(normalized.companyType)) {
    normalized.companyType = cleanSupplierFieldText(
      textByRegex(normalized.companyType, /(股份制|民营|国有|合资|外资|三资|私营|股份有限公司|有限责任公司)/i),
    )
  }
  if (hasSupplierFieldPollution(normalized.newsSummary, ['新闻发布', '新闻', '公司新闻', '资讯'])) {
    normalized.newsSummary = ''
  }
  if (/公司视频/.test(normalized.qualitySystem) && !/(IATF|ISO|VDA|QS|TS|认证|证书)/i.test(normalized.qualitySystem)) {
    normalized.qualitySystem = ''
  }
  return normalized
}

async function fetchSupplierDetailAggregateByHttp(detailUrl, options = {}) {
  const homepageOnly = normalizeSupplierHomepageOnly(options?.homepageOnly)
  let detail = {}
  const snapshots = []
  const fetchedUrls = new Set()
  const queuedUrls = new Set()
  const queue = []
  const enqueueTabUrl = (url, label = '') => {
    const normalized = toText(url)
    if (!normalized || fetchedUrls.has(normalized) || queuedUrls.has(normalized)) return
    queuedUrls.add(normalized)
    queue.push({ url: normalized, label })
  }
  const mergeParsedDetail = (parsedDetail, tabKey = '') => {
    if (parsedDetail.companyName && isLikelyCompanyName(parsedDetail.companyName)) {
      detail.companyName = parsedDetail.companyName
    }
    if (toText(parsedDetail.certificates)) {
      detail.certificates = cleanSupplierFieldText(toText(parsedDetail.certificates))
    }
    if (Array.isArray(parsedDetail.newsItems) && parsedDetail.newsItems.length > 0) {
      detail.newsItems = parseSupplierNewsItems(parsedDetail.newsItems)
    }
    if (tabKey === 'intro') {
      applySupplierDetailField(detail, 'companyIntro', parsedDetail.companyIntro)
    } else if (tabKey === 'goods') {
      applySupplierDetailField(detail, 'mainProducts', parsedDetail.mainProducts)
    } else if (tabKey === 'fit' || tabKey === 'export') {
      if (tabKey === 'fit') {
        applySupplierDetailField(detail, 'fitSituation', parsedDetail.fitSituation || parsedDetail.fitExport)
      } else {
        applySupplierDetailField(detail, 'exportSituation', parsedDetail.exportSituation || parsedDetail.fitExport)
      }
    }
    applySupplierDetailField(detail, 'mainProducts', parsedDetail.mainProducts)
    applySupplierDetailField(detail, 'fitSituation', parsedDetail.fitSituation)
    applySupplierDetailField(detail, 'exportSituation', parsedDetail.exportSituation)
    applySupplierDetailField(
      detail,
      'fitExport',
      cleanSupplierFieldText([
        toText(detail.fitSituation),
        toText(detail.exportSituation),
        parsedDetail.fitExport,
      ].filter(Boolean).join('；')),
    )
    applySupplierDetailField(detail, 'qualitySystem', parsedDetail.qualitySystem)
    applySupplierDetailField(detail, 'region', parsedDetail.region)
    applySupplierDetailField(detail, 'contactAction', parsedDetail.contactAction)
    applySupplierDetailField(detail, 'companyIntro', parsedDetail.companyIntro)
    applySupplierDetailField(detail, 'companyType', parsedDetail.companyType)
    applySupplierDetailField(detail, 'orgCode', parsedDetail.orgCode)
    applySupplierDetailField(detail, 'establishedDate', parsedDetail.establishedDate)
    applySupplierDetailField(detail, 'registeredCapital', parsedDetail.registeredCapital)
    applySupplierDetailField(detail, 'employeesCount', parsedDetail.employeesCount)
    applySupplierDetailField(detail, 'legalRepresentative', parsedDetail.legalRepresentative)
    applySupplierDetailField(detail, 'newsSummary', parsedDetail.newsSummary)
    const normalizedDetail = normalizeSupplierDetailAtomicFields(detail)
    normalizedDetail.certificates = cleanSupplierFieldText(toText(detail.certificates))
    normalizedDetail.newsItems = Array.isArray(detail.newsItems) ? parseSupplierNewsItems(detail.newsItems) : []
    detail = normalizedDetail
  }

  enqueueTabUrl(detailUrl, '首页')
  if (!homepageOnly) {
    for (const candidate of buildSupplierDetailTabUrls(detailUrl)) {
      enqueueTabUrl(candidate, '')
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()
    const currentUrl = toText(current?.url)
    if (!currentUrl || fetchedUrls.has(currentUrl)) continue
    fetchedUrls.add(currentUrl)
    const detailFetched = await fetchTextWithRetries(currentUrl, supplierHttpTimeoutMs, supplierHttpRetryCount)
    const tabKey = classifySupplierDetailTab(current?.label || '', currentUrl)
    const parsed = isGasgooSupplierUrl(currentUrl)
      ? extractGasgooSupplierOverviewFromHtml(detailFetched.text, currentUrl)
      : extractSupplierDetailFromHtml(detailFetched.text, currentUrl)
    mergeParsedDetail(parsed, tabKey)
    snapshots.push({
      label: current?.label || currentUrl,
      url: currentUrl,
      html: detailFetched.text,
      plain: decodeBasicHtmlEntities(stripHtml(String(detailFetched.text || ''))).replace(/\s+/g, ' ').trim(),
    })
    if (!homepageOnly) {
      for (const discovered of discoverSupplierDetailTabLinksFromHtml(detailFetched.text, currentUrl)) {
        enqueueTabUrl(discovered.url, discovered.label || discovered.tabKey || '')
      }
      if (!tabKey || tabKey === 'home') {
        for (const candidate of buildSupplierDetailTabUrls(currentUrl)) {
          enqueueTabUrl(candidate, '')
        }
      }
    }
  }

  if (snapshots.length === 0) {
    throw new Error('detail snapshots empty')
  }

  return {
    detail,
    snapshots,
    mergedHtml: snapshots
      .map((snap) => `<!-- TAB:${snap.label} URL:${snap.url} -->\n${snap.html}`)
      .join('\n\n'),
    mergedPlain: snapshots.map((snap) => snap.plain).filter(Boolean).join(' '),
  }
}

async function enrichSupplierRowsByDetailPages(rows, task, nowText, options = {}) {
  const homepageOnly = normalizeSupplierHomepageOnly(options?.homepageOnly || task?.homepageOnly)
  const result = Array.isArray(rows) ? rows : []
  const hasListCoreFields = (row = {}) => Boolean(
    toText(row.region)
    && toText(row.registeredCapital)
    && toText(row.establishedDate),
  )
  let skippedByListFieldCount = 0
  const candidates = result
    .map((row, index) => ({ row, index }))
    .filter((item) => {
      if (!item.row?.detailUrl || item.row.status !== 'success') return false
      if (hasListCoreFields(item.row)) {
        skippedByListFieldCount += 1
        return false
      }
      return true
    })
  const candidatesCount = candidates.length
  if (task?.runLogs) {
    task.runLogs.push(`${nowText()} | 详情补全启动：待补全 ${candidatesCount} 条，并发 ${supplierDetailConcurrency}`)
    if (skippedByListFieldCount > 0) {
      task.runLogs.push(`${nowText()} | 详情补全跳过：列表页字段已齐全 ${skippedByListFieldCount} 条（所在地/注册资金/成立时间）`)
    }
  }
  let resolvedCount = 0
  let failedCount = 0
  let completedCount = 0
  let abortedByCancel = false

  const processCandidate = async (candidate) => {
    const row = candidate?.row
    if (!row?.detailUrl || row.status !== 'success') return
    if (task?.cancelRequested) {
      abortedByCancel = true
      return
    }
    const startedAt = Date.now()
    const originDetailUrl = row.detailUrl
    const detailCandidates = buildSupplierDetailUrlCandidates(row.detailUrl)
    let lastError = ''
    let resolved = false
    try {
      await withTimeout((async () => {
        for (const detailUrl of detailCandidates) {
          if (task?.cancelRequested) {
            abortedByCancel = true
            return
          }
          try {
            let { detail, mergedHtml, mergedPlain } = await fetchSupplierDetailAggregateByHttp(detailUrl, { homepageOnly })
            const llmDetail = await extractSupplierDetailByLlm({
              html: mergedHtml,
              plain: mergedPlain,
              detailUrl,
              model: task?.model || 'gpt-5.4',
            })
            detail = mergeSupplierDetailWithLlm(detail, llmDetail)
            if (!hasSupplierCriticalEnrichment(detail)) {
              const playwrightData = await withTimeout(
                extractSupplierDetailDataByPlaywright(detailUrl, {
                  skill: task?.skill || '',
                  model: task?.model || '',
                  nodeId: task?.nodeId || null,
                  nodeName: task?.nodeName || '',
                }),
                supplierDetailPlaywrightTimeoutMs,
                'playwright enrich fallback timeout',
              )
              const llmDetailByPlaywright = await extractSupplierDetailByLlm({
                html: `${mergedHtml || ''}\n\n${playwrightData.html || ''}`.trim(),
                plain: `${mergedPlain || ''} ${playwrightData.plain || ''}`.trim(),
                detailUrl: toText(playwrightData.finalUrl) || detailUrl,
                model: task?.model || 'gpt-5.4',
              })
              detail = mergeSupplierDetailWithLlm(detail, playwrightData.detail || {})
              detail = mergeSupplierDetailWithLlm(detail, llmDetailByPlaywright)
            }
            if (!hasSupplierCriticalEnrichment(detail)) {
              lastError = '详情页可访问但关键字段为空（主营产品/注册资本/成立时间/所在地）'
              continue
            }
            if (detail.companyName && isLikelyCompanyName(detail.companyName)) row.companyName = detail.companyName
            applySupplierDetailField(row, 'mainProducts', detail.mainProducts)
            applySupplierDetailField(row, 'fitSituation', detail.fitSituation)
            applySupplierDetailField(row, 'exportSituation', detail.exportSituation)
            applySupplierDetailField(row, 'fitExport', detail.fitExport)
            applySupplierDetailField(row, 'qualitySystem', detail.qualitySystem)
            applySupplierDetailField(row, 'region', detail.region)
            applySupplierDetailField(row, 'contactAction', detail.contactAction)
            applySupplierDetailField(row, 'companyIntro', detail.companyIntro)
            applySupplierDetailField(row, 'companyType', detail.companyType)
            applySupplierDetailField(row, 'orgCode', detail.orgCode)
            applySupplierDetailField(row, 'establishedDate', detail.establishedDate)
            applySupplierDetailField(row, 'registeredCapital', detail.registeredCapital)
            applySupplierDetailField(row, 'employeesCount', detail.employeesCount)
            applySupplierDetailField(row, 'legalRepresentative', detail.legalRepresentative)
            applySupplierDetailField(row, 'newsSummary', detail.newsSummary)
            const brandVehicle = extractGasOemBrandVehicleFromText(
              [toText(detail.brand), toText(detail.vehicleModel), toText(row.mainProducts), toText(detail.mainProducts)].filter(Boolean).join('；'),
            )
            if (!toText(row.brand)) row.brand = brandVehicle.brand
            if (!toText(row.vehicleModel)) row.vehicleModel = brandVehicle.vehicleModel
            row.detailUrl = detailUrl
            resolved = true
            break
          } catch (error) {
            const errorMessage = error?.message || 'unknown error'
            if (/HTTP 403|验证码|captcha|WafCaptcha|TencentCaptcha/i.test(errorMessage)) {
              try {
                const playwrightData = await withTimeout(
                  extractSupplierDetailDataByPlaywright(detailUrl, {
                    skill: task?.skill || '',
                    model: task?.model || '',
                    nodeId: task?.nodeId || null,
                    nodeName: task?.nodeName || '',
                  }),
                  supplierDetailPlaywrightTimeoutMs,
                  'playwright enrich rescue timeout',
                )
                const llmDetailByPlaywright = await extractSupplierDetailByLlm({
                  html: toText(playwrightData.html),
                  plain: toText(playwrightData.plain),
                  detailUrl: toText(playwrightData.finalUrl) || detailUrl,
                  model: task?.model || 'gpt-5.4',
                })
                const merged = mergeSupplierDetailWithLlm(playwrightData.detail || {}, llmDetailByPlaywright)
                if (!hasSupplierAtomicEnrichment(merged)) {
                  lastError = `${errorMessage}；Playwright 回退后关键字段仍为空`
                  continue
                }
                if (merged.companyName && isLikelyCompanyName(merged.companyName)) row.companyName = merged.companyName
                applySupplierDetailField(row, 'mainProducts', merged.mainProducts)
                applySupplierDetailField(row, 'fitSituation', merged.fitSituation)
                applySupplierDetailField(row, 'exportSituation', merged.exportSituation)
                applySupplierDetailField(row, 'fitExport', merged.fitExport)
                applySupplierDetailField(row, 'qualitySystem', merged.qualitySystem)
                applySupplierDetailField(row, 'region', merged.region)
                applySupplierDetailField(row, 'contactAction', merged.contactAction)
                applySupplierDetailField(row, 'companyIntro', merged.companyIntro)
                applySupplierDetailField(row, 'companyType', merged.companyType)
                applySupplierDetailField(row, 'orgCode', merged.orgCode)
                applySupplierDetailField(row, 'establishedDate', merged.establishedDate)
                applySupplierDetailField(row, 'registeredCapital', merged.registeredCapital)
                applySupplierDetailField(row, 'employeesCount', merged.employeesCount)
                applySupplierDetailField(row, 'legalRepresentative', merged.legalRepresentative)
                applySupplierDetailField(row, 'newsSummary', merged.newsSummary)
                const brandVehicle = extractGasOemBrandVehicleFromText(
                  [toText(merged.brand), toText(merged.vehicleModel), toText(row.mainProducts), toText(merged.mainProducts)].filter(Boolean).join('；'),
                )
                if (!toText(row.brand)) row.brand = brandVehicle.brand
                if (!toText(row.vehicleModel)) row.vehicleModel = brandVehicle.vehicleModel
                row.detailUrl = toText(playwrightData.finalUrl) || detailUrl
                resolved = true
                break
              } catch (pwError) {
                lastError = `${errorMessage}；Playwright 回退失败：${pwError?.message || 'unknown error'}`
              }
            } else {
              lastError = errorMessage
            }
          }
        }
      })(), supplierDetailRowTimeoutMs, '详情补全单条超时')
    } catch (rowError) {
      if (!lastError) {
        lastError = rowError?.message || '详情补全单条失败'
      }
    }

    if (resolved) {
      resolvedCount += 1
    } else {
      failedCount += 1
      if (lastError) {
        task?.runLogs?.push(`${nowText()} | 详情页抓取失败：${originDetailUrl}，${lastError}`)
      }
    }

    completedCount += 1
    if (task?.runLogs) {
      const elapsedMs = Date.now() - startedAt
      const targetName = sanitizeSupplierCompanyName(toText(row.companyName)) || originDetailUrl
      const statusText = resolved ? '成功' : '失败'
      task.runLogs.push(`${nowText()} | 详情补全进度：${completedCount}/${candidatesCount}（${statusText}，耗时 ${elapsedMs}ms，${targetName}）`)
    }
  }

  for (let start = 0; start < candidates.length; start += supplierDetailConcurrency) {
    if (task?.cancelRequested) {
      abortedByCancel = true
      break
    }
    const chunk = candidates.slice(start, start + supplierDetailConcurrency)
    await Promise.all(chunk.map((item) => processCandidate(item)))
  }

  if (abortedByCancel && task?.runLogs) {
    task.runLogs.push(`${nowText()} | 详情补全已中断：收到取消信号，已完成 ${completedCount}/${candidatesCount}`)
  }
  if (task?.runLogs) {
    task.runLogs.push(`${nowText()} | 详情补全完成：成功 ${resolvedCount}，失败 ${failedCount}`)
  }
  return result
}

async function extractSupplierPageDataWithPlaywright(listPageUrl, context = {}) {
  let session
  try {
    session = await createSupplierPlaywrightSession(listPageUrl, context)
    const page = session.page
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (type === 'image' || type === 'font' || type === 'media') return route.abort()
      return route.continue()
    })
    try {
      await page.goto(listPageUrl, { waitUntil: 'domcontentloaded', timeout: supplierPlaywrightGotoTimeoutMs })
    } catch {
      await page.goto(listPageUrl, { waitUntil: 'commit', timeout: supplierPlaywrightGotoTimeoutMs })
    }
    await page.waitForTimeout(supplierPlaywrightWaitMs)
    let finalUrl = page.url()
    let html = await page.content()
    const inlineRedirect = parseInlineRedirectUrl(html, finalUrl)
    if (inlineRedirect && inlineRedirect !== finalUrl) {
      try {
        await page.goto(inlineRedirect, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await page.waitForTimeout(supplierPlaywrightWaitMs)
        finalUrl = page.url()
        html = await page.content()
      } catch {
        // ignore redirect failure
      }
    }
    const evaluateData = await page.evaluate(() => {
      const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
      const totalPatterns = [
        /所有企业\s*(\d+)\s*家/i,
        /搜索到[^0-9]{0,20}(\d+)\s*家/i,
      ]
      let totalCount = 0
      for (const pattern of totalPatterns) {
        const matched = bodyText.match(pattern)
        const num = Number(matched?.[1] || 0)
        if (Number.isInteger(num) && num > 0) {
          totalCount = num
          break
        }
      }
      const isLikelyCompanyName = (name = '') => {
        const text = String(name || '').trim()
        if (!text || text.length < 2 || text.length > 120) return false
        if (/(首页|上一页|下一页|尾页|更多|登录|注册|联系我们|广告合作|汽车供应商网)/.test(text)) return false
        return /(公司|集团|股份|有限|科技|工业|制造|实业|厂)/.test(text)
      }
      const rows = []
      const seen = new Set()
      const pushRow = (companyName, detailHref, blockText) => {
        const key = `${String(companyName || '').trim()}@@${String(detailHref || '').trim()}`
        if (!companyName || seen.has(key)) return
        seen.add(key)
        rows.push({
          companyName: String(companyName || '').trim(),
          detailHref: String(detailHref || '').trim(),
          blockText: String(blockText || '').replace(/\s+/g, ' ').trim(),
        })
      }
      const liBlocks = Array.from(document.querySelectorAll('li.alists'))
      for (const li of liBlocks) {
        const clickable = li.querySelector("span[onclick*='company.php'],a[onclick*='company.php']")
        const normalLink = li.querySelector("a[href*='company.php?mid='],a[href*='free.php?mid=']")
        const target = clickable || normalLink
        if (!target) continue
        const onclickAttr = String(target.getAttribute('onclick') || '')
        const hrefAttr = String(target.getAttribute('href') || '')
        const midFromOnclick = onclickAttr.match(/(company\.php\?mid=\d+)/i)?.[1] || ''
        const name = String(target.textContent || li.querySelector('span')?.textContent || '').trim()
        pushRow(name, hrefAttr || midFromOnclick, li.textContent || '')
      }
      const links = Array.from(document.querySelectorAll('a[href]'))
      for (const link of links) {
        const name = String(link.textContent || '').trim()
        if (!isLikelyCompanyName(name)) continue
        const block = link.closest('tr,li,div,p,dl')
        const blockText = String(block?.textContent || '').replace(/\s+/g, ' ').trim()
        if (!/主要产品|主营产品|配套|出口|查看|收藏|ISO|IATF|地区|联系方式/.test(blockText)) continue
        const href = link.getAttribute('href') || ''
        pushRow(name, href, blockText)
      }
      const paginationUrls = links
        .map((link) => ({
          href: String(link.getAttribute('href') || '').trim(),
          text: String(link.textContent || '').replace(/\s+/g, ''),
          className: String(link.className || '').toLowerCase(),
        }))
        .filter((item) => item.href && (
          /^(上一页|下一页|上页|下页|尾页|末页|首页|>\>?|<<?|\d{1,4})$/.test(item.text)
          || /(?:^|[?&])(page|p|pg|pn)=\d+/i.test(item.href)
          || /page\d+|\/\d+\.html/i.test(item.href)
          || item.className.includes('page')
        ))
        .map((item) => item.href)
      const pageTitle = String(document.title || '').trim()
      const liAlistsCount = document.querySelectorAll('li.alists').length
      const trCount = document.querySelectorAll('tr').length
      const companyLinkCount = document.querySelectorAll("a[href*='company.php?mid='],a[href*='free.php?mid='],a[href*='/oemhome/'],a[href*='/supplier/']").length
      return {
        rows,
        totalCount,
        paginationUrls,
        diagnostics: {
          pageTitle,
          pageTextLen: bodyText.length,
          liAlistsCount,
          trCount,
          companyLinkCount,
        },
      }
    })

    let rows = extractSupplierRowsFromCategoryHtml(html, finalUrl, context)
    if (rows.length === 0 && Array.isArray(evaluateData.rows)) {
      for (const item of evaluateData.rows) {
        const row = buildSupplierSuccessRow({
          companyName: item.companyName,
          detailHref: item.detailHref,
          blockText: item.blockText,
          listPageUrl: finalUrl,
          context,
        })
        if (row) rows.push(row)
      }
    }
    const totalCount = Math.max(extractSupplierTotalCountFromHtml(html), Number(evaluateData.totalCount || 0))
    const perPage = extractSupplierPerPageFromHtml(html)
    const paginationUrls = [
      ...new Set([
        ...extractSupplierPaginationUrlsFromHtml(html, finalUrl),
        ...((evaluateData.paginationUrls || []).map((href) => {
          try {
            return new URL(href, finalUrl).toString()
          } catch {
            return ''
          }
        }).filter(Boolean)),
      ]),
    ]
    if (totalCount > 0 && paginationUrls.length === 0) {
      for (const u of buildSyntheticPaginationUrls(finalUrl, totalCount, perPage || rows.length || 10)) {
        paginationUrls.push(u)
      }
    }
    const diagnostics = {
      ...(buildSupplierHtmlDiagnostics(html, finalUrl) || {}),
      ...((evaluateData && evaluateData.diagnostics) || {}),
      playwrightMode: session?.mode || '',
      playwrightProfile: session?.profileLabel || '',
      playwrightLaunchError: session?.launchError || '',
    }
    await page.close().catch(() => {})
    return { rows, totalCount, paginationUrls, finalUrl, perPage, source: 'playwright', diagnostics }
  } catch {
    return { rows: [], totalCount: 0, paginationUrls: [], finalUrl: listPageUrl, source: 'playwright', diagnostics: {} }
  } finally {
    if (session?.close) {
      await session.close()
    }
  }
}

async function extractSupplierRowsWithPlaywright(listPageUrl, context = {}) {
  const result = await extractSupplierPageDataWithPlaywright(listPageUrl, context)
  return result.rows || []
}

async function importSupplierBaseRows(records, fileName = '') {
  if (!Array.isArray(records) || records.length === 0) {
    return { importedRows: 0, inserted: 0, updated: 0, fileName }
  }
  const client = await pool.connect()
  let inserted = 0
  let updated = 0
  try {
    await client.query('BEGIN')
    for (const item of records) {
      const sql = `
        INSERT INTO ${supplierBaseTable} (
          node_id, node_name, model, skill, company_name, main_products, fit_export, quality_system,
          region, contact_action, list_page_url, detail_url, source_url, source_file, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (COALESCE(node_id, 0), company_name, detail_url)
        DO UPDATE SET
          node_name = EXCLUDED.node_name,
          model = EXCLUDED.model,
          skill = EXCLUDED.skill,
          main_products = EXCLUDED.main_products,
          fit_export = EXCLUDED.fit_export,
          quality_system = EXCLUDED.quality_system,
          region = EXCLUDED.region,
          contact_action = EXCLUDED.contact_action,
          list_page_url = EXCLUDED.list_page_url,
          source_url = EXCLUDED.source_url,
          source_file = EXCLUDED.source_file,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `
      const values = [
        item.nodeId ? Number(item.nodeId) : null,
        toText(item.nodeName),
        toText(item.model),
        toText(item.skill),
        sanitizeSupplierCompanyName(toText(item.companyName)),
        toText(item.mainProducts),
        toText(item.fitExport),
        toText(item.qualitySystem),
        toText(item.region),
        toText(item.contactAction),
        toText(item.listPageUrl),
        toText(item.detailUrl),
        toText(item.sourceUrl),
        fileName,
      ]
      const result = await client.query(sql, values)
      const isInserted = Boolean(result.rows[0]?.inserted)
      if (isInserted) inserted += 1
      else updated += 1
    }
    await client.query('COMMIT')
    return {
      importedRows: records.length,
      inserted,
      updated,
      fileName,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function importGasSupplierRows(records, fileName = '') {
  if (!Array.isArray(records) || records.length === 0) {
    return { importedRows: 0, inserted: 0, updated: 0, fileName }
  }
  const client = await pool.connect()
  let inserted = 0
  let updated = 0
  try {
    await client.query('BEGIN')
    for (const item of records) {
      const companyName = sanitizeSupplierCompanyName(toText(item.companyName))
      if (!companyName) continue
      const gasNodeId = item.nodeId ? Number(item.nodeId) : null
      const gasNodeName = toText(item.nodeName)
      const detailUrl = toText(item.detailUrl || item.website)
      const sourceUrl = toText(item.listPageUrl || item.sourceUrl)
      const result = await client.query(
        `
        INSERT INTO ${gasSupplierTable} (
          gas_node_id, gas_node_name, company_name, region, registered_capital, established_date,
          main_products, detail_url, source_url, list_page_url, model, skill, source_file, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (COALESCE(gas_node_id, 0), company_name, detail_url)
        DO UPDATE SET
          gas_node_name = EXCLUDED.gas_node_name,
          region = CASE
            WHEN EXCLUDED.region <> '' AND (
              ${gasSupplierTable}.region = ''
              OR LENGTH(EXCLUDED.region) > LENGTH(${gasSupplierTable}.region)
              OR EXCLUDED.region LIKE ${gasSupplierTable}.region || '%'
            ) THEN EXCLUDED.region
            ELSE ${gasSupplierTable}.region
          END,
          registered_capital = CASE
            WHEN EXCLUDED.registered_capital <> '' THEN EXCLUDED.registered_capital
            ELSE ${gasSupplierTable}.registered_capital
          END,
          established_date = CASE
            WHEN EXCLUDED.established_date <> '' THEN EXCLUDED.established_date
            ELSE ${gasSupplierTable}.established_date
          END,
          main_products = CASE
            WHEN EXCLUDED.main_products <> '' THEN EXCLUDED.main_products
            ELSE ${gasSupplierTable}.main_products
          END,
          source_url = EXCLUDED.source_url,
          list_page_url = EXCLUDED.list_page_url,
          model = EXCLUDED.model,
          skill = EXCLUDED.skill,
          source_file = EXCLUDED.source_file,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
        `,
        [
          Number.isInteger(gasNodeId) && gasNodeId > 0 ? gasNodeId : null,
          gasNodeName,
          companyName,
          toText(item.region),
          toText(item.registeredCapital),
          toText(item.establishedDate),
          cleanSupplierFieldText(toText(item.mainProducts)),
          detailUrl,
          sourceUrl,
          toText(item.listPageUrl),
          toText(item.model),
          toText(item.skill),
          fileName,
        ],
      )
      if (Boolean(result.rows[0]?.inserted)) inserted += 1
      else updated += 1
    }
    await client.query('COMMIT')
    return { importedRows: records.length, inserted, updated, fileName }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function importGasOemRows(records, fileName = '') {
  if (!Array.isArray(records) || records.length === 0) {
    return { importedRows: 0, normalizedRows: 0, inserted: 0, updated: 0, fileName, duplicateNamesInFile: 0 }
  }
  const normalizedMap = new Map()
  let duplicateNamesInFile = 0
  for (const item of records) {
    const rawName = toText(item.oemName || item.companyName)
    const oemName = sanitizeSupplierCompanyName(rawName)
    if (!oemName) continue
    const key = oemName.toLowerCase()
    const parsedBrandVehicle = extractGasOemBrandVehicleFromText(
      [toText(item.brand), toText(item.vehicleModel), toText(item.mainProducts)].filter(Boolean).join('；'),
    )
    const next = {
      oemName,
      brand: cleanSupplierFieldText(toText(item.brand) || parsedBrandVehicle.brand),
      vehicleModel: cleanSupplierFieldText(toText(item.vehicleModel) || parsedBrandVehicle.vehicleModel),
      region: toText(item.region),
      registeredCapital: toText(item.registeredCapital),
      website: toText(item.website || item.detailUrl),
      model: toText(item.model),
      skill: toText(item.skill),
      sourceFile: fileName,
    }
    const prev = normalizedMap.get(key)
    if (!prev) {
      normalizedMap.set(key, next)
      continue
    }
    duplicateNamesInFile += 1
    normalizedMap.set(key, {
      ...prev,
      brand: prev.brand || next.brand,
      vehicleModel: prev.vehicleModel || next.vehicleModel,
      region: prev.region || next.region,
      registeredCapital: prev.registeredCapital || next.registeredCapital,
      website: prev.website || next.website,
      model: prev.model || next.model,
      skill: prev.skill || next.skill,
    })
  }
  const normalizedRows = [...normalizedMap.values()]
  if (normalizedRows.length === 0) {
    return { importedRows: records.length, normalizedRows: 0, inserted: 0, updated: 0, fileName, duplicateNamesInFile }
  }
  const client = await pool.connect()
  let inserted = 0
  let updated = 0
  try {
    await client.query('BEGIN')
    for (const item of normalizedRows) {
      const oemName = sanitizeSupplierCompanyName(toText(item.oemName || item.companyName))
      if (!oemName) continue
      const result = await client.query(
        `
        INSERT INTO ${gasOemTable}
          (oem_name, brand, vehicle_model, region, registered_capital, website, model, skill, source_file, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT (oem_name)
        DO UPDATE SET
          brand = CASE
            WHEN ${gasOemTable}.brand = '' THEN EXCLUDED.brand
            ELSE ${gasOemTable}.brand
          END,
          vehicle_model = CASE
            WHEN ${gasOemTable}.vehicle_model = '' THEN EXCLUDED.vehicle_model
            ELSE ${gasOemTable}.vehicle_model
          END,
          region = CASE
            WHEN ${gasOemTable}.region = '' THEN EXCLUDED.region
            ELSE ${gasOemTable}.region
          END,
          registered_capital = CASE
            WHEN ${gasOemTable}.registered_capital = '' THEN EXCLUDED.registered_capital
            ELSE ${gasOemTable}.registered_capital
          END,
          website = CASE
            WHEN ${gasOemTable}.website = '' THEN EXCLUDED.website
            ELSE ${gasOemTable}.website
          END,
          model = EXCLUDED.model,
          skill = EXCLUDED.skill,
          source_file = EXCLUDED.source_file,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
        `,
        [
          oemName,
          toText(item.brand),
          toText(item.vehicleModel),
          toText(item.region),
          toText(item.registeredCapital),
          toText(item.website || item.detailUrl),
          toText(item.model),
          toText(item.skill),
          fileName,
        ],
      )
      if (Boolean(result.rows[0]?.inserted)) inserted += 1
      else updated += 1
    }
    await client.query('COMMIT')
    return { importedRows: records.length, normalizedRows: normalizedRows.length, inserted, updated, fileName, duplicateNamesInFile }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function importSupplierProfileRows(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { importedRows: 0, inserted: 0, updated: 0, affectedNodeIds: [] }
  }
  const client = await pool.connect()
  let inserted = 0
  let updated = 0
  const affectedNodeIdSet = new Set()
  try {
    const [oemDictRes, countryDictRes, certDictRes, gasOemRes] = await Promise.all([
      client.query(`SELECT name FROM ${supplierOemDictTable} ORDER BY sort_order ASC, id ASC`),
      client.query(`SELECT name FROM ${supplierCountryDictTable} ORDER BY sort_order ASC, id ASC`),
      client.query(`SELECT name FROM ${supplierCertDictTable} ORDER BY sort_order ASC, id ASC`),
      client.query(`SELECT oem_name AS name FROM ${gasOemTable} WHERE oem_name <> '' ORDER BY updated_at DESC, id DESC LIMIT 6000`),
    ])
    const oemDict = oemDictRes.rows.map((item) => toText(item.name)).filter(Boolean)
    const countryDict = countryDictRes.rows.map((item) => toText(item.name)).filter(Boolean)
    const certDict = certDictRes.rows.map((item) => toText(item.name)).filter(Boolean)
    const gasOemIndex = gasOemRes.rows
      .map((item) => {
        const name = toText(item.name)
        const norm = normalizeOemMatchKey(name)
        return { name, norm }
      })
      .filter((item) => item.name && item.norm)
    const sourceSupplierByUrlCache = new Map()

    const resolveGasSourceSupplierByProfileUrl = async (profileUrl = '') => {
      const raw = toText(profileUrl).trim()
      if (!raw) return null
      const cacheKey = raw.toLowerCase()
      if (sourceSupplierByUrlCache.has(cacheKey)) return sourceSupplierByUrlCache.get(cacheKey)
      const resolved = await client.query(
        `
        SELECT
          id,
          gas_node_id AS "nodeId",
          gas_node_name AS "nodeName"
        FROM ${gasSupplierTable}
        WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(detail_url, ''), '^https?://', ''), '/+$', ''))
          = LOWER(REGEXP_REPLACE(REGEXP_REPLACE($1, '^https?://', ''), '/+$', ''))
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
        `,
        [raw],
      )
      const row = resolved.rowCount > 0 ? resolved.rows[0] : null
      sourceSupplierByUrlCache.set(cacheKey, row)
      return row
    }

    await client.query('BEGIN')
    for (const item of records) {
      const companyName = sanitizeSupplierCompanyName(toText(item.companyName))
      if (!companyName) continue
      const profileSource = detectSupplierProfileSource(
        item.profileSource,
        item.website,
        item.detailUrl,
        item.sourceUrl,
        item.listPageUrl,
      )
      const businessInfo = parseSupplierBusinessInfo(item.businessInfo)
      const industrialCommercialInfo = parseSupplierBusinessInfo(item.industrialCommercialInfo)
      const customerItems = parseSupplierCustomerItems(item.customerItems)
      const customerOemCandidates = [...new Set(
        customerItems.flatMap((entry) => parseStringArray(entry?.oemNames || [])),
      )]
      const hasFitSituationField = Object.prototype.hasOwnProperty.call(item, 'fitSituation')
      const hasExportSituationField = Object.prototype.hasOwnProperty.call(item, 'exportSituation')
      const normalizedItem = normalizeSupplierDetailAtomicFields({
        companyType: item.companyType,
        orgCode: item.orgCode,
        establishedDate: item.establishedDate,
        registeredCapital: item.registeredCapital,
        employeesCount: item.employeesCount,
        legalRepresentative: item.legalRepresentative,
      })
      const sourceText = cleanSupplierFieldText([
        item.mainProducts,
        item.fitExport,
        item.qualitySystem,
        item.region,
        item.companyIntro,
        normalizedItem.companyType,
        normalizedItem.orgCode,
        normalizedItem.establishedDate,
        normalizedItem.registeredCapital,
        normalizedItem.employeesCount,
        normalizedItem.legalRepresentative,
        item.newsSummary,
        businessInfo['人员规模'],
        businessInfo['研发人数'],
        businessInfo['年销售额'],
        businessInfo['体系认证'],
        businessInfo['配套客户'],
        businessInfo['直接配套客户'],
        businessInfo['间接配套客户'],
        businessInfo['直接出口经验'],
        businessInfo['年出口额'],
        businessInfo['出口市场'],
        businessInfo['主营产品'],
      ].map((v) => toText(v)).join(' '))
      const mainProductsText = cleanSupplierFieldText(toText(item.mainProducts))
      const productNameList = dedupeSupplierProductNames(splitSupplierProductTexts(mainProductsText))
      const products = buildSupplierProductsFromNames(
        productNameList.length > 0 ? productNameList : (mainProductsText ? [mainProductsText] : []),
      )
      const contactSourceText = cleanSupplierFieldText(`${toText(item.contactAction)} ${sourceText}`)
      const contactFields = extractSupplierContactFieldsFromText(contactSourceText)
      const contacts = parseSupplierProfileContacts([
        {
          id: makeRuntimeId('c'),
          contactPerson: contactFields.contactPerson,
          contactTitle: '',
          phone: contactFields.phone,
          mobile: contactFields.mobile,
          email: contactFields.email,
        },
      ])
      const fitOriginalText = cleanSupplierFieldText(toText(item.fitSituation))
      const exportOriginalText = cleanSupplierFieldText(toText(item.exportSituation))
      const fitSourceText = cleanSupplierFieldText(`${fitOriginalText} ${toText(item.fitExport)} ${sourceText}`)
      const exportSourceText = cleanSupplierFieldText(`${exportOriginalText} ${toText(item.fitExport)} ${toText(item.region)} ${sourceText}`)
      const certSourceText = cleanSupplierFieldText(`${toText(item.qualitySystem)} ${sourceText}`)
      const fitOemRaw = [...new Set([
        ...extractKnownItemsFromText(fitSourceText, oemDict),
        ...extractSupplierOemCandidatesFromText(fitOriginalText || fitSourceText),
        ...customerOemCandidates,
      ])]
      const fitOems = [...new Set(
        fitOemRaw.map((name) => (
          profileSource === 'gas'
            ? resolveGasOemMatchName(name, gasOemIndex)
            : cleanSupplierFieldText(name)
        )).filter(Boolean),
      )]
        .filter((name) => !/(零部件|高技术|产品|方案|系统|平台|项目|材料|工艺|设备|服务|技术|研发|再制造|等多种|等)/i.test(name))
      const explicitExportCountries = extractSupplierCountryCandidatesFromText(exportOriginalText || exportSourceText)
      const exportCountries = explicitExportCountries.length > 0
        ? explicitExportCountries
        : [...new Set(extractKnownItemsFromText(exportSourceText, countryDict))]
      const certItems = [...new Set([
        ...extractKnownItemsFromText(cleanSupplierFieldText(`${toText(item.certificates)} ${certSourceText}`), certDict),
        ...extractSupplierCertificationCandidatesFromText(toText(item.certificates) || certSourceText),
      ])].filter(Boolean)
      const certificateDetails = cleanSupplierFieldText(toText(item.certificates) || certItems.join('，'))
      const fitSituation = hasFitSituationField
        ? fitOriginalText
        : (
          cleanSupplierFieldText(
            fitOriginalText
            || textByRegex(fitSourceText, /(?:配套说明|配套情况|配套)[:：]?\s*([^]{0,320}?)(?:出口情况|出口国家|出口|认证体系|认证|企业证书|$)/i),
          ) || (fitOems.length > 0 ? fitOems.join('，') : cleanSupplierFieldText(toText(item.fitExport)))
        )
      const exportSituation = hasExportSituationField
        ? exportOriginalText
        : (
          cleanSupplierFieldText(
            exportOriginalText
            || textByRegex(exportSourceText, /(?:出口情况|出口国家|出口)[:：]?\s*([^]{0,260}?)(?:认证体系|认证|企业证书|$)/i),
          ) || (exportCountries.length > 0 ? exportCountries.join('，') : cleanSupplierFieldText(`${toText(item.fitExport)} ${toText(item.region)}`))
        )
      const intro = cleanSupplierFieldText(
        toText(item.companyIntro)
        || textByRegex(sourceText, /(?:公司简介|企业简介|企业介绍)[:：]?\s*([^]{0,500}?)(?:联系方式|联系人|电话|地址|配套|出口|认证|新闻|$)/i),
      )
      const newsSummary = cleanSupplierFieldText(
        toText(item.newsSummary)
        || textByRegex(sourceText, /(?:公司新闻|新闻动态|新闻|资讯)[:：]?\s*([^]{0,260})/i),
      )
      const newsItems = Array.isArray(item.newsItems) && item.newsItems.length > 0
        ? parseSupplierNewsItems(item.newsItems)
        : (
          newsSummary
            ? parseSupplierNewsItems([{
              id: makeRuntimeId('n'),
              title: newsSummary.slice(0, 64),
              source: toText(item.detailUrl) || toText(item.sourceUrl) || '公司网站',
              publishDate: '',
              content: newsSummary,
            }])
            : []
        )
      const productFitDetails = []
      const companyTags = parseSupplierCompanyTags(item.companyTags)
      const mainProductNames = dedupeSupplierProductNames(item.mainProductNames || productNameList)
      const productCaseItems = parseSupplierProductCaseItems(item.productCaseItems)
      const financingItems = parseSupplierFinancingItems(item.financingItems)
      const softwareCopyrightItems = parseSupplierSoftwareCopyrightItems(item.softwareCopyrightItems)
      const patentItems = parseSupplierPatentItems(item.patentItems)
      const adminLicenseItems = parseSupplierAdminLicenseItems(item.adminLicenseItems)
      const adminLicenseGsItems = parseSupplierAdminLicenseGsItems(item.adminLicenseGsItems)
      const tradeCreditItems = parseSupplierTradeCreditItems(item.tradeCreditItems)
      const courtNoticeItems = parseSupplierCourtNoticeItems(item.courtNoticeItems)
      const productionBaseItems = parseSupplierProductionBaseItems(item.productionBaseItems)
      const companyNews = newsItems.length > 0
        ? newsItems.map((entry) => toText(entry.title)).filter(Boolean).join('；')
        : ''
      await upsertSupplierDictItems(client, supplierOemDictTable, fitOems)
      await upsertSupplierDictItems(client, supplierCountryDictTable, exportCountries)
      await upsertSupplierDictItems(client, supplierCertDictTable, certItems)

      const existing = await client.query(
        `
        SELECT
          id,
          profile_source AS "profileSource",
          related_node_id AS "relatedNodeId",
          related_node_name AS "relatedNodeName",
          related_node_ids AS "relatedNodeIds",
          related_node_names AS "relatedNodeNames"
        FROM ${supplierProfileTable}
        WHERE company_name = $1 AND profile_source = $2
        ORDER BY id ASC
        LIMIT 1
        `,
        [companyName, profileSource],
      )
      const mergedNodeRefs = mergeSupplierNodeRefs(
        existing.rows[0]?.relatedNodeIds || [],
        existing.rows[0]?.relatedNodeNames || [],
        item.nodeId,
        toText(item.nodeName),
      )
      for (const nodeId of mergedNodeRefs.ids || []) {
        const parsedNodeId = Number(nodeId)
        if (Number.isInteger(parsedNodeId) && parsedNodeId > 0) {
          affectedNodeIdSet.add(parsedNodeId)
        }
      }
      let profileId = null
      if (existing.rowCount > 0) {
        await client.query(
          `
          UPDATE ${supplierProfileTable}
          SET
            related_node_id = COALESCE(related_node_id, $14::bigint),
            related_node_name = CASE WHEN related_node_name = '' THEN $15 ELSE related_node_name END,
            related_node_ids = $26::jsonb,
            related_node_names = $27::jsonb,
            website = CASE
              WHEN website = '' THEN COALESCE(NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), website)
              ELSE website
            END,
            address = CASE
              WHEN address = '' THEN $5
              ELSE address
            END,
            products = CASE
              WHEN jsonb_array_length(products) = 0 OR jsonb_array_length($6::jsonb) > jsonb_array_length(products) THEN $6::jsonb
              ELSE products
            END,
            fit_oems = CASE
              WHEN jsonb_array_length(fit_oems) = 0 OR jsonb_array_length($7::jsonb) > jsonb_array_length(fit_oems) THEN $7::jsonb
              ELSE fit_oems
            END,
            export_countries = CASE
              WHEN jsonb_array_length(export_countries) = 0 OR jsonb_array_length($8::jsonb) > jsonb_array_length(export_countries) THEN $8::jsonb
              ELSE export_countries
            END,
            certificate_items = CASE
              WHEN jsonb_array_length(certificate_items) = 0 OR jsonb_array_length($9::jsonb) > jsonb_array_length(certificate_items) THEN $9::jsonb
              ELSE certificate_items
            END,
            contacts = CASE
              WHEN jsonb_array_length(contacts) = 0 OR jsonb_array_length($10::jsonb) > jsonb_array_length(contacts) THEN $10::jsonb
              ELSE contacts
            END,
            company_intro = CASE
              WHEN company_intro = '' THEN $16
              WHEN CHAR_LENGTH($16) >= 80 AND CHAR_LENGTH($16) > CHAR_LENGTH(company_intro) + 24 THEN $16
              ELSE company_intro
            END,
            company_type = CASE WHEN company_type = '' THEN $17 ELSE company_type END,
            org_code = CASE WHEN org_code = '' THEN $18 ELSE org_code END,
            established_date = CASE WHEN established_date = '' THEN $19 ELSE established_date END,
            registered_capital = CASE WHEN registered_capital = '' THEN $20 ELSE registered_capital END,
            employees_count = CASE WHEN employees_count = '' THEN $21 ELSE employees_count END,
            legal_representative = CASE WHEN legal_representative = '' THEN $22 ELSE legal_representative END,
            news_items = CASE
              WHEN jsonb_array_length(news_items) = 0 OR jsonb_array_length($23::jsonb) > jsonb_array_length(news_items) THEN $23::jsonb
              ELSE news_items
            END,
            product_fit_details = CASE
              WHEN jsonb_array_length(product_fit_details) = 0 OR jsonb_array_length($24::jsonb) > jsonb_array_length(product_fit_details) THEN $24::jsonb
              ELSE product_fit_details
            END,
            fit_situation = CASE
              WHEN fit_situation = '' THEN $11
              WHEN CHAR_LENGTH($11) >= 6 AND CHAR_LENGTH($11) > CHAR_LENGTH(fit_situation) + 8 THEN $11
              ELSE fit_situation
            END,
            export_situation = CASE
              WHEN export_situation = '' THEN $12
              WHEN CHAR_LENGTH($12) >= 6 AND CHAR_LENGTH($12) > CHAR_LENGTH(export_situation) + 8 THEN $12
              ELSE export_situation
            END,
            certificates = CASE
              WHEN certificates = '' THEN $13
              WHEN CHAR_LENGTH($13) > CHAR_LENGTH(certificates) + 6 THEN $13
              ELSE certificates
            END,
            company_news = CASE
              WHEN company_news = '' THEN $25
              WHEN CHAR_LENGTH($25) >= 20 AND CHAR_LENGTH($25) > CHAR_LENGTH(company_news) + 12 THEN $25
              ELSE company_news
            END,
            company_tags = CASE
              WHEN jsonb_array_length(company_tags) = 0 OR jsonb_array_length($28::jsonb) > jsonb_array_length(company_tags) THEN $28::jsonb
              ELSE company_tags
            END,
            main_product_names = CASE
              WHEN jsonb_array_length(main_product_names) = 0 OR jsonb_array_length($29::jsonb) > jsonb_array_length(main_product_names) THEN $29::jsonb
              ELSE main_product_names
            END,
            business_info = CASE
              WHEN $30::jsonb <> '{}'::jsonb
                AND (
                  business_info = '{}'::jsonb
                  OR jsonb_object_length($30::jsonb) >= jsonb_object_length(business_info)
                )
              THEN $30::jsonb
              ELSE business_info
            END,
            industrial_commercial_info = CASE
              WHEN $31::jsonb <> '{}'::jsonb
                AND (
                  industrial_commercial_info = '{}'::jsonb
                  OR jsonb_object_length($31::jsonb) >= jsonb_object_length(industrial_commercial_info)
                )
              THEN $31::jsonb
              ELSE industrial_commercial_info
            END,
            updated_at = NOW()
          WHERE id = $1
          `,
          [
            Number(existing.rows[0].id),
            cleanSupplierFieldText(toText(item.website)),
            toText(item.detailUrl),
            toText(item.sourceUrl),
            cleanSupplierFieldText(toText(item.address)),
            JSON.stringify(products),
            JSON.stringify(fitOems),
            JSON.stringify(exportCountries),
            JSON.stringify(certItems),
            JSON.stringify(contacts),
            fitSituation,
            exportSituation,
            certificateDetails,
            item.nodeId ? Number(item.nodeId) : null,
            toText(item.nodeName),
            intro,
            cleanSupplierFieldText(toText(normalizedItem.companyType)),
            cleanSupplierFieldText(toText(normalizedItem.orgCode)),
            cleanSupplierFieldText(toText(normalizedItem.establishedDate)),
            cleanSupplierFieldText(toText(normalizedItem.registeredCapital)),
            cleanSupplierFieldText(toText(normalizedItem.employeesCount)),
            cleanSupplierFieldText(toText(normalizedItem.legalRepresentative)),
            JSON.stringify(newsItems),
            JSON.stringify(productFitDetails),
            companyNews,
            JSON.stringify(mergedNodeRefs.ids),
            JSON.stringify(mergedNodeRefs.names),
            JSON.stringify(companyTags),
            JSON.stringify(mainProductNames),
            JSON.stringify(businessInfo),
            JSON.stringify(industrialCommercialInfo),
          ],
        )
        profileId = Number(existing.rows[0].id)
        updated += 1
      } else {
        const initialNodeRefs = mergeSupplierNodeRefs([], [], item.nodeId, toText(item.nodeName))
        for (const nodeId of initialNodeRefs.ids || []) {
          const parsedNodeId = Number(nodeId)
          if (Number.isInteger(parsedNodeId) && parsedNodeId > 0) {
            affectedNodeIdSet.add(parsedNodeId)
          }
        }
        const insertedProfile = await client.query(
          `
          INSERT INTO ${supplierProfileTable}
          (
            profile_source, related_node_id, related_node_name, related_node_ids, related_node_names, company_name, legal_representative, org_code, registered_capital, established_date, employees_count, company_type,
            website, company_intro, fit_situation, export_situation, certificates, address, products,
            contacts, fit_oems, product_fit_details, export_countries, certificate_items, company_news, news_items,
            company_tags, main_product_names, business_info, industrial_commercial_info, updated_at
          )
          VALUES
          ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25,$26::jsonb,$27::jsonb,$28::jsonb,$29::jsonb,$30::jsonb,NOW())
          RETURNING id
          `,
          [
            profileSource,
            item.nodeId ? Number(item.nodeId) : null,
            toText(item.nodeName),
            JSON.stringify(initialNodeRefs.ids),
            JSON.stringify(initialNodeRefs.names),
            companyName,
            cleanSupplierFieldText(toText(normalizedItem.legalRepresentative)),
            cleanSupplierFieldText(toText(normalizedItem.orgCode)),
            cleanSupplierFieldText(toText(normalizedItem.registeredCapital)),
            cleanSupplierFieldText(toText(normalizedItem.establishedDate)),
            cleanSupplierFieldText(toText(normalizedItem.employeesCount)),
            cleanSupplierFieldText(toText(normalizedItem.companyType)),
            cleanSupplierFieldText(toText(item.website)) || toText(item.detailUrl) || toText(item.sourceUrl),
            intro,
            fitSituation,
            exportSituation,
            certificateDetails,
            cleanSupplierFieldText(toText(item.address)),
            JSON.stringify(products),
            JSON.stringify(contacts),
            JSON.stringify(fitOems),
            JSON.stringify(productFitDetails),
            JSON.stringify(exportCountries),
            JSON.stringify(certItems),
            companyNews,
            JSON.stringify(newsItems),
            JSON.stringify(companyTags),
            JSON.stringify(mainProductNames),
            JSON.stringify(businessInfo),
            JSON.stringify(industrialCommercialInfo),
          ],
        )
        profileId = Number(insertedProfile.rows[0].id)
        inserted += 1
      }
      const supplierProfileUrl = toText(item.supplierProfileUrl || item.detailUrl || item.website || item.sourceUrl)
      const sourceSupplierRef = profileSource === 'gas'
        ? await resolveGasSourceSupplierByProfileUrl(supplierProfileUrl)
        : null
      const sourceSupplierId = sourceSupplierRef?.id ? Number(sourceSupplierRef.id) : null
      if (Number.isInteger(sourceSupplierRef?.nodeId) && sourceSupplierRef.nodeId > 0) {
        affectedNodeIdSet.add(Number(sourceSupplierRef.nodeId))
      }
      if (profileId && (sourceSupplierId || supplierProfileUrl)) {
        await client.query(
          `
          UPDATE ${supplierProfileTable}
          SET
            source_supplier_id = COALESCE(source_supplier_id, $2::bigint),
            supplier_profile_url = CASE WHEN supplier_profile_url = '' THEN $3 ELSE supplier_profile_url END,
            website = CASE WHEN website = '' THEN $3 ELSE website END,
            updated_at = NOW()
          WHERE id = $1
          `,
          [profileId, sourceSupplierId, supplierProfileUrl],
        )
      }
      if (profileId && customerItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileCustomerTable,
          profileId,
          customerItems,
          `INSERT INTO ${supplierProfileCustomerTable} (profile_id, sort_order, product_name, oem_names, updated_at) VALUES ($1,$2,$3,$4::jsonb,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.productName, JSON.stringify(entry.oemNames)],
        )
      }
      if (profileId && productCaseItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileProductCaseTable,
          profileId,
          productCaseItems,
          `INSERT INTO ${supplierProfileProductCaseTable} (profile_id, sort_order, product_name, vehicle_model, customer_name, description, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.productName, entry.vehicleModel, entry.customerName, entry.description],
        )
      }
      if (profileId && financingItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileFinancingTable,
          profileId,
          financingItems,
          `INSERT INTO ${supplierProfileFinancingTable} (profile_id, sort_order, financing_date, financing_round, financing_amount, investors, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.financingDate, entry.round, entry.amount, entry.investors],
        )
      }
      if (profileId && softwareCopyrightItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileSoftwareCopyrightTable,
          profileId,
          softwareCopyrightItems,
          `INSERT INTO ${supplierProfileSoftwareCopyrightTable} (profile_id, sort_order, software_name, version, release_date, software_alias, registration_no, approval_date, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.softwareName, entry.version, entry.releaseDate, entry.softwareAlias, entry.registrationNo, entry.approvalDate],
        )
      }
      if (profileId && patentItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfilePatentTable,
          profileId,
          patentItems,
          `INSERT INTO ${supplierProfilePatentTable} (profile_id, sort_order, patent_type, publication_no, publication_date, title, application_no, application_date, inventors, assignee, agency, agent, legal_status, summary, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.patentType, entry.publicationNo, entry.publicationDate, entry.title, entry.applicationNo, entry.applicationDate, entry.inventors, entry.assignee, entry.agency, entry.agent, entry.legalStatus, entry.summary],
        )
      }
      if (profileId && adminLicenseItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileAdminLicenseTable,
          profileId,
          adminLicenseItems,
          `INSERT INTO ${supplierProfileAdminLicenseTable} (profile_id, sort_order, document_no, authority, decision_date, content, status, valid_until, category, region, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.documentNo, entry.authority, entry.decisionDate, entry.content, entry.status, entry.validUntil, entry.category, entry.region],
        )
      }
      if (profileId && adminLicenseGsItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileAdminLicenseGsTable,
          profileId,
          adminLicenseGsItems,
          `INSERT INTO ${supplierProfileAdminLicenseGsTable} (profile_id, sort_order, permit_no, permit_name, valid_from, valid_to, authority, content, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.permitNo, entry.permitName, entry.validFrom, entry.validTo, entry.authority, entry.content],
        )
      }
      if (profileId && tradeCreditItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileTradeCreditTable,
          profileId,
          tradeCreditItems,
          `INSERT INTO ${supplierProfileTradeCreditTable} (profile_id, sort_order, customs_office, business_type, registration_date, registration_code, administrative_region, economic_region, credit_level, annual_report_status, validity_period, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.customsOffice, entry.businessType, entry.registrationDate, entry.registrationCode, entry.administrativeRegion, entry.economicRegion, entry.creditLevel, entry.annualReportStatus, entry.validityPeriod],
        )
      }
      if (profileId && courtNoticeItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileCourtNoticeTable,
          profileId,
          courtNoticeItems,
          `INSERT INTO ${supplierProfileCourtNoticeTable} (profile_id, sort_order, case_no, hearing_date, cause, plaintiff, defendant, court, tribunal, region, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.caseNo, entry.hearingDate, entry.cause, entry.plaintiff, entry.defendant, entry.court, entry.tribunal, entry.region],
        )
      }
      if (profileId && productionBaseItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileProductionBaseTable,
          profileId,
          productionBaseItems,
          `INSERT INTO ${supplierProfileProductionBaseTable} (profile_id, sort_order, base_name, region, postal_code, address, phone, main_products, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.baseName, entry.region, entry.postalCode, entry.address, entry.phone, entry.mainProducts],
        )
      }
      if (profileId && newsItems.length > 0) {
        await replaceSupplierProfileChildRows(
          client,
          supplierProfileNewsTable,
          profileId,
          newsItems,
          `INSERT INTO ${supplierProfileNewsTable} (profile_id, sort_order, title, source, publish_date, content, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
          (entry, idx) => [profileId, idx + 1, entry.title, entry.source, entry.publishDate, entry.content],
        )
      }
    }
    await client.query('COMMIT')
    return {
      importedRows: records.length,
      inserted,
      updated,
      affectedNodeIds: [...affectedNodeIdSet],
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function refreshGasSupplyChainSyncedSupplierCounts(nodeIds = []) {
  const normalizedIds = [...new Set(
    (Array.isArray(nodeIds) ? nodeIds : [])
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item > 0),
  )]
  if (normalizedIds.length === 0) {
    return { updatedNodeCount: 0, totalSuppliers: 0, nodeCounts: [] }
  }
  const client = await pool.connect()
  try {
    const result = await client.query(
      `
      WITH target_nodes AS (
        SELECT DISTINCT unnest($1::bigint[]) AS node_id
      ),
      counts AS (
        SELECT
          tn.node_id,
          COUNT(DISTINCT gs.id)::int AS supplier_count
        FROM target_nodes tn
        LEFT JOIN ${gasSupplierTable} gs
          ON gs.gas_node_id = tn.node_id
        GROUP BY tn.node_id
      )
      UPDATE ${gasSupplyChainNodeTable} node
      SET
        synced_supplier_count = COALESCE(counts.supplier_count, 0),
        synced_at = CASE WHEN COALESCE(counts.supplier_count, 0) > 0 THEN NOW() ELSE NULL END,
        updated_at = NOW()
      FROM target_nodes
      LEFT JOIN counts ON counts.node_id = target_nodes.node_id
      WHERE node.id = target_nodes.node_id
      RETURNING node.id, node.synced_supplier_count AS "syncedSupplierCount"
      `,
      [normalizedIds],
    )
    return {
      updatedNodeCount: result.rowCount || 0,
      totalSuppliers: result.rows.reduce((sum, row) => sum + Number(row.syncedSupplierCount || 0), 0),
      nodeCounts: result.rows.map((row) => ({
        nodeId: Number(row.id),
        syncedSupplierCount: Number(row.syncedSupplierCount || 0),
      })),
    }
  } finally {
    client.release()
  }
}

async function fetchSupplierProfileDetailById(client, id) {
  const result = await client.query(
    `
    SELECT
      id,
      profile_source AS "profileSource",
      source_supplier_id AS "sourceSupplierId",
      related_node_id AS "relatedNodeId",
      related_node_name AS "relatedNodeName",
      related_node_ids AS "relatedNodeIds",
      related_node_names AS "relatedNodeNames",
      company_name AS "companyName",
      company_name_en AS "companyNameEn",
      legal_representative AS "legalRepresentative",
      org_code AS "orgCode",
      registered_capital AS "registeredCapital",
      established_date AS "establishedDate",
      employees_count AS "employeesCount",
      company_type AS "companyType",
      contact_person AS "contactPerson",
      contact_title AS "contactTitle",
      phone,
      mobile,
      email,
      website,
      supplier_profile_url AS "supplierProfileUrl",
      postal_code AS "postalCode",
      address,
      company_intro AS "companyIntro",
      fit_situation AS "fitSituation",
      export_situation AS "exportSituation",
      certificates,
      company_news AS "companyNews",
      products,
      contacts,
      fit_oems AS "fitOems",
      product_fit_details AS "productFitDetails",
      export_countries AS "exportCountries",
      certificate_items AS "certificateItems",
      news_items AS "legacyNewsItems",
      company_tags AS "companyTags",
      main_product_names AS "mainProductNames",
      business_info AS "businessInfo",
      industrial_commercial_info AS "industrialCommercialInfo",
      TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
      TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
    FROM ${supplierProfileTable}
    WHERE id = $1
    LIMIT 1
    `,
    [id],
  )
  if (result.rowCount === 0) return null
  const row = result.rows[0]
  const [
    customerRes,
    productCaseRes,
    financingRes,
    softwareCopyrightRes,
    patentRes,
    adminLicenseRes,
    adminLicenseGsRes,
    tradeCreditRes,
    courtNoticeRes,
    productionBaseRes,
    newsRes,
    equipmentRes,
  ] = await Promise.all([
    client.query(`SELECT product_name AS "productName", oem_names AS "oemNames" FROM ${supplierProfileCustomerTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT product_name AS "productName", vehicle_model AS "vehicleModel", customer_name AS "customerName", description FROM ${supplierProfileProductCaseTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT financing_date AS "financingDate", financing_round AS "round", financing_amount AS "amount", investors FROM ${supplierProfileFinancingTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT software_name AS "softwareName", version, release_date AS "releaseDate", software_alias AS "softwareAlias", registration_no AS "registrationNo", approval_date AS "approvalDate" FROM ${supplierProfileSoftwareCopyrightTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT patent_type AS "patentType", publication_no AS "publicationNo", publication_date AS "publicationDate", title, application_no AS "applicationNo", application_date AS "applicationDate", inventors, assignee, agency, agent, legal_status AS "legalStatus", summary FROM ${supplierProfilePatentTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT document_no AS "documentNo", authority, decision_date AS "decisionDate", content, status, valid_until AS "validUntil", category, region FROM ${supplierProfileAdminLicenseTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT permit_no AS "permitNo", permit_name AS "permitName", valid_from AS "validFrom", valid_to AS "validTo", authority, content FROM ${supplierProfileAdminLicenseGsTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT customs_office AS "customsOffice", business_type AS "businessType", registration_date AS "registrationDate", content, registration_code AS "registrationCode", administrative_region AS "administrativeRegion", economic_region AS "economicRegion", credit_level AS "creditLevel", annual_report_status AS "annualReportStatus", validity_period AS "validityPeriod" FROM ${supplierProfileTradeCreditTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT case_no AS "caseNo", hearing_date AS "hearingDate", cause, plaintiff, defendant, court, tribunal, region FROM ${supplierProfileCourtNoticeTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT base_name AS "baseName", region, postal_code AS "postalCode", address, phone, main_products AS "mainProducts" FROM ${supplierProfileProductionBaseTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT title, source, publish_date AS "publishDate", content FROM ${supplierProfileNewsTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
    client.query(`SELECT equipment_name AS "equipmentName" FROM ${supplierProfileEquipmentTable} WHERE profile_id = $1 ORDER BY sort_order ASC, id ASC`, [id]),
  ])
  const parsedNewsItems = newsRes.rowCount > 0 ? parseSupplierNewsItems(newsRes.rows) : parseSupplierNewsItems(row.legacyNewsItems || [])
  return {
    ...row,
    relatedNodeIds: parseBigintArrayLoose(row.relatedNodeIds || []),
    relatedNodeNames: parseStringArray(row.relatedNodeNames || []),
    contacts: parseSupplierProfileContacts(row.contacts || []),
    products: parseSupplierProfileProducts(row.products || []),
    fitOems: parseStringArray(row.fitOems || []),
    productFitDetails: parseSupplierProductFitDetails(row.productFitDetails || []),
    exportCountries: parseStringArray(row.exportCountries || []),
    certificateItems: parseStringArray(row.certificateItems || []),
    companyTags: parseSupplierCompanyTags(row.companyTags || []),
    mainProductNames: dedupeSupplierProductNames(row.mainProductNames || []),
    businessInfo: parseSupplierBusinessInfo(row.businessInfo || {}),
    industrialCommercialInfo: parseSupplierBusinessInfo(row.industrialCommercialInfo || {}),
    customerItems: parseSupplierCustomerItems(customerRes.rows),
    productCaseItems: parseSupplierProductCaseItems(productCaseRes.rows),
    financingItems: parseSupplierFinancingItems(financingRes.rows),
    softwareCopyrightItems: parseSupplierSoftwareCopyrightItems(softwareCopyrightRes.rows),
    patentItems: parseSupplierPatentItems(patentRes.rows),
    adminLicenseItems: parseSupplierAdminLicenseItems(adminLicenseRes.rows),
    adminLicenseGsItems: parseSupplierAdminLicenseGsItems(adminLicenseGsRes.rows),
    tradeCreditItems: parseSupplierTradeCreditItems(tradeCreditRes.rows),
    courtNoticeItems: parseSupplierCourtNoticeItems(courtNoticeRes.rows),
    productionBaseItems: parseSupplierProductionBaseItems(productionBaseRes.rows),
    newsItems: parsedNewsItems,
    equipmentItems: parseSupplierEquipmentItems(equipmentRes.rows),
  }
}

function normalizeSupplierProfilePayload(payload = {}, current = null) {
  const base = current && typeof current === 'object' ? current : {}
  const contacts = Object.prototype.hasOwnProperty.call(payload, 'contacts')
    ? parseSupplierProfileContacts(payload.contacts)
    : parseSupplierProfileContacts(base.contacts)
  const primaryContact = contacts[0] || {}
  const fitOems = Object.prototype.hasOwnProperty.call(payload, 'fitOems')
    ? parseStringArray(payload.fitOems)
    : parseStringArray(base.fitOems)
  const exportCountries = Object.prototype.hasOwnProperty.call(payload, 'exportCountries')
    ? parseStringArray(payload.exportCountries)
    : parseStringArray(base.exportCountries)
  const certificateItems = Object.prototype.hasOwnProperty.call(payload, 'certificateItems')
    ? parseStringArray(payload.certificateItems)
    : parseStringArray(base.certificateItems)
  const newsItems = Object.prototype.hasOwnProperty.call(payload, 'newsItems')
    ? parseSupplierNewsItems(payload.newsItems)
    : parseSupplierNewsItems(base.newsItems)
  const relatedNodeIds = Object.prototype.hasOwnProperty.call(payload, 'relatedNodeIds') || Object.prototype.hasOwnProperty.call(payload, 'relatedNodeId')
    ? parseBigintArrayLoose(payload.relatedNodeIds)
    : parseBigintArrayLoose(base.relatedNodeIds)
  const singleNodeId = payload.relatedNodeId ? Number(payload.relatedNodeId) : null
  if (Number.isInteger(singleNodeId) && singleNodeId > 0 && !relatedNodeIds.includes(singleNodeId)) relatedNodeIds.unshift(singleNodeId)
  const relatedNodeNames = Object.prototype.hasOwnProperty.call(payload, 'relatedNodeNames') || Object.prototype.hasOwnProperty.call(payload, 'relatedNodeName')
    ? parseStringArray(payload.relatedNodeNames)
    : parseStringArray(base.relatedNodeNames)
  const singleNodeName = toText(payload.relatedNodeName)
  if (singleNodeName && !relatedNodeNames.includes(singleNodeName)) relatedNodeNames.unshift(singleNodeName)
  const sourceSupplierId = Object.prototype.hasOwnProperty.call(payload, 'sourceSupplierId')
    ? parsePositiveBigintId(payload.sourceSupplierId)
    : parsePositiveBigintId(base.sourceSupplierId)
  return {
    sourceSupplierId,
    relatedNodeIds,
    relatedNodeNames,
    profileSource: Object.prototype.hasOwnProperty.call(payload, 'profileSource')
      ? normalizeSupplierProfileSource(payload.profileSource)
      : detectSupplierProfileSource(base.profileSource, payload.website, base.website),
    companyName: toText(Object.prototype.hasOwnProperty.call(payload, 'companyName') ? payload.companyName : base.companyName),
    companyNameEn: toText(Object.prototype.hasOwnProperty.call(payload, 'companyNameEn') ? payload.companyNameEn : base.companyNameEn),
    legalRepresentative: toText(Object.prototype.hasOwnProperty.call(payload, 'legalRepresentative') ? payload.legalRepresentative : base.legalRepresentative),
    orgCode: toText(Object.prototype.hasOwnProperty.call(payload, 'orgCode') ? payload.orgCode : base.orgCode),
    registeredCapital: toText(Object.prototype.hasOwnProperty.call(payload, 'registeredCapital') ? payload.registeredCapital : base.registeredCapital),
    establishedDate: toText(Object.prototype.hasOwnProperty.call(payload, 'establishedDate') ? payload.establishedDate : base.establishedDate),
    employeesCount: toText(Object.prototype.hasOwnProperty.call(payload, 'employeesCount') ? payload.employeesCount : base.employeesCount),
    companyType: toText(Object.prototype.hasOwnProperty.call(payload, 'companyType') ? payload.companyType : base.companyType),
    website: toText(Object.prototype.hasOwnProperty.call(payload, 'website') ? payload.website : base.website),
    supplierProfileUrl: toText(Object.prototype.hasOwnProperty.call(payload, 'supplierProfileUrl') ? payload.supplierProfileUrl : base.supplierProfileUrl),
    postalCode: toText(Object.prototype.hasOwnProperty.call(payload, 'postalCode') ? payload.postalCode : base.postalCode),
    address: toText(Object.prototype.hasOwnProperty.call(payload, 'address') ? payload.address : base.address),
    companyIntro: toText(Object.prototype.hasOwnProperty.call(payload, 'companyIntro') ? payload.companyIntro : base.companyIntro),
    fitSituation: toText(Object.prototype.hasOwnProperty.call(payload, 'fitSituation') ? payload.fitSituation : base.fitSituation) || fitOems.join('，'),
    exportSituation: toText(Object.prototype.hasOwnProperty.call(payload, 'exportSituation') ? payload.exportSituation : base.exportSituation) || exportCountries.join('，'),
    certificates: toText(Object.prototype.hasOwnProperty.call(payload, 'certificates') ? payload.certificates : base.certificates) || certificateItems.join('，'),
    companyNews: toText(Object.prototype.hasOwnProperty.call(payload, 'companyNews') ? payload.companyNews : base.companyNews) || newsItems.map((item) => item.title).filter(Boolean).join('；'),
    products: Object.prototype.hasOwnProperty.call(payload, 'products') ? parseSupplierProfileProducts(payload.products) : parseSupplierProfileProducts(base.products),
    contacts,
    fitOems,
    productFitDetails: Object.prototype.hasOwnProperty.call(payload, 'productFitDetails') ? parseSupplierProductFitDetails(payload.productFitDetails) : parseSupplierProductFitDetails(base.productFitDetails),
    exportCountries,
    certificateItems,
    companyTags: Object.prototype.hasOwnProperty.call(payload, 'companyTags') ? parseSupplierCompanyTags(payload.companyTags) : parseSupplierCompanyTags(base.companyTags),
    mainProductNames: Object.prototype.hasOwnProperty.call(payload, 'mainProductNames') ? dedupeSupplierProductNames(payload.mainProductNames) : dedupeSupplierProductNames(base.mainProductNames),
    businessInfo: Object.prototype.hasOwnProperty.call(payload, 'businessInfo') ? parseSupplierBusinessInfo(payload.businessInfo) : parseSupplierBusinessInfo(base.businessInfo),
    industrialCommercialInfo: Object.prototype.hasOwnProperty.call(payload, 'industrialCommercialInfo') ? parseSupplierBusinessInfo(payload.industrialCommercialInfo) : parseSupplierBusinessInfo(base.industrialCommercialInfo),
    customerItems: Object.prototype.hasOwnProperty.call(payload, 'customerItems') ? parseSupplierCustomerItems(payload.customerItems) : parseSupplierCustomerItems(base.customerItems),
    productCaseItems: Object.prototype.hasOwnProperty.call(payload, 'productCaseItems') ? parseSupplierProductCaseItems(payload.productCaseItems) : parseSupplierProductCaseItems(base.productCaseItems),
    financingItems: Object.prototype.hasOwnProperty.call(payload, 'financingItems') ? parseSupplierFinancingItems(payload.financingItems) : parseSupplierFinancingItems(base.financingItems),
    softwareCopyrightItems: Object.prototype.hasOwnProperty.call(payload, 'softwareCopyrightItems') ? parseSupplierSoftwareCopyrightItems(payload.softwareCopyrightItems) : parseSupplierSoftwareCopyrightItems(base.softwareCopyrightItems),
    patentItems: Object.prototype.hasOwnProperty.call(payload, 'patentItems') ? parseSupplierPatentItems(payload.patentItems) : parseSupplierPatentItems(base.patentItems),
    adminLicenseItems: Object.prototype.hasOwnProperty.call(payload, 'adminLicenseItems') ? parseSupplierAdminLicenseItems(payload.adminLicenseItems) : parseSupplierAdminLicenseItems(base.adminLicenseItems),
    adminLicenseGsItems: Object.prototype.hasOwnProperty.call(payload, 'adminLicenseGsItems') ? parseSupplierAdminLicenseGsItems(payload.adminLicenseGsItems) : parseSupplierAdminLicenseGsItems(base.adminLicenseGsItems),
    tradeCreditItems: Object.prototype.hasOwnProperty.call(payload, 'tradeCreditItems') ? parseSupplierTradeCreditItems(payload.tradeCreditItems) : parseSupplierTradeCreditItems(base.tradeCreditItems),
    courtNoticeItems: Object.prototype.hasOwnProperty.call(payload, 'courtNoticeItems') ? parseSupplierCourtNoticeItems(payload.courtNoticeItems) : parseSupplierCourtNoticeItems(base.courtNoticeItems),
    productionBaseItems: Object.prototype.hasOwnProperty.call(payload, 'productionBaseItems') ? parseSupplierProductionBaseItems(payload.productionBaseItems) : parseSupplierProductionBaseItems(base.productionBaseItems),
    newsItems,
    equipmentItems: Object.prototype.hasOwnProperty.call(payload, 'equipmentItems') ? parseSupplierEquipmentItems(payload.equipmentItems) : parseSupplierEquipmentItems(base.equipmentItems),
    contactPerson: toText(primaryContact.contactPerson),
    contactTitle: toText(primaryContact.contactTitle),
    phone: toText(primaryContact.phone),
    mobile: toText(primaryContact.mobile),
    email: toText(primaryContact.email),
  }
}

async function replaceSupplierProfileChildRows(client, tableName, profileId, items, insertSql, mapItem) {
  await client.query(`DELETE FROM ${tableName} WHERE profile_id = $1`, [profileId])
  for (let idx = 0; idx < items.length; idx += 1) {
    await client.query(insertSql, mapItem(items[idx], idx))
  }
}

async function saveSupplierProfileRecord(client, id, payload) {
  const current = id ? await fetchSupplierProfileDetailById(client, id) : null
  const next = normalizeSupplierProfilePayload(payload, current)
  if (!next.companyName) throw new Error('公司名称不能为空')
  await upsertSupplierDictItems(client, supplierOemDictTable, next.fitOems)
  await upsertSupplierDictItems(client, supplierCountryDictTable, next.exportCountries)
  await upsertSupplierDictItems(client, supplierCertDictTable, next.certificateItems)
  let profileId = id
  if (profileId) {
    await client.query(
      `
      UPDATE ${supplierProfileTable}
      SET
        profile_source = $2,
        source_supplier_id = $3,
        related_node_id = $4,
        related_node_name = $5,
        related_node_ids = $6::jsonb,
        related_node_names = $7::jsonb,
        company_name = $8,
        company_name_en = $9,
        legal_representative = $10,
        org_code = $11,
        registered_capital = $12,
        established_date = $13,
        employees_count = $14,
        company_type = $15,
        contact_person = $16,
        contact_title = $17,
        phone = $18,
        mobile = $19,
        email = $20,
        website = $21,
        supplier_profile_url = $22,
        postal_code = $23,
        address = $24,
        company_intro = $25,
        fit_situation = $26,
        export_situation = $27,
        certificates = $28,
        company_news = $29,
        products = $30::jsonb,
        contacts = $31::jsonb,
        fit_oems = $32::jsonb,
        product_fit_details = $33::jsonb,
        export_countries = $34::jsonb,
        certificate_items = $35::jsonb,
        news_items = $36::jsonb,
        company_tags = $37::jsonb,
        main_product_names = $38::jsonb,
        business_info = $39::jsonb,
        industrial_commercial_info = $40::jsonb,
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        profileId,
        next.profileSource,
        next.sourceSupplierId,
        next.relatedNodeIds[0] || null,
        next.relatedNodeNames.join('，'),
        JSON.stringify(next.relatedNodeIds),
        JSON.stringify(next.relatedNodeNames),
        next.companyName,
        next.companyNameEn,
        next.legalRepresentative,
        next.orgCode,
        next.registeredCapital,
        next.establishedDate,
        next.employeesCount,
        next.companyType,
        next.contactPerson,
        next.contactTitle,
        next.phone,
        next.mobile,
        next.email,
        next.website,
        next.supplierProfileUrl,
        next.postalCode,
        next.address,
        next.companyIntro,
        next.fitSituation,
        next.exportSituation,
        next.certificates,
        next.companyNews,
        JSON.stringify(next.products),
        JSON.stringify(next.contacts),
        JSON.stringify(next.fitOems),
        JSON.stringify(next.productFitDetails),
        JSON.stringify(next.exportCountries),
        JSON.stringify(next.certificateItems),
        JSON.stringify(next.newsItems),
        JSON.stringify(next.companyTags),
        JSON.stringify(next.mainProductNames),
        JSON.stringify(next.businessInfo),
        JSON.stringify(next.industrialCommercialInfo),
      ],
    )
  } else {
    const inserted = await client.query(
      `
      INSERT INTO ${supplierProfileTable}
      (
        profile_source, source_supplier_id,
        related_node_id, related_node_name, related_node_ids, related_node_names,
        company_name, company_name_en, legal_representative, org_code, registered_capital, established_date, employees_count,
        company_type, contact_person, contact_title, phone, mobile, email, website, supplier_profile_url, postal_code, address,
        company_intro, fit_situation, export_situation, certificates, company_news, products,
        contacts, fit_oems, product_fit_details, export_countries, certificate_items, news_items,
        company_tags, main_product_names, business_info, industrial_commercial_info, updated_at
      )
      VALUES
      ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30::jsonb,$31::jsonb,$32::jsonb,$33::jsonb,$34::jsonb,$35::jsonb,$36::jsonb,$37::jsonb,$38::jsonb,$39::jsonb,NOW())
      RETURNING id
      `,
      [
        next.profileSource,
        next.sourceSupplierId,
        next.relatedNodeIds[0] || null,
        next.relatedNodeNames.join('，'),
        JSON.stringify(next.relatedNodeIds),
        JSON.stringify(next.relatedNodeNames),
        next.companyName,
        next.companyNameEn,
        next.legalRepresentative,
        next.orgCode,
        next.registeredCapital,
        next.establishedDate,
        next.employeesCount,
        next.companyType,
        next.contactPerson,
        next.contactTitle,
        next.phone,
        next.mobile,
        next.email,
        next.website,
        next.supplierProfileUrl,
        next.postalCode,
        next.address,
        next.companyIntro,
        next.fitSituation,
        next.exportSituation,
        next.certificates,
        next.companyNews,
        JSON.stringify(next.products),
        JSON.stringify(next.contacts),
        JSON.stringify(next.fitOems),
        JSON.stringify(next.productFitDetails),
        JSON.stringify(next.exportCountries),
        JSON.stringify(next.certificateItems),
        JSON.stringify(next.newsItems),
        JSON.stringify(next.companyTags),
        JSON.stringify(next.mainProductNames),
        JSON.stringify(next.businessInfo),
        JSON.stringify(next.industrialCommercialInfo),
      ],
    )
    profileId = Number(inserted.rows[0].id)
  }

  await replaceSupplierProfileChildRows(
    client,
    supplierProfileCustomerTable,
    profileId,
    next.customerItems,
    `INSERT INTO ${supplierProfileCustomerTable} (profile_id, sort_order, product_name, oem_names, updated_at) VALUES ($1,$2,$3,$4::jsonb,NOW())`,
    (item, idx) => [profileId, idx + 1, item.productName, JSON.stringify(item.oemNames)],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileProductCaseTable,
    profileId,
    next.productCaseItems,
    `INSERT INTO ${supplierProfileProductCaseTable} (profile_id, sort_order, product_name, vehicle_model, customer_name, description, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    (item, idx) => [profileId, idx + 1, item.productName, item.vehicleModel, item.customerName, item.description],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileFinancingTable,
    profileId,
    next.financingItems,
    `INSERT INTO ${supplierProfileFinancingTable} (profile_id, sort_order, financing_date, financing_round, financing_amount, investors, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    (item, idx) => [profileId, idx + 1, item.financingDate, item.round, item.amount, item.investors],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileSoftwareCopyrightTable,
    profileId,
    next.softwareCopyrightItems,
    `INSERT INTO ${supplierProfileSoftwareCopyrightTable} (profile_id, sort_order, software_name, version, release_date, software_alias, registration_no, approval_date, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    (item, idx) => [profileId, idx + 1, item.softwareName, item.version, item.releaseDate, item.softwareAlias, item.registrationNo, item.approvalDate],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfilePatentTable,
    profileId,
    next.patentItems,
    `INSERT INTO ${supplierProfilePatentTable} (profile_id, sort_order, patent_type, publication_no, publication_date, title, application_no, application_date, inventors, assignee, agency, agent, legal_status, summary, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())`,
    (item, idx) => [profileId, idx + 1, item.patentType, item.publicationNo, item.publicationDate, item.title, item.applicationNo, item.applicationDate, item.inventors, item.assignee, item.agency, item.agent, item.legalStatus, item.summary],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileAdminLicenseTable,
    profileId,
    next.adminLicenseItems,
    `INSERT INTO ${supplierProfileAdminLicenseTable} (profile_id, sort_order, document_no, authority, decision_date, content, status, valid_until, category, region, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    (item, idx) => [profileId, idx + 1, item.documentNo, item.authority, item.decisionDate, item.content, item.status, item.validUntil, item.category, item.region],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileAdminLicenseGsTable,
    profileId,
    next.adminLicenseGsItems,
    `INSERT INTO ${supplierProfileAdminLicenseGsTable} (profile_id, sort_order, permit_no, permit_name, valid_from, valid_to, authority, content, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    (item, idx) => [profileId, idx + 1, item.permitNo, item.permitName, item.validFrom, item.validTo, item.authority, item.content],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileTradeCreditTable,
    profileId,
    next.tradeCreditItems,
    `INSERT INTO ${supplierProfileTradeCreditTable} (profile_id, sort_order, customs_office, business_type, registration_date, content, registration_code, administrative_region, economic_region, credit_level, annual_report_status, validity_period, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
    (item, idx) => [profileId, idx + 1, item.customsOffice, item.businessType, item.registrationDate, item.content, item.registrationCode, item.administrativeRegion, item.economicRegion, item.creditLevel, item.annualReportStatus, item.validityPeriod],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileCourtNoticeTable,
    profileId,
    next.courtNoticeItems,
    `INSERT INTO ${supplierProfileCourtNoticeTable} (profile_id, sort_order, case_no, hearing_date, cause, plaintiff, defendant, court, tribunal, region, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    (item, idx) => [profileId, idx + 1, item.caseNo, item.hearingDate, item.cause, item.plaintiff, item.defendant, item.court, item.tribunal, item.region],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileProductionBaseTable,
    profileId,
    next.productionBaseItems,
    `INSERT INTO ${supplierProfileProductionBaseTable} (profile_id, sort_order, base_name, region, postal_code, address, phone, main_products, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    (item, idx) => [profileId, idx + 1, item.baseName, item.region, item.postalCode, item.address, item.phone, item.mainProducts],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileNewsTable,
    profileId,
    next.newsItems,
    `INSERT INTO ${supplierProfileNewsTable} (profile_id, sort_order, title, source, publish_date, content, updated_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    (item, idx) => [profileId, idx + 1, item.title, item.source, item.publishDate, item.content],
  )
  await replaceSupplierProfileChildRows(
    client,
    supplierProfileEquipmentTable,
    profileId,
    next.equipmentItems,
    `INSERT INTO ${supplierProfileEquipmentTable} (profile_id, sort_order, equipment_name, updated_at) VALUES ($1,$2,$3,NOW())`,
    (item, idx) => [profileId, idx + 1, item.equipmentName],
  )
  return profileId
}

async function collectNodeUrlsForSupplierCrawl(nodeId) {
  const sql = `
    WITH RECURSIVE node_tree AS (
      SELECT
        id,
        parent_id,
        node_title AS "nodeTitle",
        node_level AS "nodeLevel",
        COALESCE(NULLIF(node_url, ''), source_url) AS "nodeUrl",
        source_url AS "sourceUrl"
      FROM ${supplyChainNodeTable}
      WHERE id = $1
      UNION ALL
      SELECT
        child.id,
        child.parent_id,
        child.node_title AS "nodeTitle",
        child.node_level AS "nodeLevel",
        COALESCE(NULLIF(child.node_url, ''), child.source_url) AS "nodeUrl",
        child.source_url AS "sourceUrl"
      FROM ${supplyChainNodeTable} child
      INNER JOIN node_tree parent ON child.parent_id = parent.id
    )
    SELECT * FROM node_tree ORDER BY "nodeLevel" ASC, id ASC
  `
  const result = await pool.query(sql, [nodeId])
  return result.rows || []
}

function mergeSupplierRowsUnique(existingRows = [], incomingRows = []) {
  const merged = [...existingRows]
  const seen = new Set(existingRows.map((item) => `${toText(item.companyName)}@@${toText(item.detailUrl)}`))
  for (const row of incomingRows || []) {
    const key = `${toText(row.companyName)}@@${toText(row.detailUrl)}`
    if (!toText(row.companyName) || seen.has(key)) continue
    seen.add(key)
    merged.push(row)
  }
  return merged
}

async function extractSupplierPageDataByHttp(pageUrl, context = {}) {
  try {
    const fetched = await fetchTextWithRetries(pageUrl, supplierHttpTimeoutMs, supplierHttpRetryCount)
    let finalUrl = pageUrl
    let html = fetched.text
    const inlineRedirect = parseInlineRedirectUrl(html, pageUrl)
    if (
      inlineRedirect
      && inlineRedirect !== pageUrl
      && shouldFollowSupplierInlineRedirect(pageUrl, inlineRedirect)
    ) {
      const redirected = await fetchTextWithRetries(inlineRedirect, supplierHttpTimeoutMs, supplierHttpRetryCount)
      finalUrl = inlineRedirect
      html = redirected.text
    }
    if (isWafCaptchaHtml(html)) {
      return {
        rows: [],
        totalCount: 0,
        paginationUrls: [],
        finalUrl,
        source: 'http',
        diagnostics: buildSupplierHtmlDiagnostics(html, finalUrl),
        errorMessage: '检测到腾讯验证码页面，请在 web-access 浏览器完成验证码后重试',
      }
    }
    const rows = extractSupplierRowsFromCategoryHtml(html, finalUrl, {
      ...context,
      sourceUrl: context.sourceUrl || finalUrl,
    })
    const diagnostics = buildSupplierHtmlDiagnostics(html, finalUrl)
    const totalCount = extractSupplierTotalCountFromHtml(html)
    const perPage = extractSupplierPerPageFromHtml(html)
    const paginationUrls = extractSupplierPaginationUrlsFromHtml(html, finalUrl)
    const mergedPaginationUrls = paginationUrls.length > 0
      ? paginationUrls
      : buildSyntheticPaginationUrls(finalUrl, totalCount, perPage || rows.length || 10)
    if ((totalCount > 1000 || (rows.length > 0 && mergedPaginationUrls.length === 0)) && context?.nodeId) {
      try {
        const debugName = `tmp_supplier_debug_node${context.nodeId}_${Date.now()}.html`
        const debugPath = path.join(process.cwd(), debugName)
        await fs.writeFile(debugPath, html, 'utf-8')
      } catch {
        // ignore debug snapshot errors
      }
    }
    return { rows, totalCount, paginationUrls: mergedPaginationUrls, finalUrl, perPage, source: 'http', diagnostics }
  } catch {
    return { rows: [], totalCount: 0, paginationUrls: [], finalUrl: pageUrl, source: 'http', diagnostics: {} }
  }
}

async function extractSupplierPageDataByCdp(pageUrl, context = {}) {
  let targetId = ''
  let shouldCloseTarget = false
  try {
    const preferredUrl = toText(pageUrl)
    const preferredHost = safeHostFromUrl(preferredUrl)
    const preferredPath = (() => {
      try {
        return new URL(preferredUrl).pathname || ''
      } catch {
        return ''
      }
    })()
    let registeredTarget = null
    try {
      const raw = await fs.readFile(gasgooCdpTargetFile, 'utf8')
      const parsed = JSON.parse(String(raw || '{}'))
      if (toText(parsed?.targetId)) {
        registeredTarget = parsed
      }
    } catch {
      registeredTarget = null
    }
    const targetsPayload = await fetchCdpProxyJson('/targets', {}, 15000).catch(() => ({ value: [] }))
    const targets = normalizeCdpTargetsPayload(targetsPayload)
    const targetByExactUrl = targets.find((item) => toText(item?.url) === preferredUrl)
    const targetBySamePath = preferredPath
      ? targets.find((item) => {
        try {
          const u = new URL(toText(item?.url))
          return safeHostFromUrl(u.toString()) === preferredHost && (u.pathname || '') === preferredPath
        } catch {
          return false
        }
      })
      : null
    const targetByRegistered = registeredTarget?.targetId
      ? targets.find((item) => getCdpTargetId(item) === toText(registeredTarget.targetId))
      : null
    const registeredUrl = toText(targetByRegistered?.url)
    const registeredLooksRelevant = (() => {
      if (!targetByRegistered) return false
      if (!registeredUrl) return false
      if (registeredUrl === preferredUrl) return true
      try {
        const ru = new URL(registeredUrl)
        return safeHostFromUrl(registeredUrl) === preferredHost && (ru.pathname || '') === preferredPath
      } catch {
        return false
      }
    })()
    const targetByGasgooHost = targets.find((item) => safeHostFromUrl(item?.url || '').includes('gasgoo.com'))
    // Always prefer the tab that exactly matches the requested URL/path.
    const matchedTarget = targetByExactUrl || targetBySamePath || (registeredLooksRelevant ? targetByRegistered : null) || targetByGasgooHost
    const matchedTargetId = getCdpTargetId(matchedTarget)
    if (matchedTargetId) {
      targetId = matchedTargetId
    } else {
      const created = await fetchCdpProxyJson(`/new?url=${encodeURIComponent(pageUrl)}`, {}, 20000)
      targetId = getCdpTargetId(created)
      shouldCloseTarget = true
    }
    if (!targetId) throw new Error('CDP proxy did not return targetId')
    await fs.mkdir(path.dirname(gasgooCdpTargetFile), { recursive: true }).catch(() => {})
    await fs.writeFile(
      gasgooCdpTargetFile,
      JSON.stringify({ targetId, url: preferredUrl }, null, 2),
      'utf8',
    ).catch(() => {})
    await fetchCdpProxyJson(
      `/navigate?target=${encodeURIComponent(targetId)}&url=${encodeURIComponent(preferredUrl)}`,
      {},
      15000,
    ).catch(() => ({}))
    await fetchCdpProxyJson(
      `/eval?target=${encodeURIComponent(targetId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `(() => {
          const desired = ${JSON.stringify(preferredUrl)}
          const current = String(location.href || '')
          if (desired && current !== desired) {
            location.href = desired
            return { redirected: true, from: current, to: desired }
          }
          return { redirected: false, from: current, to: desired }
        })()`,
      },
      12000,
    ).catch(() => ({}))
    await new Promise((resolve) => setTimeout(resolve, 2600))
    let info = await fetchCdpProxyJson(`/info?target=${encodeURIComponent(targetId)}`, {}, 10000).catch(() => ({}))
    for (let i = 0; i < 6; i += 1) {
      const currentUrl = toText(info?.url)
      if (currentUrl && !/^about:blank$/i.test(currentUrl) && !/^chrome-error:\/\//i.test(currentUrl)) break
      await new Promise((resolve) => setTimeout(resolve, 500))
      info = await fetchCdpProxyJson(`/info?target=${encodeURIComponent(targetId)}`, {}, 10000).catch(() => info)
    }
    const evaluated = await fetchCdpProxyJson(
      `/eval?target=${encodeURIComponent(targetId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `(async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
          const toAbs = (value) => {
            try { return value ? new URL(value, location.href).toString() : '' } catch { return '' }
          }
          const pickManufacturerRows = () => Array
            .from(document.querySelectorAll('#ManufacturerList a[href*="/oemhome/"]'))
            .map((a) => ({
              companyName: String(a.textContent || '').replace(/\\s+/g, ' ').trim(),
              detailHref: String(a.getAttribute('href') || '').trim(),
            }))
            .filter((item) => item.companyName && item.detailHref)
            .map((item) => ({ ...item, detailHref: toAbs(item.detailHref) || item.detailHref }))
          for (let i = 0; i < 10; i += 1) {
            const count = pickManufacturerRows().length
            if (count >= 30) break
            await sleep(350)
          }
          let manufacturerRows = pickManufacturerRows()
          if (manufacturerRows.length < 30 && /\\/supplier\\/oem\\.html/i.test(location.pathname || '')) {
            try {
              const response = await fetch('/gasgoo/cn/sns20/webmodel/handler/SupplierHandler.ajax', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: 'Action=Manufacturers',
                credentials: 'include',
              })
              const text = await response.text()
              if (text && text.trim().startsWith('[')) {
                const data = JSON.parse(text)
                manufacturerRows = (Array.isArray(data) ? data : [])
                  .map((item) => ({
                    companyName: String(item?.ManufacturerShortName || '').replace(/\\s+/g, ' ').trim(),
                    detailHref: item?.ManufacturerId ? '/oemhome/' + String(item.ManufacturerId).trim() + '.html' : '',
                  }))
                  .filter((item) => item.companyName && item.detailHref)
                  .map((item) => ({ ...item, detailHref: toAbs(item.detailHref) || item.detailHref }))
              }
            } catch {
              // ignore ajax fallback
            }
          }
          return {
            href: location.href,
            title: document.title || '',
            readyState: document.readyState || '',
            html: document.documentElement ? document.documentElement.outerHTML : '',
            manufacturerRows,
          }
        })()`,
      },
      20000,
    )
    const payload = evaluated?.value || {}
    const finalUrl = toText(payload.href || info?.url) || pageUrl
    const html = String(payload.html || '')
    if (!html) {
      throw new Error(`CDP returned empty payload for ${finalUrl}`)
    }
    if (isWafCaptchaHtml(html)) {
      const cdpTitle = toText(payload.title || info?.title)
      const cdpUrl = toText(payload.href || info?.url || finalUrl || preferredUrl)
      throw new Error(`检测到腾讯验证码页面（CDP标题: ${cdpTitle || '-'}，URL: ${cdpUrl || '-' }），请在 web-access 浏览器完成验证码后重试`)
    }
    if (finalUrl.startsWith('chrome-error://')) {
      throw new Error(`CDP opened browser error page: ${toText(payload.title || info?.title) || finalUrl}`)
    }
    const rows = extractSupplierRowsFromCategoryHtml(html, finalUrl, {
      ...context,
      sourceUrl: context.sourceUrl || finalUrl,
    })
    if (Array.isArray(payload.manufacturerRows) && payload.manufacturerRows.length > 0) {
      for (const item of payload.manufacturerRows) {
        const fromIndex = buildSupplierSuccessRow({
          companyName: item.companyName,
          detailHref: item.detailHref,
          blockText: item.companyName,
          contactAction: '查看',
          listPageUrl: finalUrl,
          context: {
            ...context,
            sourceUrl: context.sourceUrl || finalUrl,
          },
        })
        if (!fromIndex) continue
        if (!rows.some((existing) => existing.companyName === fromIndex.companyName && existing.detailUrl === fromIndex.detailUrl)) {
          rows.push(fromIndex)
        }
      }
    }
    const diagnostics = {
      ...(buildSupplierHtmlDiagnostics(html, finalUrl) || {}),
      cdpTitle: toText(payload.title || info?.title),
      cdpReadyState: toText(payload.readyState || info?.ready),
      cdpMode: shouldCloseTarget ? 'web-access-proxy' : 'web-access-existing-tab',
    }
    const totalCount = extractSupplierTotalCountFromHtml(html)
    const perPage = extractSupplierPerPageFromHtml(html)
    const paginationUrls = extractSupplierPaginationUrlsFromHtml(html, finalUrl)
    const mergedPaginationUrls = paginationUrls.length > 0
      ? paginationUrls
      : buildSyntheticPaginationUrls(finalUrl, totalCount, perPage || rows.length || 10)
    return { rows, totalCount, paginationUrls: mergedPaginationUrls, finalUrl, perPage, source: 'cdp-web-access', diagnostics, html }
  } catch (error) {
    const rawMessage = toText(error?.message || 'cdp fetch failed')
    const isCaptcha = /验证码|captcha|WafCaptcha|TencentCaptcha/i.test(rawMessage)
    const friendlyMessage = isCaptcha
      ? '检测到腾讯验证码页面，请在 web-access 浏览器完成验证码后重试'
      : (/ECONNREFUSED|Failed to fetch|abort|timed out|CDP proxy HTTP/i.test(rawMessage)
        ? 'web-access CDP 服务不可用，请先启动 web-access 服务；用 Chrome 打开并确认目标页加载完成后重试'
        : rawMessage)
    return {
      rows: [],
      totalCount: 0,
      paginationUrls: [],
      finalUrl: pageUrl,
      source: 'cdp-web-access',
      diagnostics: {},
      html: '',
      errorMessage: friendlyMessage,
    }
  } finally {
    if (targetId && shouldCloseTarget) {
      await fetchCdpProxyJson(`/close?target=${encodeURIComponent(targetId)}`, {}, 10000).catch(() => {})
    }
  }
}

function hasSupplierDetailPayload(detail = {}) {
  if (!detail || typeof detail !== 'object') return false
  return Boolean(
    toText(detail.companyName)
    || toText(detail.mainProducts)
    || toText(detail.companyIntro)
    || toText(detail.legalRepresentative),
  )
}

function hasSupplierAtomicEnrichment(detail = {}) {
  if (!detail || typeof detail !== 'object') return false
  return Boolean(
    toText(detail.mainProducts)
    || toText(detail.region)
    || toText(detail.registeredCapital)
    || toText(detail.establishedDate)
    || toText(detail.fitExport)
    || toText(detail.qualitySystem),
  )
}

function hasSupplierCriticalEnrichment(detail = {}) {
  if (!detail || typeof detail !== 'object') return false
  const normalized = normalizeSupplierDetailAtomicFields(detail)
  const region = toText(normalized.region)
  const validRegion = Boolean(region) && !/有限责任公司|股份有限公司|集团|科技有限公司|制造有限|实业有限公司|新能源有限公司/.test(region)
  return Boolean(
    toText(normalized.mainProducts)
    || toText(normalized.registeredCapital)
    || toText(normalized.establishedDate)
    || validRegion,
  )
}

function shouldSupplementSupplierDetailByPlaywright(detail = {}, detailUrl = '') {
  if (!hasSupplierDetailPayload(detail)) return true
  const fitSituationText = toText(detail.fitSituation)
  const exportSituationText = toText(detail.exportSituation)
  const validContact = /(联系人|电话|手机|邮箱|@|1[3-9]\d{9}|0\d{2,3}-?\d{7,8})/i.test(toText(detail.contactAction))
  const validProducts = toText(detail.mainProducts).length >= 2 && !looksLikeSupplierTabMenuNoise(detail.mainProducts)
  const validFitExport = toText(detail.fitExport).length >= 2 && !looksLikeSupplierTabMenuNoise(detail.fitExport)
  const validQuality = /(IATF|ISO|VDA|QS|TS|认证|证书)/i.test(toText(detail.qualitySystem))
  const validIntro = toText(detail.companyIntro).length >= 24 && !looksLikeSupplierTabMenuNoise(detail.companyIntro)
  const fitTabMissing = !fitSituationText
  const exportTabMissing = !exportSituationText
  const fitExportPolluted = hasSupplierFieldPollution(
    toText(detail.fitExport),
    ['配套/出口', '配套出口', '配套情况', '出口情况', '出口国家', '出口'],
  )
  const fitSituationPolluted = hasSupplierFieldPollution(fitSituationText, ['配套情况', '配套说明', '配套'])
    || /收藏企业|公司简介|重点产品|公司新闻|公司视频|联系我们/i.test(fitSituationText)
  const exportSituationPolluted = hasSupplierFieldPollution(exportSituationText, ['出口情况', '出口国家', '出口'])
    || /收藏企业|公司简介|重点产品|公司新闻|公司视频|联系我们/i.test(exportSituationText)
  const qualityMissing = !validQuality
  const missingScore = [
    !validContact,
    !validProducts,
    !validFitExport,
    qualityMissing,
    !validIntro,
    fitTabMissing && exportTabMissing,
    fitExportPolluted,
    fitSituationPolluted,
    exportSituationPolluted,
  ].filter(Boolean).length
  if (/\/company\.php\?mid=\d+/i.test(toText(detailUrl)) && (
    fitTabMissing
    || exportTabMissing
    || fitExportPolluted
    || fitSituationPolluted
    || exportSituationPolluted
  )) {
    return true
  }
  return missingScore >= 2
}

function buildSupplierRowFromDetail(detail = {}, context = {}, sourceUrl = '', detailUrl = '', options = {}) {
  const normalized = normalizeSupplierDetailAtomicFields(detail)
  const brandVehicle = extractGasOemBrandVehicleFromText(
    [toText(detail.brand), toText(detail.vehicleModel), toText(normalized.mainProducts)].filter(Boolean).join('；'),
  )
  return {
    nodeId: context.nodeId || null,
    nodeName: context.nodeName || '',
    model: context.model || '',
    skill: context.skill || '',
    sourceUrl: context.sourceUrl || sourceUrl || detailUrl || '',
    listPageUrl: sourceUrl || detailUrl || '',
    detailUrl: detailUrl || sourceUrl || '',
    companyName: sanitizeSupplierCompanyName(toText(normalized.companyName)),
    brand: cleanSupplierFieldText(toText(detail.brand) || brandVehicle.brand),
    vehicleModel: cleanSupplierFieldText(toText(detail.vehicleModel) || brandVehicle.vehicleModel),
    mainProducts: toText(normalized.mainProducts),
    fitSituation: cleanSupplierFieldText(toText(detail.fitSituation)),
    exportSituation: cleanSupplierFieldText(toText(detail.exportSituation)),
    fitExport: toText(normalized.fitExport),
    qualitySystem: toText(normalized.qualitySystem),
    region: toText(normalized.region),
    contactAction: toText(normalized.contactAction),
    website: cleanSupplierFieldText(toText(detail.website) || detailUrl || sourceUrl),
    supplierProfileUrl: cleanSupplierFieldText(toText(detail.supplierProfileUrl) || detailUrl || sourceUrl),
    address: cleanSupplierFieldText(toText(detail.address)),
    companyIntro: toText(normalized.companyIntro),
    certificates: sanitizeSupplierCertificatesText(toText(detail.certificates)),
    companyType: toText(normalized.companyType),
    orgCode: toText(normalized.orgCode),
    establishedDate: toText(normalized.establishedDate),
    registeredCapital: toText(normalized.registeredCapital),
    employeesCount: toText(normalized.employeesCount),
    legalRepresentative: toText(normalized.legalRepresentative),
    newsSummary: toText(normalized.newsSummary),
    newsItems: Array.isArray(detail.newsItems) ? parseSupplierNewsItems(detail.newsItems) : [],
    companyTags: parseSupplierCompanyTags(detail.companyTags),
    businessInfo: parseSupplierBusinessInfo(detail.businessInfo),
    industrialCommercialInfo: parseSupplierBusinessInfo(detail.industrialCommercialInfo),
    mainProductNames: dedupeSupplierProductNames(detail.mainProductNames || splitSupplierProductTexts(normalized.mainProducts)),
    customerItems: parseSupplierCustomerItems(detail.customerItems),
    productCaseItems: parseSupplierProductCaseItems(detail.productCaseItems),
    financingItems: parseSupplierFinancingItems(detail.financingItems),
    softwareCopyrightItems: parseSupplierSoftwareCopyrightItems(detail.softwareCopyrightItems),
    patentItems: parseSupplierPatentItems(detail.patentItems),
    adminLicenseItems: parseSupplierAdminLicenseItems(detail.adminLicenseItems),
    adminLicenseGsItems: parseSupplierAdminLicenseGsItems(detail.adminLicenseGsItems),
    tradeCreditItems: parseSupplierTradeCreditItems(detail.tradeCreditItems),
    courtNoticeItems: parseSupplierCourtNoticeItems(detail.courtNoticeItems),
    productionBaseItems: parseSupplierProductionBaseItems(detail.productionBaseItems),
    status: toText(options.status) || 'success',
    errorMessage: toText(options.errorMessage),
  }
}

async function extractSupplierDetailDataByPlaywright(url, context = {}) {
  let session
  try {
    session = await createSupplierPlaywrightSession(url, context)
    const page = session.page
    await page.route('**/*', (route) => {
      const type = route.request().resourceType()
      if (type === 'image' || type === 'font' || type === 'media') return route.abort()
      return route.continue()
    })
    let gotoErrorMessage = ''
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: supplierPlaywrightGotoTimeoutMs })
    } catch (error) {
      gotoErrorMessage = error?.message || 'domcontentloaded goto failed'
      try {
        await page.goto(url, { waitUntil: 'commit', timeout: supplierPlaywrightGotoTimeoutMs })
      } catch (fallbackError) {
        gotoErrorMessage = fallbackError?.message || gotoErrorMessage || 'commit goto failed'
        // keep current DOM and continue with best-effort waits
      }
    }
    await waitForSupplierDetailDomReady(page)
    const finalUrl = page.url()
    if (String(finalUrl || '').startsWith('chrome-error://')) {
      throw new Error(gotoErrorMessage || `playwright navigation failed: ${url}`)
    }
    const snapshots = []
    const seenPlain = new Set()
    const discoveredTabMeta = new Map()
    const registerTabMeta = (items = []) => {
      for (const item of items) {
        const tabUrl = toText(item?.url || '')
        if (!tabUrl) continue
        discoveredTabMeta.set(tabUrl, {
          label: cleanSupplierFieldText(item?.label || ''),
          tabKey: toText(item?.tabKey || classifySupplierDetailTab(item?.label, tabUrl)),
        })
      }
    }
    const pushSnapshot = (label, htmlText, pageUrl, tabKey = '') => {
      const plainText = decodeBasicHtmlEntities(stripHtml(String(htmlText || ''))).replace(/\s+/g, ' ').trim()
      if (!plainText) return
      const key = `${label}@@${plainText.slice(0, 220)}`
      if (seenPlain.has(key)) return
      seenPlain.add(key)
      snapshots.push({
        label,
        tabKey: toText(tabKey || classifySupplierDetailTab(label, pageUrl || finalUrl)),
        html: String(htmlText || ''),
        plain: plainText,
        url: pageUrl || finalUrl,
      })
    }

    const discoveredSubpageUrls = new Set(buildSupplierDetailTabUrls(finalUrl || url))
    const firstHtml = await page.content()
    registerTabMeta(discoverSupplierDetailTabLinksFromHtml(firstHtml, page.url()))
    pushSnapshot('首页', firstHtml, page.url(), 'home')
    if (isGasgooSupplierUrl(finalUrl || url)) {
      const gasgooDetail = extractGasgooSupplierOverviewFromHtml(firstHtml, finalUrl || url)
      if (hasSupplierDetailPayload(gasgooDetail)) {
        return {
          detail: gasgooDetail,
          finalUrl,
          html: firstHtml,
          plain: decodeBasicHtmlEntities(stripHtml(firstHtml)).replace(/\s+/g, ' ').trim(),
          source: 'playwright',
          context,
          sessionMode: session?.mode || '',
          profileLabel: session?.profileLabel || '',
          launchError: session?.launchError || '',
        }
      }
    }
    for (const discovered of discoverSupplierDetailSubpageUrlsFromHtml(firstHtml, page.url())) {
      discoveredSubpageUrls.add(discovered)
    }
    for (const discovered of await discoverSupplierDetailSubpageUrls(page, page.url())) {
      discoveredSubpageUrls.add(discovered)
    }

    const subpageGotoTimeout = Math.max(12000, Math.min(30000, supplierPlaywrightGotoTimeoutMs))
    const visitedUrls = new Set([page.url()])
    const queuedUrls = new Set([...discoveredSubpageUrls])
    const pendingUrls = [...discoveredSubpageUrls]
    while (pendingUrls.length > 0 && visitedUrls.size < 24) {
      const subUrl = pendingUrls.shift()
      if (!subUrl || visitedUrls.has(subUrl)) continue
      try {
        visitedUrls.add(subUrl)
        try {
          await page.goto(subUrl, { waitUntil: 'domcontentloaded', timeout: subpageGotoTimeout })
        } catch {
          try {
            await page.goto(subUrl, { waitUntil: 'commit', timeout: subpageGotoTimeout })
          } catch {
            // keep current DOM and continue with best-effort waits
          }
        }
        await waitForSupplierDetailDomReady(page)
        const subHtml = await page.content()
        registerTabMeta(discoverSupplierDetailTabLinksFromHtml(subHtml, page.url()))
        const tabMeta = discoveredTabMeta.get(subUrl) || discoveredTabMeta.get(page.url()) || {}
        const fallbackLabel = `子页:${new URL(subUrl).pathname}`
        pushSnapshot(tabMeta.label || fallbackLabel, subHtml, page.url(), tabMeta.tabKey || classifySupplierDetailTab(tabMeta.label || '', subUrl))
        const newlyDiscovered = [
          ...discoverSupplierDetailSubpageUrlsFromHtml(subHtml, page.url()),
          ...(await discoverSupplierDetailSubpageUrls(page, page.url())),
        ]
        for (const candidate of newlyDiscovered) {
          if (!candidate || queuedUrls.has(candidate) || visitedUrls.has(candidate)) continue
          queuedUrls.add(candidate)
          pendingUrls.push(candidate)
        }
      } catch {
        // ignore subpage failures
      }
    }

    let detail = {}
    for (const snap of snapshots) {
      const parsed = extractSupplierDetailFromHtml(snap.html, snap.url)
      const tabKey = toText(snap.tabKey || classifySupplierDetailTab(snap.label, snap.url))
      if (!toText(detail.companyName) && toText(parsed.companyName)) detail.companyName = sanitizeSupplierCompanyName(parsed.companyName)
      applySupplierDetailField(detail, 'companyType', parsed.companyType)
      applySupplierDetailField(detail, 'legalRepresentative', parsed.legalRepresentative)
      applySupplierDetailField(detail, 'registeredCapital', parsed.registeredCapital)
      applySupplierDetailField(detail, 'establishedDate', parsed.establishedDate)
      applySupplierDetailField(detail, 'employeesCount', parsed.employeesCount)

      if (tabKey === 'intro') {
        if (!isSupplierFieldLikelyNoise('companyIntro', parsed.companyIntro) && toText(parsed.companyIntro).length >= 20) {
          detail.companyIntro = parsed.companyIntro
        }
      } else if (tabKey === 'goods') {
        const productNames = extractSupplierProductNamesFromHtml(snap.html)
        if (productNames.length > 0) detail.mainProducts = productNames.join('；')
        else applySupplierDetailField(detail, 'mainProducts', parsed.mainProducts)
      } else if (tabKey === 'fit' || tabKey === 'export') {
        if (tabKey === 'fit') {
          applySupplierDetailField(detail, 'fitSituation', parsed.fitSituation || parsed.fitExport)
        } else {
          applySupplierDetailField(detail, 'exportSituation', parsed.exportSituation || parsed.fitExport)
        }
        applySupplierDetailField(
          detail,
          'fitExport',
          cleanSupplierFieldText([
            toText(detail.fitSituation),
            toText(detail.exportSituation),
            parsed.fitExport,
          ].filter(Boolean).join('；')),
        )
        applySupplierDetailField(detail, 'region', parsed.region)
      } else if (tabKey === 'cert') {
        applySupplierDetailField(detail, 'qualitySystem', parsed.qualitySystem)
      } else if (tabKey === 'news') {
        applySupplierDetailField(detail, 'newsSummary', parsed.newsSummary)
      } else if (tabKey === 'contact') {
        applySupplierDetailField(detail, 'contactAction', parsed.contactAction)
        applySupplierDetailField(detail, 'region', parsed.region)
        if (!toText(detail.website) && toText(parsed.website)) detail.website = cleanSupplierFieldText(parsed.website)
        if (!toText(detail.address) && toText(parsed.address)) detail.address = cleanSupplierFieldText(parsed.address)
      } else {
        applySupplierDetailField(detail, 'mainProducts', parsed.mainProducts)
        applySupplierDetailField(detail, 'fitExport', parsed.fitExport)
        applySupplierDetailField(detail, 'qualitySystem', parsed.qualitySystem)
        applySupplierDetailField(detail, 'contactAction', parsed.contactAction)
        applySupplierDetailField(detail, 'companyIntro', parsed.companyIntro)
        applySupplierDetailField(detail, 'region', parsed.region)
        if (!toText(detail.website) && toText(parsed.website)) detail.website = cleanSupplierFieldText(parsed.website)
        if (!toText(detail.address) && toText(parsed.address)) detail.address = cleanSupplierFieldText(parsed.address)
      }
    }
    detail.fitExport = cleanSupplierFieldText([detail.fitSituation, detail.exportSituation, detail.fitExport].filter(Boolean).join('；'))
    detail = normalizeSupplierDetailAtomicFields(detail)
    const mergedHtml = snapshots
      .map((snap) => `<!-- TAB:${snap.label} URL:${snap.url} -->\n${snap.html}`)
      .join('\n\n')
    const mergedPlain = snapshots.map((snap) => snap.plain).join(' ')
    return {
      detail,
      finalUrl,
      html: mergedHtml,
      plain: mergedPlain,
      source: 'playwright',
      context,
      sessionMode: session?.mode || '',
      profileLabel: session?.profileLabel || '',
      launchError: session?.launchError || '',
    }
  } finally {
    if (session?.close) await session.close()
  }
}

async function extractSupplierDetailDataByWebAccessCdp(url, context = {}) {
  const cdpData = await extractSupplierPageDataByCdp(url, context)
  const finalUrl = toText(cdpData?.finalUrl) || toText(url)
  const html = String(cdpData?.html || '')
  const plain = decodeBasicHtmlEntities(stripHtml(html)).replace(/\s+/g, ' ').trim()
  const parsed = isGasgooSupplierUrl(finalUrl)
    ? extractGasgooSupplierOverviewFromHtml(html, finalUrl)
    : extractSupplierDetailFromHtml(html, finalUrl)
  const llmDetail = await extractSupplierDetailByLlm({
    html,
    plain,
    detailUrl: finalUrl,
    model: context?.model || 'gpt-5.4',
  })
  return {
    detail: mergeSupplierDetailWithLlm(parsed || {}, llmDetail || {}),
    finalUrl,
    html,
    plain,
    sessionMode: 'web-access-cdp',
    profileLabel: 'chrome:remote-debugging',
    launchError: '',
  }
}

async function crawlSupplierDetailByUrlVariants(url, context, task, nowText) {
  const candidateUrls = buildSupplierDetailUrlCandidates(url)
  task?.runLogs?.push(`${nowText()} | 详情模式：URL变体 ${candidateUrls.length} 个`)
  const useWebAccess = isWebAccessSkill(context?.skill)
  const preferPlaywright = !useWebAccess && /playwright/i.test(toText(context?.skill))
  const strategyText = useWebAccess
    ? 'web-access(CDP)逐URL浏览器解析'
    : (preferPlaywright ? '优先 Playwright（按所选技能）' : '优先 HTTP（失败再 Playwright）')
  task?.runLogs?.push(`${nowText()} | 详情抓取策略：${strategyText}`)
  let lastError = ''
  const variantErrors = []
  for (let idx = 0; idx < candidateUrls.length; idx += 1) {
    const candidateUrl = candidateUrls[idx]
    task?.runLogs?.push(`${nowText()} | 尝试详情变体[${idx + 1}/${candidateUrls.length}]：${candidateUrl}`)
    if (useWebAccess) {
      try {
        const cdpData = await withTimeout(
          extractSupplierDetailDataByWebAccessCdp(candidateUrl, context),
          90000,
          'web-access cdp detail timeout',
        )
        const finalUrl = toText(cdpData?.finalUrl) || candidateUrl
        const detail = cdpData?.detail || {}
        task?.runLogs?.push(
          `${nowText()} | web-access会话：${cdpData?.sessionMode || 'unknown'}${cdpData?.profileLabel ? `，profile=${cdpData.profileLabel}` : ''}`,
        )
        task?.runLogs?.push(
          `${nowText()} | web-access聚合结果：name=${toText(detail.companyName).slice(0, 40) || '-'}，intro=${toText(detail.companyIntro).length}，products=${toText(detail.mainProducts).length}，fit=${toText(detail.fitSituation).length}，export=${toText(detail.exportSituation).length}，contact=${toText(detail.contactAction).length}，quality=${toText(detail.qualitySystem).length}`,
        )
        if (hasSupplierDetailPayload(detail) && isLikelyCompanyName(detail.companyName || '')) {
          task?.runLogs?.push(`${nowText()} | 详情页抓取：${candidateUrl}，识别企业 ${detail.companyName}`)
          return {
            rows: [buildSupplierRowFromDetail(detail, context, url, finalUrl)],
            candidateUrls,
            totalCount: 1,
          }
        }
        if (hasSupplierDetailPayload(detail)) {
          task?.runLogs?.push(`${nowText()} | 详情页抓取：${candidateUrl}，识别基础信息成功`)
          return {
            rows: [buildSupplierRowFromDetail(detail, context, url, finalUrl)],
            candidateUrls,
            totalCount: 1,
          }
        }
        lastError = '详情页解析为空'
        variantErrors.push(`${candidateUrl} -> ${lastError}`)
      } catch (error) {
        lastError = error?.message || 'unknown error'
        variantErrors.push(`${candidateUrl} -> ${lastError}`)
      }
      continue
    }
    try {
      let finalUrl = candidateUrl
      let supplementAttempted = false
      let supplementSucceeded = false
      let supplementErrorMessage = ''
      let detail = {}
      let html = ''
      let mergedPlain = ''

      if (preferPlaywright) {
        task?.runLogs?.push(`${nowText()} | 详情变体[${idx + 1}] 直接使用 Playwright 抓取`)
        const playwrightData = await withTimeout(
          extractSupplierDetailDataByPlaywright(candidateUrl, context),
          80000,
          'playwright detail primary timeout',
        )
        task?.runLogs?.push(
          `${nowText()} | Playwright会话：${playwrightData.sessionMode || 'unknown'}${playwrightData.profileLabel ? `，profile=${playwrightData.profileLabel}` : ''}${playwrightData.launchError ? `，fallback=${playwrightData.launchError}` : ''}`,
        )
        supplementAttempted = true
        supplementSucceeded = !String(playwrightData.finalUrl || '').startsWith('chrome-error://')
        detail = mergeSupplierDetailWithLlm(detail, playwrightData.detail || {})
        html = String(playwrightData.html || '')
        mergedPlain = String(playwrightData.plain || '')
        if (supplementSucceeded) {
          finalUrl = playwrightData.finalUrl || finalUrl
        }
        const llmDetailByPlaywright = await extractSupplierDetailByLlm({
          html,
          plain: mergedPlain,
          detailUrl: playwrightData.finalUrl || finalUrl,
          model: context?.model || 'gpt-5.4',
        })
        detail = mergeSupplierDetailWithLlm(detail, llmDetailByPlaywright)
        task?.runLogs?.push(
          `${nowText()} | Playwright聚合结果：name=${toText(detail.companyName).slice(0, 40) || '-'}，intro=${toText(detail.companyIntro).length}，products=${toText(detail.mainProducts).length}，fit=${toText(detail.fitSituation).length}，export=${toText(detail.exportSituation).length}，contact=${toText(detail.contactAction).length}，quality=${toText(detail.qualitySystem).length}`,
        )
        if (shouldSupplementSupplierDetailByPlaywright(detail, finalUrl || candidateUrl)) {
          task?.runLogs?.push(`${nowText()} | Playwright结果仍不完整，回退尝试 HTTP 聚合`)
          const httpData = await fetchSupplierDetailAggregateByHttp(candidateUrl, { homepageOnly: context?.homepageOnly })
          const llmDetailByHttp = await extractSupplierDetailByLlm({
            html: httpData.mergedHtml,
            plain: httpData.mergedPlain,
            detailUrl: finalUrl,
            model: context?.model || 'gpt-5.4',
          })
          detail = mergeSupplierDetailWithLlm(detail, httpData.detail || {})
          detail = mergeSupplierDetailWithLlm(detail, llmDetailByHttp)
          html = `${html || ''}\n\n${httpData.mergedHtml || ''}`.trim()
          mergedPlain = `${mergedPlain || ''} ${httpData.mergedPlain || ''}`.trim()
          task?.runLogs?.push(
            `${nowText()} | HTTP回退结果：name=${toText(detail.companyName).slice(0, 40) || '-'}，intro=${toText(detail.companyIntro).length}，products=${toText(detail.mainProducts).length}，fit=${toText(detail.fitSituation).length}，export=${toText(detail.exportSituation).length}，contact=${toText(detail.contactAction).length}，quality=${toText(detail.qualitySystem).length}`,
          )
        }
      } else {
        const httpData = await fetchSupplierDetailAggregateByHttp(candidateUrl, { homepageOnly: context?.homepageOnly })
        detail = httpData.detail || {}
        html = httpData.mergedHtml
        mergedPlain = httpData.mergedPlain
        const llmDetail = await extractSupplierDetailByLlm({
          html,
          plain: mergedPlain,
          detailUrl: finalUrl,
          model: context?.model || 'gpt-5.4',
        })
        detail = mergeSupplierDetailWithLlm(detail, llmDetail)
        task?.runLogs?.push(
          `${nowText()} | HTTP聚合结果：name=${toText(detail.companyName).slice(0, 40) || '-'}，intro=${toText(detail.companyIntro).length}，products=${toText(detail.mainProducts).length}，fit=${toText(detail.fitSituation).length}，export=${toText(detail.exportSituation).length}，contact=${toText(detail.contactAction).length}，quality=${toText(detail.qualitySystem).length}`,
        )
        if (shouldSupplementSupplierDetailByPlaywright(detail, finalUrl || candidateUrl)) {
          supplementAttempted = true
          task?.runLogs?.push(`${nowText()} | 详情变体[${idx + 1}] 触发 Playwright 补抓（多tab/子页）`)
          try {
            const playwrightData = await withTimeout(
              extractSupplierDetailDataByPlaywright(candidateUrl, context),
              80000,
              'playwright detail supplement timeout',
            )
            task?.runLogs?.push(
              `${nowText()} | Playwright补抓会话：${playwrightData.sessionMode || 'unknown'}${playwrightData.profileLabel ? `，profile=${playwrightData.profileLabel}` : ''}${playwrightData.launchError ? `，fallback=${playwrightData.launchError}` : ''}`,
            )
            supplementSucceeded = !String(playwrightData.finalUrl || '').startsWith('chrome-error://')
            detail = mergeSupplierDetailWithLlm(detail, playwrightData.detail || {})
            const llmDetailByPlaywright = await extractSupplierDetailByLlm({
              html: `${html || ''}\n\n${playwrightData.html || ''}`,
              plain: `${decodeBasicHtmlEntities(stripHtml(String(html || ''))).replace(/\s+/g, ' ').trim()} ${playwrightData.plain || ''}`.trim(),
              detailUrl: playwrightData.finalUrl || finalUrl,
              model: context?.model || 'gpt-5.4',
            })
            detail = mergeSupplierDetailWithLlm(detail, llmDetailByPlaywright)
            if (!String(playwrightData.finalUrl || '').startsWith('chrome-error://')) {
              finalUrl = playwrightData.finalUrl || finalUrl
            }
          } catch (pwError) {
            supplementErrorMessage = pwError?.message || 'unknown error'
            task?.runLogs?.push(`${nowText()} | Playwright 补抓失败，保留 HTTP 结果：${pwError?.message || 'unknown error'}`)
          }
        }
      }
      const stillIncompleteAfterSupplement = (
        isSupplierDetailEntryUrl(candidateUrl)
        && shouldSupplementSupplierDetailByPlaywright(detail, finalUrl || candidateUrl)
      )
      if (stillIncompleteAfterSupplement && supplementAttempted && !supplementSucceeded) {
        lastError = supplementErrorMessage || 'detail_tabs_unavailable_after_playwright'
        variantErrors.push(`${candidateUrl} -> ${lastError}`)
        task?.runLogs?.push(`${nowText()} | 详情页结果仍不完整，判定为失败，避免脏数据入库：${candidateUrl}`)
        continue
      }
      if (hasSupplierDetailPayload(detail) && isLikelyCompanyName(detail.companyName || '')) {
        task?.runLogs?.push(`${nowText()} | 详情页抓取：${candidateUrl}，识别企业 ${detail.companyName}`)
        return {
          rows: [buildSupplierRowFromDetail(detail, context, url, finalUrl)],
          candidateUrls,
          totalCount: 1,
        }
      }
      if (hasSupplierDetailPayload(detail)) {
        task?.runLogs?.push(`${nowText()} | 详情页抓取：${candidateUrl}，识别基础信息成功`)
        return {
          rows: [buildSupplierRowFromDetail(detail, context, url, finalUrl)],
          candidateUrls,
          totalCount: 1,
        }
      }
      lastError = '详情页解析为空'
      variantErrors.push(`${candidateUrl} -> ${lastError}`)
    } catch (error) {
      lastError = error.message || 'unknown error'
      if (/aborted|timeout|timed out/i.test(lastError)) {
        try {
          if (preferPlaywright) {
            task?.runLogs?.push(`${nowText()} | Playwright 超时，回退尝试 HTTP 详情抓取`)
            const httpOnly = await fetchSupplierDetailAggregateByHttp(candidateUrl, { homepageOnly: context?.homepageOnly })
            let fallbackDetail = httpOnly.detail || {}
            if (hasSupplierDetailPayload(fallbackDetail)) {
              task?.runLogs?.push(`${nowText()} | HTTP 回退成功：${candidateUrl}`)
              return {
                rows: [buildSupplierRowFromDetail(fallbackDetail, context, url, candidateUrl)],
                candidateUrls,
                totalCount: 1,
              }
            }
          } else {
            task?.runLogs?.push(`${nowText()} | HTTP 超时，直接尝试 Playwright 详情抓取`)
            const pwOnly = await withTimeout(
              extractSupplierDetailDataByPlaywright(candidateUrl, context),
              80000,
              'playwright detail fallback timeout',
            )
            const fallbackDetail = pwOnly.detail || {}
            if (hasSupplierDetailPayload(fallbackDetail)) {
              task?.runLogs?.push(`${nowText()} | Playwright 直抓成功：${candidateUrl}`)
              return {
                rows: [buildSupplierRowFromDetail(fallbackDetail, context, url, pwOnly.finalUrl || candidateUrl)],
                candidateUrls,
                totalCount: 1,
              }
            }
          }
        } catch (pwFallbackError) {
          const fallbackMessage = pwFallbackError?.message || 'unknown error'
          variantErrors.push(`${candidateUrl} -> ${lastError}；回退失败：${fallbackMessage}`)
          task?.runLogs?.push(`${nowText()} | 详情抓取回退失败：${fallbackMessage}`)
        }
      } else {
        variantErrors.push(`${candidateUrl} -> ${lastError}`)
      }
    }
  }
  return {
    rows: [],
    candidateUrls,
    totalCount: 0,
    errorMessage: variantErrors.length > 0 ? variantErrors.join(' | ') : lastError,
  }
}

async function crawlSupplierRowsByUrlVariants(url, context, task, nowText) {
  const candidateUrls = buildSupplierUrlCandidates(url)
  task?.runLogs?.push(`${nowText()} | 列表模式：URL变体 ${candidateUrls.length} 个`)
  const useWebAccess = isWebAccessSkill(context?.skill)
  const preferPlaywright = !useWebAccess && /playwright/i.test(toText(context?.skill))
  task?.runLogs?.push(`${nowText()} | 抓取策略：${preferPlaywright ? '优先 Playwright（按所选技能）' : (useWebAccess ? '优先 web-access(CDP)，失败回退 HTTP' : '优先 HTTP（失败再 Playwright）')}`)
  let best = { rows: [], totalCount: 0, paginationUrls: [], candidateUrl: '', pagesVisited: 0 }
  let webAccessLastError = ''
  let lastEmptyPageDiagnostic = ''

  for (let candidateIndex = 0; candidateIndex < candidateUrls.length; candidateIndex += 1) {
    const candidateUrl = candidateUrls[candidateIndex]
    const candidateStart = Date.now()
    task?.runLogs?.push(`${nowText()} | 尝试列表变体[${candidateIndex + 1}/${candidateUrls.length}]：${candidateUrl}`)
    const pendingPages = [candidateUrl]
    const seenPages = new Set()
    const seenPageKeys = new Set()
    let collectedRows = []
    let expectedTotal = 0
    let totalByCandidate = 0

    while (pendingPages.length > 0 && seenPages.size < 80) {
      const pageUrl = pendingPages.shift()
      const pageKey = buildSupplierPaginationPageKey(pageUrl)
      if (!pageUrl || seenPages.has(pageUrl) || (pageKey && seenPageKeys.has(pageKey))) continue
      seenPages.add(pageUrl)
      if (pageKey) seenPageKeys.add(pageKey)
      task?.runLogs?.push(`${nowText()} | 抓取分页：${pageUrl}（第 ${seenPages.size} 页）`)

      let pageData
      let pageSource
      if (preferPlaywright) {
        pageData = await extractSupplierPageDataWithPlaywright(pageUrl, context)
        pageSource = 'Playwright'
        if (pageData.rows.length === 0) {
          task?.runLogs?.push(`${nowText()} | 分页Playwright结果为空，切换 HTTP：${pageUrl}`)
          pageData = await extractSupplierPageDataByHttp(pageUrl, context)
          pageSource = 'HTTP'
        }
      } else if (useWebAccess) {
        pageData = await withTimeout(
          extractSupplierPageDataByCdp(pageUrl, context),
          45000,
          'web-access cdp page timeout',
        )
        pageSource = 'web-access(CDP)'
        if (pageData.rows.length === 0) {
          const d = pageData?.diagnostics || {}
          task?.runLogs?.push(
            `${nowText()} | CDP空页诊断：title=${toText(d.pageTitle) || '-'}，textLen=${Number(d.pageTextLen || 0)}，li.alists=${Number(d.liAlistsCount || 0)}，tr=${Number(d.trCount || 0)}，companyLinks=${Number(d.companyLinkCount || 0)}，url=${toText(pageData.finalUrl || pageUrl)}`,
          )
          if (isGasgooOemListUrl(pageUrl) && (pageData.paginationUrls || []).length === 0) {
            const fallbackPages = buildGasgooOemPaginationUrls(pageUrl, 15)
            if (fallbackPages.length > 0) {
              pageData.paginationUrls = fallbackPages
              task?.runLogs?.push(`${nowText()} | oem分页兜底：自动补充 ${fallbackPages.length} 页候选链接`)
            }
          }
          webAccessLastError = toText(pageData.errorMessage || webAccessLastError)
          const cdpUnavailable = /CDP 服务不可用|ECONNREFUSED|fetch failed|timed out|timeout|aborted/i.test(toText(pageData.errorMessage))
          const cdpCaptcha = /验证码|captcha|WafCaptcha|TencentCaptcha/i.test(toText(pageData.errorMessage))
          if (cdpUnavailable || cdpCaptcha) {
            const fallbackReason = cdpCaptcha ? '验证码阻断' : '连接异常'
            task?.runLogs?.push(`${nowText()} | 分页web-access${fallbackReason}，切换 HTTP：${pageUrl}${pageData.errorMessage ? `，原因：${pageData.errorMessage}` : ''}`)
            pageData = await extractSupplierPageDataByHttp(pageUrl, context)
            pageSource = 'HTTP(fallback)'
            // Keep CDP-side error as first-class signal to avoid HTTP captcha false-positive overriding real issue.
            if (!webAccessLastError) {
              webAccessLastError = toText(pageData.errorMessage || '')
            }
            if (pageData.rows.length === 0 && isGasgooOemListUrl(pageUrl) && (pageData.paginationUrls || []).length === 0) {
              const fallbackPages = buildGasgooOemPaginationUrls(pageUrl, 15)
              if (fallbackPages.length > 0) {
                pageData.paginationUrls = fallbackPages
                task?.runLogs?.push(`${nowText()} | HTTP空页但识别为oem，继续按分页模板推进 ${fallbackPages.length} 页`)
              }
            }
          } else {
            task?.runLogs?.push(`${nowText()} | 分页web-access为空但连接正常，保持CDP结果（不回退HTTP，避免会话不一致误判）`)
          }
        }
      } else {
        pageData = await extractSupplierPageDataByHttp(pageUrl, context)
        pageSource = 'HTTP'
        if (pageData.rows.length === 0) {
          task?.runLogs?.push(`${nowText()} | 分页HTTP结果为空，切换 Playwright：${pageUrl}`)
          pageData = await extractSupplierPageDataWithPlaywright(pageUrl, context)
          pageSource = 'Playwright'
        }
      }
      if (pageData.rows.length === 0) {
        if (toText(pageData.errorMessage)) {
          task?.runLogs?.push(`${nowText()} | 空页原因(${pageSource})：${toText(pageData.errorMessage)}`)
        }
        const d = pageData?.diagnostics || {}
        lastEmptyPageDiagnostic = `source=${pageSource}, title=${toText(d.pageTitle) || '-'}, textLen=${Number(d.pageTextLen || 0)}, li.alists=${Number(d.liAlistsCount || 0)}, tr=${Number(d.trCount || 0)}, companyLinks=${Number(d.companyLinkCount || 0)}, url=${toText(pageData.finalUrl || pageUrl) || '-'}`
        task?.runLogs?.push(
          `${nowText()} | 空页诊断(${pageSource})：title=${toText(d.pageTitle) || '-'}，textLen=${Number(d.pageTextLen || 0)}，li.alists=${Number(d.liAlistsCount || 0)}，tr=${Number(d.trCount || 0)}，companyLinks=${Number(d.companyLinkCount || 0)}`,
        )
      }
      collectedRows = mergeSupplierRowsUnique(collectedRows, pageData.rows || [])
      if (task?.runLogs) {
        task.runLogs.push(`${nowText()} | 分页抓取(${pageSource})：${pageUrl}，本页 ${pageData.rows.length} 条，累计 ${collectedRows.length} 条，待抓页 ${pendingPages.length}`)
      }
      if (pageData.totalCount > expectedTotal) expectedTotal = pageData.totalCount
      if (pageData.totalCount > totalByCandidate) totalByCandidate = pageData.totalCount
      if (task) {
        const base = Number(task.baseRowsBeforeCurrentUrl || 0)
        task.totalRows = base + collectedRows.length
        task.estimatedTotalRows = base + Math.max(expectedTotal || 0, collectedRows.length)
        updateSupplierTaskProgressRealtime(task)
      }
      for (const nextPageUrl of pageData.paginationUrls || []) {
        if (!isSameSupplierCategoryUrl(candidateUrl, nextPageUrl)) continue
        const nextPageKey = buildSupplierPaginationPageKey(nextPageUrl)
        if (!seenPages.has(nextPageUrl) && !(nextPageKey && seenPageKeys.has(nextPageKey))) {
          pendingPages.push(nextPageUrl)
        }
      }
      if ((pageData.paginationUrls || []).length === 0 && expectedTotal > 0 && seenPages.size <= 2) {
        const synthetic = buildSyntheticPaginationUrls(
          candidateUrl,
          expectedTotal,
          (pageData.rows || []).length || collectedRows.length || 10,
        )
        if (synthetic.length > 0) {
          task?.runLogs?.push(`${nowText()} | 自动补充分页：生成 ${synthetic.length} 个候选分页链接`)
        }
        for (const nextPageUrl of synthetic) {
          if (!isSameSupplierCategoryUrl(candidateUrl, nextPageUrl)) continue
          const nextPageKey = buildSupplierPaginationPageKey(nextPageUrl)
          if (!seenPages.has(nextPageUrl) && !(nextPageKey && seenPageKeys.has(nextPageKey))) {
            pendingPages.push(nextPageUrl)
          }
        }
      }
      if (task?.runLogs) {
        task.runLogs.push(`${nowText()} | 分页入队后：待抓页 ${pendingPages.length}`)
      }

      if (expectedTotal > 0 && collectedRows.length >= expectedTotal) break
    }

    if (collectedRows.length > 0) {
      task.runLogs.push(`${nowText()} | 列表抓取：${candidateUrl}，已抓 ${collectedRows.length} 条，识别总数 ${totalByCandidate || 0}，耗时 ${Date.now() - candidateStart}ms`)
    } else {
      task?.runLogs?.push(`${nowText()} | 列表变体无结果：${candidateUrl}，耗时 ${Date.now() - candidateStart}ms`)
    }

    if (collectedRows.length > best.rows.length || (totalByCandidate > best.totalCount && collectedRows.length > 0)) {
      best = {
        rows: collectedRows,
        totalCount: totalByCandidate,
        paginationUrls: [],
        candidateUrl,
        pagesVisited: seenPages.size,
      }
    }
    if (!supplierTryAllVariants && candidateIndex === 0 && collectedRows.length > 0) {
      task?.runLogs?.push(`${nowText()} | 已在首选变体抓到有效数据，跳过镜像变体以提升速度`)
      break
    }
  }

  if (best.rows.length > 0) {
    task?.runLogs?.push(`${nowText()} | 最优列表变体：${best.candidateUrl}，页数 ${best.pagesVisited}，准备做详情补全`)
    const enrichStart = Date.now()
    best.rows = await enrichSupplierRowsByDetailPages(best.rows, task, nowText, { homepageOnly: context?.homepageOnly })
    task?.runLogs?.push(`${nowText()} | 详情补全阶段耗时 ${Date.now() - enrichStart}ms`)
  }
  if (best.rows.length === 0 && useWebAccess) {
    if (!toText(webAccessLastError) && lastEmptyPageDiagnostic) {
      webAccessLastError = `列表解析为空（${lastEmptyPageDiagnostic}）`
    }
    const isCaptcha = /验证码|captcha|WafCaptcha|TencentCaptcha/i.test(toText(webAccessLastError))
    const fallbackGuide = '未识别到供应商列表，可能原因：验证码拦截、页面确实无数据、或环境未就绪；请先点击“执行”，确认目标页可见后再重试'
    const captchaGuide = '检测到腾讯验证码，请在 web-access 浏览器窗口完成验证后，再点击 01提交抓取'
    return {
      ...best,
      candidateUrls,
      errorMessage: isCaptcha
        ? (webAccessLastError ? `${webAccessLastError}；${captchaGuide}` : captchaGuide)
        : (webAccessLastError ? `${webAccessLastError}；${fallbackGuide}` : fallbackGuide),
    }
  }
  return { ...best, candidateUrls }
}

async function runSupplierCrawlTask(task) {
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  const taskStart = Date.now()
  task.processedUrls = 0
  task.totalRows = 0
  task.estimatedTotalRows = 0
  task.successRows = 0
  task.failedRows = 0
  task.fileName = ''
  task.filePath = ''
  task.downloadUrl = ''
  task.records = []
  task.imported = false
  task.importSummary = null
  task.baseRowsBeforeCurrentUrl = 0
  task.status = 'running'
  task.startedAt = new Date().toISOString()
  task.progress = 1
  task.runLogs.push(`${nowText()} | 任务开始：节点 ${task.nodeName || task.nodeId}，URL ${task.totalUrls} 个`)
  task.runLogs.push(`${nowText()} | 抽取模式：Codex模型 + 规则补充（model=${task.model || 'gpt-5.4'}）`)
  if (task.homepageOnly) {
    task.runLogs.push(`${nowText()} | 详情抓取策略：仅抓企业首页（禁用详情Tab扩展）`)
  }
  schedulePersistSupplierTaskStore()
  const rows = []
  for (const url of task.urls) {
    if (task.cancelRequested) {
      task.status = 'cancelled'
      task.endedAt = new Date().toISOString()
      task.progress = Math.max(task.progress, 100)
      task.runLogs.push(`${nowText()} | 任务已取消，停止抓取`)
      schedulePersistSupplierTaskStore()
      return
    }
    task.runLogs.push(`${nowText()} | 开始抓取：${url}`)
    task.baseRowsBeforeCurrentUrl = rows.length
    task.totalRows = rows.length
    task.estimatedTotalRows = Math.max(task.estimatedTotalRows || 0, rows.length)
    updateSupplierTaskProgressRealtime(task)
    const urlMetaKey = normalizeSupplierTaskUrlKey(url) || toText(url)
    const urlMeta = task.urlNodeMetaMap?.[urlMetaKey] || null
    const crawlContext = {
      nodeId: urlMeta?.nodeId ?? task.nodeId,
      nodeName: toText(urlMeta?.nodeName) || task.nodeName,
      model: task.model,
      skill: task.skill,
      sourceUrl: toText(urlMeta?.sourceUrl) || task.sourceUrl || url,
      homepageOnly: Boolean(task.homepageOnly),
      allowPlaywrightDetail: Boolean(task.allowPlaywrightDetail),
    }
    task.runLogs.push(`${nowText()} | 抓取上下文：nodeId=${crawlContext.nodeId || '-'}，nodeName=${crawlContext.nodeName || '-'}，skill=${crawlContext.skill || '-'}`)
    try {
      const forceListMode = String(task?.crawlMode || '').toLowerCase() === 'list'
      const detailMode = forceListMode ? false : isSupplierDetailEntryUrl(url)
      task.runLogs.push(`${nowText()} | 识别模式：${detailMode ? '详情页直抓' : '列表分页抓取+详情补全'}`)
      const urlStart = Date.now()
      const crawlResult = detailMode
        ? await crawlSupplierDetailByUrlVariants(url, crawlContext, task, nowText)
        : await crawlSupplierRowsByUrlVariants(url, crawlContext, task, nowText)
      const parsedRows = crawlResult.rows || []
      const expectedTotal = Number(crawlResult.totalCount || 0)
      if (expectedTotal > 0) {
        task.runLogs.push(`${nowText()} | 总数校验：目标约 ${expectedTotal} 家，当前抓取 ${parsedRows.length} 家`)
        task.estimatedTotalRows = Math.max(task.estimatedTotalRows || 0, rows.length + expectedTotal)
        updateSupplierTaskProgressRealtime(task)
      }

      if (parsedRows.length === 0) {
        const failureReason = toText(crawlResult.errorMessage)
        const baseFailureMessage = detailMode
          ? `未识别到供应商详情信息（已尝试 ${(crawlResult.candidateUrls || []).length} 个URL变体）`
          : `未识别到供应商列表行（已尝试 ${(crawlResult.candidateUrls || []).length} 个URL变体）`
        rows.push({
          nodeId: crawlContext.nodeId,
          nodeName: crawlContext.nodeName,
          model: crawlContext.model,
          skill: crawlContext.skill,
          sourceUrl: crawlContext.sourceUrl || url,
          listPageUrl: url,
          detailUrl: detailMode ? url : '',
          supplierProfileUrl: detailMode ? url : '',
          companyName: '',
          mainProducts: '',
          fitExport: '',
          qualitySystem: '',
          region: '',
          contactAction: '',
          companyIntro: '',
          companyType: '',
          orgCode: '',
          establishedDate: '',
          registeredCapital: '',
          employeesCount: '',
          legalRepresentative: '',
          newsSummary: '',
          status: 'failed',
          errorMessage: failureReason
            ? `${baseFailureMessage}；原因：${failureReason}`
            : baseFailureMessage,
        })
        task.failedRows += 1
        task.runLogs.push(`${nowText()} | 未识别到供应商${detailMode ? '详情' : '列表'}：${url}${crawlResult.errorMessage ? `，${crawlResult.errorMessage}` : ''}`)
      } else {
        rows.push(...parsedRows)
        task.successRows += parsedRows.length
        task.runLogs.push(`${nowText()} | 抓取完成：${url}，供应商 ${parsedRows.length} 条${detailMode ? '（详情页模式）' : '，详情页已补全'}，耗时 ${Date.now() - urlStart}ms`)
      }
    } catch (error) {
      rows.push({
        nodeId: crawlContext.nodeId,
        nodeName: crawlContext.nodeName,
        model: crawlContext.model,
        skill: crawlContext.skill,
        sourceUrl: crawlContext.sourceUrl || url,
        listPageUrl: url,
        detailUrl: '',
        supplierProfileUrl: '',
        companyName: '',
        mainProducts: '',
        fitExport: '',
        qualitySystem: '',
        region: '',
        contactAction: '',
        companyIntro: '',
        companyType: '',
        orgCode: '',
        establishedDate: '',
        registeredCapital: '',
        employeesCount: '',
        legalRepresentative: '',
        newsSummary: '',
        status: 'failed',
        errorMessage: error.message || '抓取失败',
      })
      task.failedRows += 1
      task.runLogs.push(`${nowText()} | 抓取失败：${url}，${error.message || 'unknown error'}`)
    }
    task.processedUrls += 1
    task.totalRows = rows.length
    task.estimatedTotalRows = Math.max(task.estimatedTotalRows || 0, rows.length)
    task.baseRowsBeforeCurrentUrl = rows.length
    updateSupplierTaskProgressRealtime(task)
    schedulePersistSupplierTaskStore()
  }

  const fileName = `supplier_result_${Date.now()}.csv`
  const absPath = path.join(crawlExportDir, fileName)
  const header = [
    'node_id',
    'node_name',
    'model',
    'skill',
    'source_url',
    'list_page_url',
    'detail_url',
    'supplier_profile_url',
    'company_name',
    'brand',
    'vehicle_model',
    'main_products',
    'fit_export',
    'quality_system',
    'region',
    'contact_action',
    'website',
    'address',
    'company_intro',
    'fit_situation',
    'export_situation',
    'certificates',
    'company_type',
    'org_code',
    'established_date',
    'registered_capital',
    'employees_count',
    'legal_representative',
    'news_summary',
    'status',
    'error_message',
  ]
  const lines = [
    header.join(','),
    ...rows.map((row) =>
      [
        row.nodeId || '',
        row.nodeName || '',
        row.model || '',
        row.skill || '',
        row.sourceUrl || '',
        row.listPageUrl || '',
        row.detailUrl || '',
        row.supplierProfileUrl || row.detailUrl || '',
        row.companyName || '',
        row.brand || '',
        row.vehicleModel || '',
        row.mainProducts || '',
        row.fitExport || '',
        row.qualitySystem || '',
        row.region || '',
        row.contactAction || '',
        row.website || '',
        row.address || '',
        row.companyIntro || '',
        row.fitSituation || '',
        row.exportSituation || '',
        row.certificates || '',
        row.companyType || '',
        row.orgCode || '',
        row.establishedDate || '',
        row.registeredCapital || '',
        row.employeesCount || '',
        row.legalRepresentative || '',
        row.newsSummary || '',
        row.status || '',
        row.errorMessage || '',
      ]
        .map(csvEscape)
        .join(','),
    ),
  ]
  await fs.writeFile(absPath, lines.join('\n'), 'utf-8')
  task.fileName = fileName
  task.filePath = absPath
  task.downloadUrl = `/api/crawl-exports/${encodeURIComponent(fileName)}`
  task.totalRows = rows.length
  task.estimatedTotalRows = Math.max(task.estimatedTotalRows || 0, rows.length)
  task.records = rows
  task.progress = 100
  task.status = 'done'
  task.endedAt = new Date().toISOString()
  task.runLogs.push(`${nowText()} | CSV 已生成：${fileName}，共 ${rows.length} 条`)
  task.runLogs.push(`${nowText()} | 任务完成：成功 ${task.successRows} 条，失败 ${task.failedRows} 条，总耗时 ${Date.now() - taskStart}ms`)
  schedulePersistSupplierTaskStore()
}

function ensureTitleChain(record) {
  let level1Title = toText(record.level1_title)
  let level2Title = toText(record.level2_title)
  let level3Title = toText(record.level3_title)
  const pageTitle = toText(record.page_title)
  const businessEntity = toText(record.business_entity)

  if (!level1Title) {
    level1Title = businessEntity || pageTitle || '供应链分类'
  }
  if (!level2Title && level3Title) {
    level2Title = pageTitle && pageTitle !== level3Title ? pageTitle : '子分类'
  }
  if (!level3Title && level2Title && pageTitle && pageTitle !== level2Title) {
    level3Title = pageTitle
  }

  return {
    level1Title,
    level2Title,
    level3Title,
  }
}

async function upsertSupplyChainNode(client, payload) {
  const lookupSql = `
    SELECT id
    FROM ${supplyChainNodeTable}
    WHERE parent_id IS NOT DISTINCT FROM $1
      AND node_level = $2
      AND node_title = $3
      AND source_url = $4
    LIMIT 1
  `
  const existing = await client.query(lookupSql, [
    payload.parentId,
    payload.nodeLevel,
    payload.nodeTitle,
    payload.sourceUrl || '',
  ])
  if (existing.rowCount > 0) {
    const id = existing.rows[0].id
    await client.query(
      `
      UPDATE ${supplyChainNodeTable}
      SET
        node_url = $2,
        business_entity = $3,
        source_url = $4,
        page_url = $5,
        page_title = $6,
        text_sample = $7,
        level1_url = $8,
        level2_url = $9,
        level3_url = $10,
        supplier_url = $11,
        supply_chain_info = $12,
        crawl_info_id = COALESCE($13, crawl_info_id),
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        id,
        payload.nodeUrl || '',
        payload.businessEntity || '',
        payload.sourceUrl || '',
        payload.pageUrl || '',
        payload.pageTitle || '',
        payload.textSample || '',
        payload.level1Url || '',
        payload.level2Url || '',
        payload.level3Url || '',
        payload.supplierUrl || '',
        payload.supplyChainInfo || '',
        payload.crawlInfoId || null,
      ],
    )
    return { id, created: false }
  }

  const insertSql = `
    INSERT INTO ${supplyChainNodeTable}
    (
      parent_id, node_level, node_title, node_url, business_entity, source_url, page_url, page_title,
      text_sample, level1_url, level2_url, level3_url, supplier_url, supply_chain_info, crawl_info_id, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
    RETURNING id
  `
  const inserted = await client.query(insertSql, [
    payload.parentId,
    payload.nodeLevel,
    payload.nodeTitle,
    payload.nodeUrl,
    payload.businessEntity,
    payload.sourceUrl,
    payload.pageUrl,
    payload.pageTitle,
    payload.textSample,
    payload.level1Url,
    payload.level2Url,
    payload.level3Url,
    payload.supplierUrl,
    payload.supplyChainInfo,
    payload.crawlInfoId,
  ])
  return { id: inserted.rows[0].id, created: true }
}

async function importSupplyChainRecords(records, sourceFile = '') {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('CSV 无有效数据行')
  }

  const client = await pool.connect()
  const counter = {
    inserted: 0,
    updated: 0,
    level1Inserted: 0,
    level2Inserted: 0,
    level3Inserted: 0,
    level1Updated: 0,
    level2Updated: 0,
    level3Updated: 0,
  }
  try {
    await client.query('BEGIN')
    for (const record of records) {
      const titles = ensureTitleChain(record)
      const sourceUrl = toText(record.source_url)
      const businessEntity = toText(record.business_entity) || '供应链'
      const pageUrl = toText(record.page_url)
      const pageTitle = toText(record.page_title)
      const textSample = toText(record.text_sample)
      const supplyChainInfo = toText(record.supply_chain_info)
      const crawlInfoId = null

      let parentId = null
      if (titles.level1Title) {
        const result = await upsertSupplyChainNode(client, {
          parentId: null,
          nodeLevel: 1,
          nodeTitle: titles.level1Title,
          nodeUrl: toText(record.level1_url) || sourceUrl,
          businessEntity,
          sourceUrl,
          pageUrl,
          pageTitle,
          textSample,
          level1Url: toText(record.level1_url),
          level2Url: toText(record.level2_url),
          level3Url: toText(record.level3_url),
          supplierUrl: toText(record.supplier_url),
          supplyChainInfo,
          crawlInfoId,
        })
        parentId = result.id
        if (result.created) {
          counter.inserted += 1
          counter.level1Inserted += 1
        } else {
          counter.updated += 1
          counter.level1Updated += 1
        }
      }

      if (titles.level2Title) {
        const result = await upsertSupplyChainNode(client, {
          parentId,
          nodeLevel: 2,
          nodeTitle: titles.level2Title,
          nodeUrl: toText(record.level2_url) || pageUrl || sourceUrl,
          businessEntity,
          sourceUrl,
          pageUrl,
          pageTitle,
          textSample,
          level1Url: toText(record.level1_url),
          level2Url: toText(record.level2_url),
          level3Url: toText(record.level3_url),
          supplierUrl: toText(record.supplier_url),
          supplyChainInfo,
          crawlInfoId,
        })
        parentId = result.id
        if (result.created) {
          counter.inserted += 1
          counter.level2Inserted += 1
        } else {
          counter.updated += 1
          counter.level2Updated += 1
        }
      }

      if (titles.level3Title) {
        const result = await upsertSupplyChainNode(client, {
          parentId,
          nodeLevel: 3,
          nodeTitle: titles.level3Title,
          nodeUrl: toText(record.level3_url) || pageUrl || toText(record.supplier_url),
          businessEntity,
          sourceUrl,
          pageUrl,
          pageTitle,
          textSample,
          level1Url: toText(record.level1_url),
          level2Url: toText(record.level2_url),
          level3Url: toText(record.level3_url),
          supplierUrl: toText(record.supplier_url),
          supplyChainInfo,
          crawlInfoId,
        })
        if (result.created) {
          counter.inserted += 1
          counter.level3Inserted += 1
        } else {
          counter.updated += 1
          counter.level3Updated += 1
        }
      }
    }
    await client.query('COMMIT')
    return {
      sourceFile: sourceFile || 'uploaded.csv',
      importedRows: records.length,
      insertedNodes: counter.inserted,
      updatedNodes: counter.updated,
      detail: counter,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function importSupplyChainCsv(fileName) {
  const safeName = path.basename(String(fileName || '').trim())
  if (!safeName) throw new Error('缺少 CSV 文件名')
  if (!safeName.endsWith('.csv')) throw new Error('仅支持导入 CSV 文件')
  const csvPath = path.join(crawlExportDir, safeName)
  const csvText = await fs.readFile(csvPath, 'utf8')
  const records = parseCsvObjects(csvText)
  return importSupplyChainRecords(records, safeName)
}

async function clearSupplyChainBySourceFile(fileName) {
  const safeName = path.basename(String(fileName || '').trim())
  if (!safeName) {
    throw new Error('缺少 CSV 文件名')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pairSql = `
      SELECT DISTINCT source_url AS "sourceUrl", business_entity AS "businessEntity"
      FROM ${crawlInfoTable}
      WHERE source_file = $1
    `
    const pairRes = await client.query(pairSql, [safeName])
    const pairs = pairRes.rows.filter((item) => item.sourceUrl && item.businessEntity)

    if (pairs.length > 0) {
      const params = []
      const whereClauses = pairs.map((pair, idx) => {
        params.push(pair.sourceUrl, pair.businessEntity)
        const n = idx * 2
        return `(source_url = $${n + 1} AND business_entity = $${n + 2})`
      })
      const deleteTreeSql = `DELETE FROM ${supplyChainNodeTable} WHERE ${whereClauses.join(' OR ')}`
      await client.query(deleteTreeSql, params)
    }

    const deleteInfoSql = `DELETE FROM ${crawlInfoTable} WHERE source_file = $1`
    const deleteInfoRes = await client.query(deleteInfoSql, [safeName])
    await client.query('COMMIT')
    return {
      sourceFile: safeName,
      deletedInfoRows: deleteInfoRes.rowCount || 0,
      deletedSourcePairs: pairs.length,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function deleteSupplyChainNodesByPairs(client, pairs) {
  const validPairs = pairs.filter((item) => item.sourceUrl && item.businessEntity)
  if (validPairs.length === 0) return 0
  const params = []
  const whereClauses = validPairs.map((pair, idx) => {
    params.push(pair.sourceUrl, pair.businessEntity)
    const n = idx * 2
    return `(source_url = $${n + 1} AND business_entity = $${n + 2})`
  })
  const deleteSql = `DELETE FROM ${supplyChainNodeTable} WHERE ${whereClauses.join(' OR ')}`
  const deleted = await client.query(deleteSql, params)
  return deleted.rowCount || 0
}

function toCrawlRecordFromDbRow(row) {
  return {
    id: row.id,
    source_file: toText(row.sourceFile || row.source_file),
    crawl_type: toText(row.crawlType || row.crawl_type),
    business_entity: toText(row.businessEntity || row.business_entity),
    source_url: toText(row.sourceUrl || row.source_url),
    page_url: toText(row.pageUrl || row.page_url),
    page_title: toText(row.pageTitle || row.page_title),
    text_sample: toText(row.textSample || row.text_sample),
    status: toText(row.status),
    error_message: toText(row.errorMessage || row.error_message),
    level1_url: toText(row.level1Url || row.level1_url),
    level2_url: toText(row.level2Url || row.level2_url),
    level3_url: toText(row.level3Url || row.level3_url),
    supplier_url: toText(row.supplierUrl || row.supplier_url),
    level1_title: toText(row.level1Title || row.level1_title),
    level2_title: toText(row.level2Title || row.level2_title),
    level3_title: toText(row.level3Title || row.level3_title),
    supply_chain_info: toText(row.supplyChainInfo || row.supply_chain_info),
  }
}

async function rebuildSupplyChainNodesBySourceFiles(sourceFiles = []) {
  const normalized = [...new Set(sourceFiles.map((item) => path.basename(String(item || '').trim())).filter(Boolean))]
  if (normalized.length === 0) {
    return { rebuiltSourceFiles: 0, rebuiltRows: 0, deletedNodes: 0 }
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const rowSql = `
      SELECT
        id,
        source_file AS "sourceFile",
        crawl_type AS "crawlType",
        business_entity AS "businessEntity",
        source_url AS "sourceUrl",
        page_url AS "pageUrl",
        page_title AS "pageTitle",
        text_sample AS "textSample",
        status,
        error_message AS "errorMessage",
        level1_url AS "level1Url",
        level2_url AS "level2Url",
        level3_url AS "level3Url",
        supplier_url AS "supplierUrl",
        level1_title AS "level1Title",
        level2_title AS "level2Title",
        level3_title AS "level3Title",
        supply_chain_info AS "supplyChainInfo"
      FROM ${crawlInfoTable}
      WHERE source_file = ANY($1::text[])
      ORDER BY id ASC
    `
    const rowRes = await client.query(rowSql, [normalized])
    const rows = rowRes.rows.map(toCrawlRecordFromDbRow)

    const pairs = []
    for (const row of rows) {
      if (row.source_url && row.business_entity) {
        pairs.push({ sourceUrl: row.source_url, businessEntity: row.business_entity })
      }
    }
    const deletedNodes = await deleteSupplyChainNodesByPairs(client, pairs)

    for (const record of rows) {
      const titles = ensureTitleChain(record)
      const sourceUrl = toText(record.source_url)
      const businessEntity = toText(record.business_entity)
      const pageUrl = toText(record.page_url)
      const pageTitle = toText(record.page_title)
      const textSample = toText(record.text_sample)
      const supplyChainInfo = toText(record.supply_chain_info)

      let parentId = null
      if (titles.level1Title) {
        parentId = (await upsertSupplyChainNode(client, {
          parentId: null,
          nodeLevel: 1,
          nodeTitle: titles.level1Title,
          nodeUrl: toText(record.level1_url) || sourceUrl,
          businessEntity,
          sourceUrl,
          pageUrl,
          pageTitle,
          textSample,
          level1Url: toText(record.level1_url),
          level2Url: toText(record.level2_url),
          level3Url: toText(record.level3_url),
          supplierUrl: toText(record.supplier_url),
          supplyChainInfo,
          crawlInfoId: Number(record.id) || null,
        })).id
      }
      if (titles.level2Title) {
        parentId = (await upsertSupplyChainNode(client, {
          parentId,
          nodeLevel: 2,
          nodeTitle: titles.level2Title,
          nodeUrl: toText(record.level2_url) || pageUrl || sourceUrl,
          businessEntity,
          sourceUrl,
          pageUrl,
          pageTitle,
          textSample,
          level1Url: toText(record.level1_url),
          level2Url: toText(record.level2_url),
          level3Url: toText(record.level3_url),
          supplierUrl: toText(record.supplier_url),
          supplyChainInfo,
          crawlInfoId: Number(record.id) || null,
        })).id
      }
      if (titles.level3Title) {
        await upsertSupplyChainNode(client, {
          parentId,
          nodeLevel: 3,
          nodeTitle: titles.level3Title,
          nodeUrl: toText(record.level3_url) || pageUrl || toText(record.supplier_url),
          businessEntity,
          sourceUrl,
          pageUrl,
          pageTitle,
          textSample,
          level1Url: toText(record.level1_url),
          level2Url: toText(record.level2_url),
          level3Url: toText(record.level3_url),
          supplierUrl: toText(record.supplier_url),
          supplyChainInfo,
          crawlInfoId: Number(record.id) || null,
        })
      }
    }
    await client.query('COMMIT')
    return {
      rebuiltSourceFiles: normalized.length,
      rebuiltRows: rows.length,
      deletedNodes,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function fetchTextWithCookieRetry(url, timeoutMs = 18000) {
  if (shouldUseDirectForSupplierUrl(url)) {
    const first = await fetchTextWithCurl(url, timeoutMs)
    if (first.status >= 200 && first.status < 400 && first.text) {
      return { status: first.status, text: first.text, cookie: '' }
    }
    const cookiePair = parseSetCookiePair(first.headersRaw)
    if (!cookiePair) {
      return { status: first.status, text: first.text, cookie: '' }
    }
    const second = await fetchTextWithCurl(url, timeoutMs, { cookie: cookiePair })
    return { status: second.status, text: second.text, cookie: cookiePair }
  }
  const first = await fetchWithTimeout(url, timeoutMs)
  const firstText = await first.text()
  if (first.ok) {
    return { status: first.status, text: firstText, cookie: '' }
  }
  const setCookie = first.headers.get('set-cookie') || ''
  const cookiePair = setCookie.split(';')[0]?.trim()
  if (!cookiePair) {
    return { status: first.status, text: firstText, cookie: '' }
  }
  const second = await fetchWithTimeout(url, timeoutMs, { cookie: cookiePair })
  const secondText = await second.text()
  return { status: second.status, text: secondText, cookie: cookiePair }
}

async function fetchTextWithRetries(url, timeoutMs = 18000, maxAttempts = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    try {
      const result = await fetchTextWithCookieRetry(url, timeoutMs)
      if (result.status >= 200 && result.status < 400 && result.text) return result
      lastError = new Error(`HTTP ${result.status}`)
    } catch (error) {
      lastError = error
    }
    if (attempt < maxAttempts) {
      const waitMs = Math.min(1800, 500 * attempt)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
  if (lastError) throw lastError
  throw new Error('fetch failed')
}

function decodeBasicHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function extractCategoryTreeFromHomeHtml(html, baseUrl) {
  const treeStart = html.indexOf('tree_title">全部产品分类')
  if (treeStart < 0) return []
  const treeEnd = html.indexOf('<div class="newhead-bottom">', treeStart)
  const treeHtml = treeEnd > treeStart ? html.slice(treeStart, treeEnd) : html.slice(treeStart)

  const normalizeUrl = (href) => {
    try {
      return new URL(href, baseUrl).toString()
    } catch {
      return ''
    }
  }

  const results = []
  const liRegex = /<li class="li\d+"[\s\S]*?<\/li>/gi
  const liBlocks = treeHtml.match(liRegex) || []
  for (const liBlock of liBlocks) {
    const l1Match = liBlock.match(/<a class="im" href="([^"]+)">([^<]+)<\/a>/i)
    if (!l1Match) continue
    const level1Title = decodeBasicHtmlEntities(stripHtml(l1Match[2]))
    const level1Url = normalizeUrl(l1Match[1])

    const childBlocks = liBlock.match(/<div class="tree_list_children_list">[\s\S]*?<\/div>/gi) || []
    if (childBlocks.length === 0) {
      results.push({
        level1Title,
        level1Url,
        level2Title: '',
        level2Url: '',
        level3Title: '',
        level3Url: '',
      })
      continue
    }

    for (const child of childBlocks) {
      const l2Match = child.match(/<a href="([^"]+)" class="attree">([^<]+)<\/a>/i)
      if (!l2Match) continue
      const level2Title = decodeBasicHtmlEntities(stripHtml(l2Match[2]))
      const level2Url = normalizeUrl(l2Match[1])
      const pMatch = child.match(/<p class="pchildren">([\s\S]*?)<\/p>/i)
      const thirdAnchors = pMatch ? [...pMatch[1].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/gi)] : []

      if (thirdAnchors.length === 0) {
        results.push({
          level1Title,
          level1Url,
          level2Title,
          level2Url,
          level3Title: '',
          level3Url: '',
        })
        continue
      }

      for (const anchor of thirdAnchors) {
        results.push({
          level1Title,
          level1Url,
          level2Title,
          level2Url,
          level3Title: decodeBasicHtmlEntities(stripHtml(anchor[2])),
          level3Url: normalizeUrl(anchor[1]),
        })
      }
    }
  }
  return results
}

function extractQueryParamFromUrl(url, key) {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get(key) || ''
  } catch {
    return ''
  }
}

async function crawlChinaAutoSupplierFromSitemap(seedUrl, context = {}) {
  const seedHost = (() => {
    try {
      return new URL(seedUrl).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  const homeUrl = `https://${seedHost.includes('qcgys.com') ? 'www.qcgys.com' : 'www.qcgys.com'}/`
  try {
    const homeFetch = await fetchTextWithCookieRetry(homeUrl, 22000)
    if (homeFetch.status === 200 && /全部产品分类/.test(homeFetch.text)) {
      const categoryRows = extractCategoryTreeFromHomeHtml(homeFetch.text, homeUrl)
      if (categoryRows.length > 0) {
        return categoryRows.map((item) => ({
          crawlType: context.crawlType || '全量',
          businessEntity: context.businessEntity || '',
          model: context.model || '',
          skill: context.skill || '',
          sourceUrl: seedUrl,
          pageUrl: item.level3Url || item.level2Url || item.level1Url || homeUrl,
          pageTitle: item.level3Title || item.level2Title || item.level1Title,
          textSample: [item.level1Title, item.level2Title, item.level3Title].filter(Boolean).join(' > '),
          status: 'success',
          errorMessage: '',
          level1Url: item.level1Url || '',
          level2Url: item.level2Url || '',
          level3Url: item.level3Url || '',
          supplierUrl: '',
          level1Title: item.level1Title || '',
          level2Title: item.level2Title || '',
          level3Title: item.level3Title || '',
          supplyChainInfo: [item.level1Title, item.level2Title, item.level3Title].filter(Boolean).join(' > '),
        }))
      }
    }
  } catch {
    // fallback to sitemap mode
  }

  const root = new URL(seedUrl).origin
  const sitemapUrl = `${root}/sitemap.xml`
  const response = await fetchWithTimeout(sitemapUrl, 20000)
  if (!response.ok) {
    throw new Error(`sitemap请求失败 HTTP ${response.status}`)
  }
  const xml = await response.text()
  const matches = [...xml.matchAll(/<loc><!\[CDATA\[(.*?)\]\]><\/loc>/gi)]
  const urls = [...new Set(matches.map((item) => String(item[1] || '').trim()).filter(Boolean))]

  const levelRows = []
  for (const pageUrl of urls) {
    const leibie = extractQueryParamFromUrl(pageUrl, 'leibie')
    if (!['1', '2', '3'].includes(leibie)) continue

    const level = Number(leibie)
    levelRows.push({
      crawlType: context.crawlType || '全量',
      businessEntity: context.businessEntity || '',
      model: context.model || '',
      skill: context.skill || '',
      sourceUrl: seedUrl,
      pageUrl,
      pageTitle: `产品分类 L${level}`,
      textSample: `分类层级 leibie=${level}`,
      status: 'success',
      errorMessage: '',
      level1Url: level === 1 ? pageUrl : '',
      level2Url: level === 2 ? pageUrl : '',
      level3Url: level === 3 ? pageUrl : '',
      supplierUrl: '',
      level1Title: level === 1 ? `分类L1(${level})` : '',
      level2Title: level === 2 ? `分类L2(${level})` : '',
      level3Title: level === 3 ? `分类L3(${level})` : '',
      supplyChainInfo: `分类层级 leibie=${level}`,
    })
  }

  const supplierRows = urls
    .filter((url) => /\/free\.php\?mid=\d+/i.test(url))
    .slice(0, 1200)
    .map((pageUrl) => ({
      crawlType: context.crawlType || '全量',
      businessEntity: context.businessEntity || '',
      model: context.model || '',
      skill: context.skill || '',
      sourceUrl: seedUrl,
      pageUrl,
      pageTitle: '供应商详情页',
      textSample: `供应链企业链接 mid=${extractQueryParamFromUrl(pageUrl, 'mid')}`,
      status: 'success',
      errorMessage: '',
      level1Url: '',
      level2Url: '',
      level3Url: '',
      supplierUrl: pageUrl,
      level1Title: '',
      level2Title: '',
      level3Title: '',
      supplyChainInfo: '供应商详情链接',
    }))

  if (levelRows.length === 0 && supplierRows.length === 0) {
    return [
      {
        crawlType: context.crawlType || '全量',
        businessEntity: context.businessEntity || '',
        model: context.model || '',
        skill: context.skill || '',
        sourceUrl: seedUrl,
        pageUrl: sitemapUrl,
        pageTitle: 'sitemap',
        textSample: '未在 sitemap 中提取到分类/供应商链接',
        status: 'failed',
        errorMessage: 'no_category_data',
        level1Url: '',
        level2Url: '',
        level3Url: '',
        supplierUrl: '',
        level1Title: '',
        level2Title: '',
        level3Title: '',
        supplyChainInfo: '未在 sitemap 中提取到分类/供应商链接',
      },
    ]
  }

  return [...levelRows, ...supplierRows]
}

async function fetchWithTimeout(url, timeoutMs = 15000, headers = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchByNetworkPolicy(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...headers,
      },
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function crawlAndCollectRows(seedUrl, crawlType, context = {}) {
  const hostname = (() => {
    try {
      return new URL(seedUrl).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  if (hostname.includes('chinaautosupplier.com')) {
    try {
      return await crawlChinaAutoSupplierFromSitemap(seedUrl, {
        ...context,
        crawlType,
      })
    } catch {
      // fall through to generic crawler
    }
  }
  if (/playwright/i.test(toText(context.skill)) && (isSupplierDetailEntryUrl(seedUrl) || hostname.includes('gasgoo.com') || hostname.includes('qcgys.com'))) {
    const task = { runLogs: [] }
    const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
    const crawlContext = {
      nodeId: context.nodeId || null,
      nodeName: context.nodeName || '',
      model: context.model || '',
      skill: context.skill || '',
      sourceUrl: context.sourceUrl || seedUrl,
      businessEntity: context.businessEntity || '',
      homepageOnly: normalizeSupplierHomepageOnly(context.homepageOnly),
    }
    try {
      const result = isSupplierDetailEntryUrl(seedUrl)
        ? await crawlSupplierDetailByUrlVariants(seedUrl, crawlContext, task, nowText)
        : await crawlSupplierRowsByUrlVariants(seedUrl, crawlContext, task, nowText)
      const parsedRows = Array.isArray(result?.rows) ? result.rows : []
      if (parsedRows.length > 0) {
        return parsedRows.map((row) => {
          const companyName = toText(row.companyName)
          const pageUrl = toText(row.detailUrl || row.listPageUrl || seedUrl)
          const summary = [
            companyName ? `company=${companyName}` : '',
            toText(row.companyIntro) ? `intro=${toText(row.companyIntro).slice(0, 80)}` : '',
            toText(row.mainProducts) ? `products=${toText(row.mainProducts).slice(0, 80)}` : '',
            toText(row.qualitySystem) ? `quality=${toText(row.qualitySystem).slice(0, 80)}` : '',
          ].filter(Boolean).join(' | ')
          return {
            crawlType,
            businessEntity: context.businessEntity || '供应商',
            model: context.model || '',
            skill: context.skill || '',
            sourceUrl: seedUrl,
            pageUrl,
            pageTitle: companyName,
            textSample: summary,
            status: toText(row.status) || 'success',
            errorMessage: toText(row.errorMessage),
            supplierUrl: pageUrl,
            supplyChainInfo: summary,
          }
        })
      }
      return [{
        crawlType,
        businessEntity: context.businessEntity || '供应商',
        model: context.model || '',
        skill: context.skill || '',
        sourceUrl: seedUrl,
        pageUrl: seedUrl,
        pageTitle: '',
        textSample: '',
        status: 'failed',
        errorMessage: toText(result?.errorMessage) || '未识别到供应商详情信息',
        supplierUrl: seedUrl,
        supplyChainInfo: task.runLogs.slice(-5).join(' | ').slice(0, 500),
      }]
    } catch (error) {
      return [{
        crawlType,
        businessEntity: context.businessEntity || '供应商',
        model: context.model || '',
        skill: context.skill || '',
        sourceUrl: seedUrl,
        pageUrl: seedUrl,
        pageTitle: '',
        textSample: '',
        status: 'failed',
        errorMessage: error.message || 'playwright supplier crawl failed',
        supplierUrl: seedUrl,
        supplyChainInfo: task.runLogs.slice(-5).join(' | ').slice(0, 500),
      }]
    }
  }

  const rows = []
  const visited = new Set()
  const queue = [seedUrl]
  const maxPages = crawlType === '全量' ? 10 : 3
  const host = (() => {
    try {
      return new URL(seedUrl).host
    } catch {
      return ''
    }
  })()

  while (queue.length > 0 && visited.size < maxPages) {
    const currentUrl = queue.shift()
    if (!currentUrl || visited.has(currentUrl)) continue
    visited.add(currentUrl)
    try {
      const response = await fetchWithTimeout(currentUrl, 18000)
      const html = await response.text()
      const title = extractTitle(html)
      const plainText = stripHtml(html)
      rows.push({
        crawlType,
        businessEntity: context.businessEntity || '',
        model: context.model || '',
        skill: context.skill || '',
        sourceUrl: seedUrl,
        pageUrl: currentUrl,
        pageTitle: title,
        textSample: plainText.slice(0, 220),
        status: response.ok ? 'success' : `http_${response.status}`,
        errorMessage: response.ok ? '' : `HTTP ${response.status}`,
      })

      if (response.ok) {
        const links = extractLinks(html, currentUrl)
          .filter((item) => {
            try {
              return new URL(item).host === host
            } catch {
              return false
            }
          })
          .slice(0, maxPages * 2)
        for (const link of links) {
          if (!visited.has(link) && queue.length + visited.size < maxPages * 2) {
            queue.push(link)
          }
        }
      }
    } catch (error) {
      rows.push({
        crawlType,
        businessEntity: context.businessEntity || '',
        model: context.model || '',
        skill: context.skill || '',
        sourceUrl: seedUrl,
        pageUrl: currentUrl,
        pageTitle: '',
        textSample: '',
        status: 'failed',
        errorMessage: error.message || 'fetch error',
      })
    }
  }
  return rows
}

async function verifyAuthToken(accessToken) {
  const response = await fetchByNetworkPolicy(`${authBaseUrl}/auth2/api/v2/user/getLoginUser`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })
  if (!response.ok) return null

  const result = await response.json().catch(() => null)
  if (!result) return null

  const success = result.code === 200 || result.code === '200' || result.success === true
  if (!success || !result.data) return null
  return result.data
}

async function ensureAuthReachable() {
  if (!authReachabilityCheck) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)
  try {
    const response = await fetchByNetworkPolicy(`${authBaseUrl}/auth2/oauth2/authorize?client_id=${encodeURIComponent(oauthClientId)}&response_type=code`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    })
    if (response.status >= 500) {
      throw new Error(`auth server ${response.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
}

async function authMiddleware(req, res, next) {
  const isProduction = String(process.env.NODE_ENV || '').trim() === 'production'
  if (!authEnabled) return next()

  const token = getBearerToken(req)
  if ((authDevBypass || !isProduction) && !token) {
    req.authUser = {
      username: 'dev-anon',
      userName: 'dev-anon',
      displayName: '开发环境匿名用户',
    }
    req.accessToken = 'dev'
    return next()
  }
  if (!token) {
    return res.status(401).json({ code: 401, message: '缺少访问令牌，请先登录', data: null })
  }

  try {
    if ((authDevBypass || !isProduction) && (token === 'dev' || token.startsWith('dev_'))) {
      req.authUser = {
        username: 'dev-user',
        userName: 'dev-user',
        displayName: '开发环境用户',
      }
      req.accessToken = token
      return next()
    }

    const userInfo = await verifyAuthToken(token)
    if (!userInfo) {
      return res.status(401).json({ code: 401, message: '令牌无效或已过期，请重新登录', data: null })
    }
    req.authUser = userInfo
    req.accessToken = token
    return next()
  } catch (error) {
    if ((authDevBypass || !isProduction) && token) {
      req.authUser = {
        username: 'dev-fallback',
        userName: 'dev-fallback',
        displayName: '开发环境兜底用户',
      }
      req.accessToken = token
      return next()
    }
    return res.status(502).json({ code: 502, message: `认证服务异常: ${error.message}`, data: null })
  }
}

function normalizeSessionRow(row) {
  return {
    id: String(row.id),
    title: row.title,
    pinned: Boolean(row.pinned),
    owner: row.owner || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount: Number(row.messageCount || 0),
    latestQuestion: row.latestQuestion || '',
  }
}

async function saveSessionMessage(sessionId, role, content, meta = {}) {
  await pool.query(
    `INSERT INTO ${chatMessageTable} (session_id, role, content, meta) VALUES ($1, $2, $3, $4::jsonb)`,
    [sessionId, role, String(content || ''), JSON.stringify(meta || {})],
  )
  await pool.query(`UPDATE ${chatSessionTable} SET updated_at = NOW() WHERE id = $1`, [sessionId])
}

app.get('/api/health', async (_req, res) => {
  if (!dbReady) {
    await tryInitializeDatabaseIfNeeded('health-check')
  }
  if (!dbReady) {
    return res.status(503).json({
      code: 503,
      message: 'degraded',
      data: {
        service: 'asset-inventory-node24',
        db: 'unavailable',
        schema: schemaName,
        authEnabled,
        dbInitErrorMessage,
      },
    })
  }
  return res.json({
    code: 200,
    message: 'ok',
    data: {
      service: 'asset-inventory-node24',
      db: 'connected',
      schema: schemaName,
      authEnabled,
    },
  })
})

app.get('/', (_req, res) => {
  res.redirect(302, frontendLoginUrl)
})

app.get('/', (req, res) => {
  const hasOauthParams = Boolean(req.query?.code || req.query?.state || req.query?.error)
  if (hasOauthParams) {
    const query = new URLSearchParams(req.query || {}).toString()
    const target = query ? `/api/auth/callback?${query}` : '/api/auth/callback'
    return res.redirect(target)
  }
  return res.redirect(frontendLoginUrl)
})

app.get('/auth/callback', (req, res) => {
  const query = new URLSearchParams(req.query || {}).toString()
  const target = query ? `/api/auth/callback?${query}` : '/api/auth/callback'
  return res.redirect(target)
})

app.get('/api/auth/login-url', (_req, res) => {
  ;(async () => {
    try {
      let reachabilityWarning = ''
      try {
        await ensureAuthReachable()
      } catch (error) {
        // 预检查仅用于提示，不阻断实际跳转登录流程
        reachabilityWarning = String(error.message || 'auth_precheck_failed')
      }
      const state = String(_req.query.state || Date.now())
      const scope = String(_req.query.scope || 'openid all')

      const params = new URLSearchParams({
        client_id: oauthClientId,
        response_type: 'code',
        scope,
        state,
        redirect_uri: oauthRedirectUri,
      })

      const loginUrl = `${authBaseUrl}/auth2/oauth2/authorize?${params.toString()}`
      return res.json({ code: 200, message: 'success', data: { loginUrl, state, reachabilityWarning } })
    } catch (error) {
      return res.status(502).json({
        code: 502,
        message: `无法访问认证中心，请先连接公司内网或VPN。详情: ${error.message}`,
        data: null,
      })
    }
  })()
})

app.get('/api/auth/callback', async (req, res) => {
  const code = String(req.query.code || '')
  const state = String(req.query.state || '')
  if (!code) {
    return res.status(400).json({ code: 400, message: '缺少授权码 code', data: null })
  }

  try {
    const form = new FormData()
    form.set('redirect_uri', oauthRedirectUri)
    form.set('grant_type', 'authorization_code')
    form.set('code', code)
    form.set('client_id', oauthClientId)
    form.set('client_secret', oauthClientSecret)

    const tokenResponse = await fetchByNetworkPolicy(`${authBaseUrl}/auth2/oauth2/token`, {
      method: 'POST',
      body: form,
    })
    const tokenData = await tokenResponse.json().catch(() => ({}))

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(502).json({
        code: 502,
        message: '认证中心换取 token 失败',
        data: tokenData,
      })
    }

    const redirectParams = new URLSearchParams({
      access_token: tokenData.access_token || '',
      refresh_token: tokenData.refresh_token || '',
      expires_in: String(tokenData.expires_in || ''),
      token_type: tokenData.token_type || 'Bearer',
      state,
    })

    return res.redirect(`${frontendCallbackUrl}?${redirectParams.toString()}`)
  } catch (error) {
    return res.status(502).json({ code: 502, message: `认证中心调用失败: ${error.message}`, data: null })
  }
})

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ code: 200, message: 'success', data: req.authUser || null })
})

app.get('/api/auth/logout-url', authMiddleware, async (req, res) => {
  const isProduction = String(process.env.NODE_ENV || '').trim() === 'production'
  try {
    const ticketRes = await fetchByNetworkPolicy(`${authBaseUrl}/auth2/api/v2/login/logoutTicket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.accessToken}`,
        Accept: 'application/json',
      },
    })
    const ticketData = await ticketRes.json().catch(() => ({}))
    const logoutTicket = ticketData?.data || ''

    if (!logoutTicket) {
      if (!isProduction) {
        return res.json({ code: 200, message: 'success', data: { logoutUrl: frontendLoginUrl } })
      }
      return res.status(502).json({ code: 502, message: '获取 logoutTicket 失败', data: ticketData })
    }

    const params = new URLSearchParams({
      client_id: oauthClientId,
      post_logout_redirect_uri: frontendLoginUrl,
      logout_ticket: logoutTicket,
      state: '123',
    })

    const logoutUrl = `${authBaseUrl}/auth2/oauth/logout?${params.toString()}`
    return res.json({ code: 200, message: 'success', data: { logoutUrl } })
  } catch (error) {
    if (!isProduction) {
      return res.json({ code: 200, message: 'success', data: { logoutUrl: frontendLoginUrl } })
    }
    return res.status(502).json({ code: 502, message: `获取退出地址失败: ${error.message}`, data: null })
  }
})

app.get('/api/codex/models', authMiddleware, (_req, res) => {
  return res.json({ code: 200, message: 'success', data: codexModelOptions })
})

app.get('/api/crawl/skills', authMiddleware, (_req, res) => {
  return res.json({ code: 200, message: 'success', data: supplierSkillOptions })
})

app.get('/api/skills', authMiddleware, async (_req, res) => {
  try {
    const items = await readInstalledSkillsFromDisk()
    return res.json({ code: 200, message: 'success', data: items })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取技能列表失败: ${error.message}`, data: [] })
  }
})

app.post('/api/skills/uninstall', authMiddleware, async (req, res) => {
  const source = toText(req.body?.source)
  const name = toText(req.body?.name)
  if (!source || !name) {
    return res.status(400).json({ code: 400, message: '缺少必要参数（name/source）', data: null })
  }
  const targetPath = resolveSafePath(source)
  const allowed = skillRootDirs.some((root) => isPathInsideRoot(targetPath, root))
  if (!allowed) {
    return res.status(403).json({ code: 403, message: '不允许卸载该路径下的技能', data: null })
  }
  const expectedName = path.basename(targetPath)
  if (expectedName !== name) {
    return res.status(400).json({ code: 400, message: '技能名称与路径不匹配', data: null })
  }
  try {
    await fs.rm(targetPath, { recursive: true, force: false })
    return res.json({ code: 200, message: 'success', data: { name, source: targetPath } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `卸载失败: ${error.message}`, data: null })
  }
})

app.get('/api/mcp-services', authMiddleware, async (_req, res) => {
  try {
    const enabled = [...await loadConfiguredMcpServices(), ...await loadConfiguredAgentReachServices()]
    const shadow = await readMcpShadowState()
    const disabledMap = shadow?.disabled && typeof shadow.disabled === 'object' ? shadow.disabled : {}
    const disabledNameSet = new Set(Object.keys(disabledMap).map((name) => toMcpServiceName(name)))
    const disabled = Object.entries(disabledMap).map(([name, item]) => ({
      name,
      source: toText(item?.source || 'codex-config'),
      installPath: toText(item?.installPath || codexConfigPath),
      description: toText(item?.description || ''),
      type: toText(item?.type || 'stdio') || 'stdio',
      url: toText(item?.url || ''),
      command: toText(item?.command || ''),
      env: item?.env && typeof item.env === 'object' ? item.env : {},
      enabled: false,
    }))
    const activeEnabled = enabled.filter((row) => !disabledNameSet.has(toMcpServiceName(row.name)))
    const merged = [...activeEnabled, ...disabled]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    const withCallable = []
    for (const item of merged) {
      // eslint-disable-next-line no-await-in-loop
      const check = await evaluateMcpCallable(item)
      withCallable.push({
        ...item,
        callable: check.callable,
        callableReason: check.reason,
      })
    }
    return res.json({ code: 200, message: 'success', data: withCallable })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取MCP服务失败: ${error.message}`, data: [] })
  }
})

app.post('/api/mcp-services/search', authMiddleware, async (req, res) => {
  const service = toMcpServiceName(req.body?.service)
  const keyword = toText(req.body?.keyword)
  if (!service) return res.status(400).json({ code: 400, message: '缺少参数：service', data: null })
  if (!keyword) return res.status(400).json({ code: 400, message: '缺少参数：keyword', data: null })
  if (service.toLowerCase() === 'exa') {
    return res.status(400).json({ code: 400, message: 'exa 已禁用，请使用 tavily / weixin-reader / weibo', data: null })
  }
  const now = new Date().toISOString()
  try {
    let serviceMeta = {}
    try {
      const all = [...await loadConfiguredMcpServices(), ...await loadConfiguredAgentReachServices()]
      const found = all.find((item) => toMcpServiceName(item.name) === service)
      serviceMeta = found || {}
    } catch {
      serviceMeta = {}
    }
    let snippets = []
    if (service.toLowerCase() === 'tavily') {
      const tavilyKey = await resolveTavilyApiKey(serviceMeta)
      snippets = await searchViaTavily(keyword, tavilyKey)
    } else {
      snippets = await searchWebSnippets(keyword, service)
    }

    const withWeixinContent = []
    for (const item of snippets.slice(0, 5)) {
      const row = { ...item }
      if (/https?:\/\/mp\.weixin\.qq\.com\//i.test(toText(row.href))) {
        // eslint-disable-next-line no-await-in-loop
        const wxMd = await readWeixinArticleMarkdown(row.href)
        if (wxMd) {
          row.summary = extractKeySentences(wxMd, 3).join(' ')
          row.snippet = row.summary || row.snippet
          row.rawContent = wxMd
        }
      }
      withWeixinContent.push(row)
    }

    const enriched = service.toLowerCase() === 'tavily'
      ? withWeixinContent.map((item) => ({
        ...item,
        summary: /https?:\/\/mp\.weixin\.qq\.com\//i.test(toText(item.href))
          ? compactText(
            extractKeySentences(toText(item.rawContent) || toText(item.snippet), 4).join(' ')
            || toText(item.summary)
            || '暂无摘要',
            600,
          )
          : compactText(
            toText(item.summary)
            || extractKeySentences(toText(item.snippet), 2).join(' ')
            || extractKeySentences(toText(item.rawContent), 1).join(' ')
            || '暂无摘要',
            220,
          ),
      }))
      : await enrichSearchRows(withWeixinContent)
    const scopedRows = service.toLowerCase() === 'tavily'
      ? enriched.filter((item) => {
        const merged = `${toText(item.title)} ${toText(item.summary)} ${toText(item.snippet)} ${toText(item.href)}`
        if (containsCatlIntent(keyword) && !containsCatlIntent(merged)) return false
        if (isBoilerplateLike(toText(item.summary))) return false
        if (isNoiseHost(toText(item.href))) return false
        return true
      })
      : enriched
    const filtered = scopedRows.filter((item) => {
      const baseOk = scoreRelevance(item.title, `${item.snippet} ${item.summary}`, keyword) > 0
      if (service.toLowerCase() !== 'tavily') return baseOk
      const merged = `${toText(item.title)} ${toText(item.summary)} ${toText(item.snippet)} ${toText(item.href)}`
      const catlOk = containsCatlIntent(keyword) && containsCatlIntent(merged)
      const preferOk = Number(item.preferredScore || 0) >= 3
      return baseOk || preferOk || catlOk
    })
    let fallbackRows = service.toLowerCase() === 'tavily' ? [] : scopedRows.slice(0, 5)
    if (service.toLowerCase() === 'tavily' && filtered.length === 0) {
      const tavilyKey = await resolveTavilyApiKey(serviceMeta)
      fallbackRows = await searchViaTavilyRaw(keyword, tavilyKey)
    }
    const usedFallback = filtered.length === 0 && fallbackRows.length > 0
    const finalRows = filtered.length > 0 ? filtered : fallbackRows
    const headerLine = [
      `[${now}]`,
      `service=${service}`,
      `keyword=${keyword}`,
      `desc=${toText(serviceMeta.description) || 'N/A'}`,
      `hits=${finalRows.length}`,
    ].join(' ')
    const hasWeixinRows = finalRows.some((item) => /https?:\/\/mp\.weixin\.qq\.com\//i.test(toText(item.href)))
    const summaryLines = hasWeixinRows
      ? []
      : [
        '【提炼总结】',
        ...(finalRows.length > 0
          ? finalRows.slice(0, 3).map((item, idx) => `${idx + 1}. ${toText(item.summary) || '暂无摘要'}`)
          : ['1. 未检索到候选结果，请更换关键词或切换服务。']),
        ...(usedFallback ? ['[提示] 当前为低置信候选结果（未通过关键词强相关过滤）。'] : []),
      ]
    const bodyLines = finalRows.map((item, idx) => {
      const t = toText(item.title) || '(无标题)'
      const isWeixin = /https?:\/\/mp\.weixin\.qq\.com\//i.test(toText(item.href))
      const s = isWeixin
        ? (toText(item.rawContent) || toText(item.summary || item.snippet))
        : toText(item.summary || item.snippet)
      const u = toText(item.href)
      return `${idx + 1}. ${t}\n${s}${u ? `\n${u}` : ''}`
    })
    const line = [headerLine, ...summaryLines, ...bodyLines].join('\n')
    return res.json({ code: 200, message: 'success', data: { text: line } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `MCP检索失败: ${error.message}`, data: null })
  }
})

app.post('/api/mcp-services/install', authMiddleware, async (req, res) => {
  const name = toMcpServiceName(req.body?.name)
  const type = toText(req.body?.type || 'stdio').toLowerCase() === 'http' ? 'http' : 'stdio'
  const description = toText(req.body?.description)
  const url = toText(req.body?.url)
  const command = toText(req.body?.command)
  const envInput = req.body?.env && typeof req.body.env === 'object' ? req.body.env : {}
  const envPairs = Object.entries(envInput).filter(([k]) => toText(k))
  if (!name) return res.status(400).json({ code: 400, message: '缺少参数：name', data: null })
  if (type === 'http' && !url) return res.status(400).json({ code: 400, message: 'HTTP类型缺少参数：url', data: null })
  if (type === 'stdio' && !command) return res.status(400).json({ code: 400, message: 'stdio类型缺少参数：command', data: null })
  try {
    const args = ['mcp', 'add', name]
    if (type === 'http') {
      args.push('--url', url)
    } else {
      for (const [k, v] of envPairs) args.push('--env', `${k}=${toText(v)}`)
      args.push('--', ...command.split(/\s+/g).filter(Boolean))
    }
    await execFileAsync('codex', args, { timeout: 40000 })
    const shadow = await readMcpShadowState()
    if (!shadow.disabled) shadow.disabled = {}
    delete shadow.disabled[name]
    await writeMcpShadowState(shadow)
    return res.json({
      code: 200,
      message: 'success',
      data: {
        name,
        source: 'codex-config',
        installPath: codexConfigPath,
        description,
        type,
        url,
        command,
        env: Object.fromEntries(envPairs.map(([k, v]) => [k, toText(v)])),
        enabled: true,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `安装MCP服务失败: ${error.message}`, data: null })
  }
})

app.put('/api/mcp-services/:name', authMiddleware, async (req, res) => {
  const oldName = toMcpServiceName(req.params?.name)
  const nextName = toMcpServiceName(req.body?.name || oldName)
  const type = toText(req.body?.type || 'stdio').toLowerCase() === 'http' ? 'http' : 'stdio'
  const description = toText(req.body?.description)
  const url = toText(req.body?.url)
  const command = toText(req.body?.command)
  const envInput = req.body?.env && typeof req.body.env === 'object' ? req.body.env : {}
  const envPairs = Object.entries(envInput).filter(([k]) => toText(k))
  if (!oldName || !nextName) return res.status(400).json({ code: 400, message: '缺少参数：name', data: null })
  try {
    await execFileAsync('codex', ['mcp', 'remove', oldName], { timeout: 20000 }).catch(() => null)
    const addArgs = ['mcp', 'add', nextName]
    if (type === 'http') {
      addArgs.push('--url', url)
    } else {
      for (const [k, v] of envPairs) addArgs.push('--env', `${k}=${toText(v)}`)
      addArgs.push('--', ...command.split(/\s+/g).filter(Boolean))
    }
    await execFileAsync('codex', addArgs, { timeout: 40000 })
    const shadow = await readMcpShadowState()
    if (!shadow.disabled) shadow.disabled = {}
    delete shadow.disabled[oldName]
    delete shadow.disabled[nextName]
    await writeMcpShadowState(shadow)
    return res.json({ code: 200, message: 'success', data: { name: nextName, description, type, url, command, env: Object.fromEntries(envPairs), enabled: true } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `修改MCP服务失败: ${error.message}`, data: null })
  }
})

app.post('/api/mcp-services/:name/toggle', authMiddleware, async (req, res) => {
  const name = toMcpServiceName(req.params?.name)
  const enabled = req.body?.enabled === true
  if (!name) return res.status(400).json({ code: 400, message: '缺少参数：name', data: null })
  try {
    const shadow = await readMcpShadowState()
    if (!shadow.disabled) shadow.disabled = {}
    if (isAgentReachVirtualMcp(name)) {
      if (enabled) {
        delete shadow.disabled[name]
      } else {
        const rows = await loadConfiguredAgentReachServices()
        const found = rows.find((row) => row.name === name)
        shadow.disabled[name] = {
          source: 'agent-reach',
          installPath: found?.installPath || '',
          type: found?.type || 'stdio',
          url: found?.url || '',
          command: found?.command || '',
          env: found?.env && typeof found.env === 'object' ? found.env : {},
          description: found?.description || toText(req.body?.description || ''),
        }
      }
      await writeMcpShadowState(shadow)
      return res.json({ code: 200, message: 'success', data: { name, enabled } })
    }
    if (enabled) {
      const cached = shadow.disabled[name]
      if (!cached) return res.status(400).json({ code: 400, message: '缺少已缓存配置，无法启用', data: null })
      const addArgs = ['mcp', 'add', name]
      if ((cached.type || 'stdio') === 'http') addArgs.push('--url', toText(cached.url))
      else {
        const envObj = cached.env && typeof cached.env === 'object' ? cached.env : {}
        for (const [k, v] of Object.entries(envObj)) addArgs.push('--env', `${k}=${toText(v)}`)
        addArgs.push('--', ...toText(cached.command).split(/\s+/g).filter(Boolean))
      }
      await execFileAsync('codex', addArgs, { timeout: 40000 })
      delete shadow.disabled[name]
      await writeMcpShadowState(shadow)
    } else {
      let detail = null
      try {
        const { stdout } = await execFileAsync('codex', ['mcp', 'get', name, '--json'], { timeout: 20000 })
        detail = JSON.parse(String(stdout || '{}'))
      } catch {
        detail = {}
      }
      shadow.disabled[name] = {
        type: detail?.url ? 'http' : 'stdio',
        url: toText(detail?.url || ''),
        command: Array.isArray(detail?.command) ? detail.command.join(' ') : toText(detail?.command || ''),
        env: detail?.env && typeof detail.env === 'object' ? detail.env : {},
        description: toText(req.body?.description || ''),
      }
      await execFileAsync('codex', ['mcp', 'remove', name], { timeout: 20000 })
      await writeMcpShadowState(shadow)
    }
    return res.json({ code: 200, message: 'success', data: { name, enabled } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `切换MCP服务状态失败: ${error.message}`, data: null })
  }
})

app.delete('/api/mcp-services/:name', authMiddleware, async (req, res) => {
  const name = toMcpServiceName(req.params?.name)
  if (!name) return res.status(400).json({ code: 400, message: '缺少参数：name', data: null })
  try {
    if (isAgentReachVirtualMcp(name)) {
      const shadow = await readMcpShadowState()
      if (!shadow.disabled) shadow.disabled = {}
      shadow.disabled[name] = {
        source: 'agent-reach',
        installPath: '',
        type: 'stdio',
        url: '',
        command: '',
        env: {},
        description: '已卸载',
      }
      await writeMcpShadowState(shadow)
      return res.json({ code: 200, message: 'success', data: { name } })
    }
    await execFileAsync('codex', ['mcp', 'remove', name], { timeout: 20000 }).catch(() => null)
    const shadow = await readMcpShadowState()
    if (!shadow.disabled) shadow.disabled = {}
    delete shadow.disabled[name]
    await writeMcpShadowState(shadow)
    return res.json({ code: 200, message: 'success', data: { name } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `卸载MCP服务失败: ${error.message}`, data: null })
  }
})

app.get('/api/knowledge-bases', authMiddleware, async (_req, res) => {
  try {
    const [kbRes, docRes] = await Promise.all([
      pool.query(`SELECT id, name, config_json AS config, created_at AS "createdAt", updated_at AS "updatedAt" FROM ${knowledgeBaseTable} ORDER BY updated_at DESC`),
      pool.query(`SELECT id, kb_id AS "kbId", source_type AS "sourceType", name, url, mime_type AS "mimeType", size_bytes AS size, status, chunk_count AS "chunkCount", vector_count AS "vectorCount", retry_count AS "retryCount", error_message AS "errorMessage", vector_path AS "vectorPath", content_base64 AS "contentBase64", created_at AS "createdAt", updated_at AS "updatedAt", completed_at AS "completedAt" FROM ${knowledgeBaseDocumentTable} ORDER BY updated_at DESC`),
    ])
    const docs = docRes.rows || []
    const docMap = new Map()
    for (const doc of docs) {
      const key = toText(doc.kbId)
      if (!docMap.has(key)) docMap.set(key, [])
      const normalizedSourceType = (
        toText(doc.sourceType) === 'web'
        && toText(doc.url).startsWith('mcp://')
      ) ? 'search' : toText(doc.sourceType)
      docMap.get(key).push({
        id: doc.id,
        sourceType: normalizedSourceType,
        name: doc.name,
        url: doc.url,
        size: Number(doc.size || 0),
        mimeType: doc.mimeType || '',
        status: doc.status || 'queued',
        chunkCount: Number(doc.chunkCount || 0),
        vectorCount: Number(doc.vectorCount || 0),
        retryCount: Number(doc.retryCount || 0),
        errorMessage: toText(doc.errorMessage || ''),
        createdAt: doc.createdAt || '',
        updatedAt: doc.updatedAt || '',
      })
    }
    const rows = (kbRes.rows || [])
      .map((item) => ({
        id: item.id,
        name: item.name,
        config: item.config || {},
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        documents: docMap.get(toText(item.id)) || [],
      }))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    return res.json({ code: 200, message: 'success', data: rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取知识库失败: ${error.message}`, data: null })
  }
})

app.post('/api/knowledge-bases', authMiddleware, async (req, res) => {
  const name = toText(req.body?.name)
  if (!name) return res.status(400).json({ code: 400, message: '缺少参数：name', data: null })
  const id = generateKbId('kb')
  const now = new Date().toISOString()
  const embeddingModel = toText(req.body?.embeddingModel) || defaultKbEmbeddingModel
  const config = {
    embeddingModel,
    embeddingDimension: 1536,
    topK: Number(req.body?.topK || 10) || 10,
  }
  const row = { id, name, config, createdAt: now, updatedAt: now, documents: [] }
  knowledgeBaseStore.set(id, row)
  await upsertKnowledgeBaseRow(row)
  schedulePersistKnowledgeBaseStore()
  return res.status(201).json({ code: 201, message: 'created', data: row })
})

app.put('/api/knowledge-bases/:id', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return res.status(404).json({ code: 404, message: '知识库不存在', data: null })
  const name = toText(req.body?.name)
  if (!name) return res.status(400).json({ code: 400, message: '缺少参数：name', data: null })
  const embeddingModel = toText(req.body?.embeddingModel) || defaultKbEmbeddingModel
  const topK = Number(req.body?.topK || 10) || 10
  const now = new Date().toISOString()
  kb.name = name
  kb.config = {
    ...kb.config,
    embeddingModel,
    embeddingDimension: 1536,
    topK,
  }
  kb.updatedAt = now
  await upsertKnowledgeBaseRow(kb)
  schedulePersistKnowledgeBaseStore()
  return res.json({ code: 200, message: 'updated', data: kb })
})

app.post('/api/knowledge-bases/:id/documents/file', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return res.status(404).json({ code: 404, message: '知识库不存在', data: null })
  const name = toText(req.body?.name)
  const contentBase64 = toText(req.body?.contentBase64)
  const mimeType = toText(req.body?.mimeType)
  const size = Number(req.body?.size || 0)
  if (!name || !contentBase64) {
    return res.status(400).json({ code: 400, message: '缺少参数：name/contentBase64', data: null })
  }
  const now = new Date().toISOString()
  const doc = {
    id: generateKbId('doc'),
    sourceType: 'file',
    name,
    mimeType,
    size,
    contentBase64,
    status: 'queued',
    retryCount: 0,
    chunkCount: 0,
    vectorCount: 0,
    errorMessage: '',
    createdAt: now,
    updatedAt: now,
  }
  kb.documents = [doc, ...(kb.documents || [])]
  kb.updatedAt = now
  await upsertKnowledgeBaseDocumentRow(kbId, doc)
  schedulePersistKnowledgeBaseStore()
  void runKnowledgeDocumentPipeline(kbId, doc.id)
  return res.status(202).json({ code: 202, message: 'accepted', data: { id: doc.id } })
})

app.get('/api/knowledge-bases/:id/documents/:docId/preview', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const docId = toText(req.params?.docId)
  if (!kbId || !docId) return res.status(400).json({ code: 400, message: '缺少参数', data: null })
  try {
    const docRes = await pool.query(
      `SELECT id, kb_id AS "kbId", source_type AS "sourceType", name, url, status, error_message AS "errorMessage", content_base64 AS "contentBase64", updated_at AS "updatedAt"
       FROM ${knowledgeBaseDocumentTable}
       WHERE id = $1 AND kb_id = $2
       LIMIT 1`,
      [docId, kbId],
    )
    const doc = docRes.rows?.[0]
    if (!doc) return res.status(404).json({ code: 404, message: '文档不存在', data: null })
    const chunksRes = await pool.query(
      `SELECT chunk_index AS "chunkIndex", left(chunk_text, 500) AS "chunkText", embedding_model AS "embeddingModel", embedding_dim AS "embeddingDim"
       FROM ${knowledgeBaseVectorTable}
       WHERE kb_id = $1 AND doc_id = $2
       ORDER BY chunk_index ASC
       LIMIT 8`,
      [kbId, docId],
    )
    const decoded = decodeBase64Utf8(doc.contentBase64)
    const plain = doc.sourceType === 'web' ? stripHtmlTags(decoded) : decoded
    const chunks = chunksRes.rows || []
    const fallbackText = chunks.map((item) => toText(item.chunkText)).join('\n\n')
    const previewText = (plain || fallbackText).slice(0, 6000)
    return res.json({
      code: 200,
      message: 'success',
      data: {
        id: doc.id,
        kbId: doc.kbId,
        sourceType: doc.sourceType,
        name: doc.name,
        url: doc.url,
        status: doc.status,
        errorMessage: toText(doc.errorMessage),
        updatedAt: doc.updatedAt,
        previewText,
        chunks,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `预览失败: ${error.message}`, data: null })
  }
})

app.post('/api/knowledge-bases/:id/documents/web', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return res.status(404).json({ code: 404, message: '知识库不存在', data: null })
  const url = toText(req.body?.url)
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ code: 400, message: 'URL 无效', data: null })
  }
  const now = new Date().toISOString()
  const doc = {
    id: generateKbId('doc'),
    sourceType: 'search',
    name: url,
    url,
    mimeType: 'text/html',
    size: 0,
    status: 'queued',
    retryCount: 0,
    chunkCount: 0,
    vectorCount: 0,
    errorMessage: '',
    createdAt: now,
    updatedAt: now,
  }
  kb.documents = [doc, ...(kb.documents || [])]
  kb.updatedAt = now
  await upsertKnowledgeBaseDocumentRow(kbId, doc)
  schedulePersistKnowledgeBaseStore()
  void runKnowledgeDocumentPipeline(kbId, doc.id)
  return res.status(202).json({ code: 202, message: 'accepted', data: { id: doc.id } })
})

app.post('/api/knowledge-bases/:id/documents/text', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return res.status(404).json({ code: 404, message: '知识库不存在', data: null })
  const service = toMcpServiceName(req.body?.service)
  const keyword = toText(req.body?.keyword)
  const text = toText(req.body?.text)
  if (!text) return res.status(400).json({ code: 400, message: '缺少参数：text', data: null })
  const now = new Date().toISOString()
  const contentBase64 = Buffer.from(text, 'utf8').toString('base64')
  const doc = {
    id: generateKbId('doc'),
    sourceType: 'search',
    name: `[MCP] ${service || 'unknown'} - ${keyword || 'manual'}`,
    url: `mcp://${encodeURIComponent(service || 'unknown')}?q=${encodeURIComponent(keyword || '')}`,
    mimeType: 'text/plain',
    size: Buffer.byteLength(text, 'utf8'),
    contentBase64,
    status: 'queued',
    retryCount: 0,
    chunkCount: 0,
    vectorCount: 0,
    errorMessage: '',
    createdAt: now,
    updatedAt: now,
  }
  kb.documents = [doc, ...(kb.documents || [])]
  kb.updatedAt = now
  await upsertKnowledgeBaseDocumentRow(kbId, doc)
  schedulePersistKnowledgeBaseStore()
  void runKnowledgeDocumentPipeline(kbId, doc.id)
  return res.status(202).json({ code: 202, message: 'accepted', data: { id: doc.id } })
})

app.post('/api/knowledge-bases/:id/documents/:docId/retry', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const docId = toText(req.params?.docId)
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return res.status(404).json({ code: 404, message: '知识库不存在', data: null })
  const doc = (kb.documents || []).find((item) => item.id === docId)
  if (!doc) return res.status(404).json({ code: 404, message: '文档不存在', data: null })
  doc.retryCount = Number(doc.retryCount || 0) + 1
  doc.status = 'queued'
  doc.errorMessage = '重试中，准备解析...'
  if (toText(doc.sourceType) === 'web' && /^mcp:\/\//i.test(toText(doc.url))) {
    doc.sourceType = 'search'
  }
  doc.updatedAt = new Date().toISOString()
  kb.updatedAt = doc.updatedAt
  await upsertKnowledgeBaseDocumentRow(kbId, doc)
  schedulePersistKnowledgeBaseStore()
  void runKnowledgeDocumentPipeline(kbId, docId)
  return res.json({ code: 200, message: 'retry_triggered', data: { id: docId } })
})

app.delete('/api/knowledge-bases/:id/documents/:docId', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const docId = toText(req.params?.docId)
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return res.status(404).json({ code: 404, message: '知识库不存在', data: null })
  const docs = Array.isArray(kb.documents) ? kb.documents : []
  const target = docs.find((item) => item.id === docId)
  if (!target) return res.status(404).json({ code: 404, message: '文档不存在', data: null })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM ${knowledgeBaseDocumentTable} WHERE id = $1 AND kb_id = $2`, [docId, kbId])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    return res.status(500).json({ code: 500, message: `删除失败: ${error.message}`, data: null })
  } finally {
    client.release()
  }
  kb.documents = docs.filter((item) => item.id !== docId)
  kb.updatedAt = new Date().toISOString()
  schedulePersistKnowledgeBaseStore()
  const vectorPath = toText(target.vectorPath)
  if (vectorPath) {
    await fs.unlink(vectorPath).catch(() => {})
  }
  return res.json({ code: 200, message: 'deleted', data: { id: docId } })
})

app.post('/api/knowledge-bases/:id/search', authMiddleware, async (req, res) => {
  const kbId = toText(req.params?.id)
  const kb = knowledgeBaseStore.get(kbId)
  if (!kb) return res.status(404).json({ code: 404, message: '知识库不存在', data: null })
  const queryText = toText(req.body?.query)
  if (!queryText) return res.status(400).json({ code: 400, message: '缺少参数：query', data: null })
  const metricRaw = toText(req.body?.metric).toLowerCase()
  const metric = metricRaw === 'euclidean' ? 'euclidean' : 'cosine'
  const topK = Math.min(Math.max(Number(req.body?.topK || kb.config?.topK || 10), 1), 200)
  const candidateK = Math.min(Math.max(topK * 8, 80), 500)
  const queryVector = await embedTextByProvider(
    queryText,
    resolveKnowledgeBaseEmbeddingModel(kb),
    knowledgeVectorStoreDim,
  )
  const queryVectorLiteral = toPgVectorLiteral(queryVector)
  const orderExpr = metric === 'euclidean' ? 'embedding <-> $3::vector' : 'embedding <=> $3::vector'
  const queryTokens = (() => {
    const bySplit = queryText.split(/[\s,，。；;、|]+/g).map((item) => item.trim()).filter(Boolean)
    if (bySplit.length > 1) return [...new Set(bySplit.filter((item) => item.length >= 2))]
    const single = bySplit[0] || queryText
    if (/^[\u4e00-\u9fff]+$/.test(single) && single.length >= 2) {
      const grams = new Set()
      for (let i = 0; i < single.length - 1; i += 2) grams.add(single.slice(i, i + 2))
      if (single.length % 2 === 1 && single.length >= 3) {
        grams.add(single.slice(single.length - 2))
      }
      grams.add(single)
      return [...grams].filter((item) => item.length >= 2)
    }
    return single.length >= 2 ? [single] : []
  })()
  const aliasTokenMap = [
    {
      test: ['认证体系', '质量体系', '体系认证'],
      aliases: ['ts16949', 'ts 16949', 'iatf16949', 'iatf 16949', 'iso9001', 'iso 9001', '体系认证', '质量管理体系'],
    },
  ]
  const expandedTokens = new Set(queryTokens)
  const queryLower = queryText.toLowerCase()
  for (const item of aliasTokenMap) {
    if (item.test.some((token) => queryText.includes(token) || queryLower.includes(token.toLowerCase()))) {
      item.aliases.forEach((alias) => expandedTokens.add(alias))
    }
  }
  const finalTokens = [...expandedTokens].filter((token) => String(token || '').trim().length >= 2)
  const strictKeyword = req.body?.strictKeyword !== false
  const perDocLimit = Math.max(1, Number(req.body?.perDocLimit || 6))
  try {
    const result = await pool.query(
      `
      SELECT
        v.id,
        v.kb_id AS "kbId",
        v.doc_id AS "docId",
        v.chunk_index AS "chunkIndex",
        v.chunk_text AS "chunkText",
        v.embedding_model AS "embeddingModel",
        v.embedding_dim AS "embeddingDim",
        v.embedding::text AS "embeddingText",
        d.source_type AS "sourceType",
        d.name AS "docName",
        d.url AS "docUrl",
        (v.embedding <=> $3::vector) AS "cosineDistance",
        (v.embedding <-> $3::vector) AS "euclideanDistance"
      FROM ${knowledgeBaseVectorTable} v
      LEFT JOIN ${knowledgeBaseDocumentTable} d ON d.id = v.doc_id
      WHERE v.kb_id = $1
        AND embedding IS NOT NULL
      ORDER BY ${orderExpr} ASC
      LIMIT $2
      `,
      [kbId, candidateK, queryVectorLiteral],
    )
    const rankedRows = (result.rows || []).map((row) => {
      const vectorText = toText(row.embeddingText).replace(/^\[|\]$/g, '')
      const embedding = vectorText
        ? vectorText.split(',').map((item) => Number(item)).filter((item) => Number.isFinite(item))
        : []
      const chunkText = toText(row.chunkText)
      const phraseHit = chunkText.toLowerCase().includes(queryText.toLowerCase()) ? 1 : 0
      let tokenHits = 0
      const hitTokens = []
      const lowerChunk = chunkText.toLowerCase()
      for (const token of finalTokens) {
        if (!token) continue
        const normalizedToken = token.toLowerCase().replace(/\s+/g, '')
        if (!normalizedToken) continue
        const normalizedChunk = lowerChunk.replace(/\s+/g, '')
        if (normalizedChunk.includes(normalizedToken)) {
          tokenHits += 1
          hitTokens.push(token)
        }
      }
      const allTermsHit = finalTokens.length === 0 ? 0 : (tokenHits > 0 ? 1 : 0)
      const cosineDistance = Number(row.cosineDistance || 0)
      const euclideanDistance = Number(row.euclideanDistance || 0)
      const baseDistance = metric === 'euclidean' ? euclideanDistance : cosineDistance
      const keywordBoost = phraseHit * 0.3 + allTermsHit * 0.25 + tokenHits * 0.05
      const sourceBoost = toText(row.sourceType) === 'search' ? 0.025 : 0
      const finalScore = baseDistance - keywordBoost - sourceBoost
      return {
        id: row.id,
        kbId: row.kbId,
        docId: row.docId,
        chunkIndex: Number(row.chunkIndex || 0),
        chunkText,
        embeddingModel: toText(row.embeddingModel),
        embeddingDim: Number(row.embeddingDim || 1536),
        sourceType: toText(row.sourceType),
        docName: toText(row.docName),
        docUrl: toText(row.docUrl),
        embedding,
        cosineDistance,
        euclideanDistance,
        phraseHit,
        tokenHits,
        hitTokens,
        allTermsHit,
        finalScore,
      }
    })
      .filter((item) => !strictKeyword || item.phraseHit > 0 || item.tokenHits > 0)
      .sort((a, b) => a.finalScore - b.finalScore)
    const picked = []
    const docCounts = new Map()
    for (const item of rankedRows) {
      const key = toText(item.docId)
      const used = Number(docCounts.get(key) || 0)
      if (used >= perDocLimit) continue
      picked.push(item)
      docCounts.set(key, used + 1)
      if (picked.length >= topK) break
    }
    const rows = picked
    return res.json({
      code: 200,
      message: 'success',
      data: {
        kbId,
        metric,
        topK,
        query: queryText,
        queryTokens: finalTokens,
        strictKeyword,
        perDocLimit,
        queryVector,
        results: rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `向量检索失败: ${error.message}`, data: null })
  }
})

app.post('/api/skills/install', authMiddleware, async (req, res) => {
  const name = toText(req.body?.name)
  const installBasePath = toText(req.body?.installPath)
  const description = toText(req.body?.description) || '技能说明'
  const origin = toText(req.body?.source)
  if (!name || !installBasePath) {
    return res.status(400).json({ code: 400, message: '缺少必要参数（name/installPath）', data: null })
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return res.status(400).json({ code: 400, message: '技能名称仅允许字母、数字、下划线、点和中划线', data: null })
  }

  const basePath = resolveSafePath(installBasePath)
  const targetPath = path.basename(basePath).toLowerCase() === name.toLowerCase()
    ? basePath
    : path.join(basePath, name)
  const skillFile = path.join(targetPath, 'SKILL.md')

  try {
    await fs.mkdir(targetPath, { recursive: true })
    try {
      await fs.access(skillFile)
      return res.status(409).json({ code: 409, message: `安装失败：目标已存在 ${skillFile}`, data: null })
    } catch {
      // file not exists
    }
    const content = [
      '# Skill',
      '',
      `- 名称：${name}`,
      `- 来源：${origin || '本地安装'}`,
      '',
      '## 说明',
      description,
      '',
      '## 用法',
      '按项目需要调用该技能。',
      '',
    ].join('\n')
    await fs.writeFile(skillFile, content, 'utf8')
    return res.json({
      code: 200,
      message: 'success',
      data: {
        name,
        source: targetPath,
        installPath: targetPath,
        description,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `安装失败: ${error.message}`, data: null })
  }
})

function normalizeModelProviderRow(row = {}) {
  return {
    id: Number(row.id || 0),
    providerName: toText(row.provider_name || row.providerName),
    providerType: toText(row.provider_type || row.providerType || 'OpenAI'),
    enabled: row.enabled !== false,
    apiKey: toText(row.api_key || row.apiKey),
    apiBaseUrl: toText(row.api_base_url || row.apiBaseUrl),
    models: Array.isArray(row.models_json) ? row.models_json : [],
    fetchedModels: Array.isArray(row.fetched_models_json) ? row.fetched_models_json : [],
    updatedAt: row.updated_at || '',
  }
}

function deriveModelCapabilities(modelId = '') {
  const text = toText(modelId).toLowerCase()
  return {
    video: /(vision|video|vl|imagine|image)/.test(text),
    reasoning: /(reason|think|r1|o1|o3|deep|mini)/.test(text),
    tool: /(tool|function|coder|fast|mini|chat)/.test(text) || true,
  }
}

function deriveModelGroupName(modelId = '') {
  const text = toText(modelId).trim()
  if (!text) return 'Other'
  const slashIdx = text.indexOf('/')
  if (slashIdx > 0) return text.slice(0, slashIdx)
  const dashIdx = text.indexOf('-')
  if (dashIdx > 0) return text.slice(0, dashIdx)
  return text
}

async function replaceProviderModelRows(client, providerName = '', fetchedModels = []) {
  const normalizedProviderName = toText(providerName)
  if (!normalizedProviderName) return
  const items = Array.isArray(fetchedModels) ? fetchedModels : []
  await client.query(`DELETE FROM ${modelProviderModelTable} WHERE provider_name = $1`, [normalizedProviderName])
  if (!items.length) return
  const values = []
  const placeholders = []
  let index = 1
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {}
    const modelId = toText(item?.id)
    if (!modelId) continue
    const caps = deriveModelCapabilities(modelId)
    const groupName = deriveModelGroupName(modelId)
    const ownedBy = toText(item?.ownedBy || item?.owned_by)
    const objectType = toText(item?.object)
    placeholders.push(`($${index}, $${index + 1}, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5}, $${index + 6}, $${index + 7}, $${index + 8}, $${index + 9}, NOW())`)
    values.push(
      normalizedProviderName,
      modelId,
      groupName,
      caps.video,
      caps.reasoning,
      caps.tool,
      ownedBy,
      objectType,
      toText(item?.sourceType || 'saved'),
      i,
    )
    index += 10
  }
  if (!placeholders.length) return
  await client.query(
    `
    INSERT INTO ${modelProviderModelTable}
    (provider_name, model_id, group_name, capability_video, capability_reasoning, capability_tool, owned_by, object_type, source_type, sort_order, updated_at)
    VALUES ${placeholders.join(', ')}
    `,
    values,
  )
}

async function fetchProviderModelCatalog(apiBaseUrl = '', apiKey = '') {
  const base = toText(apiBaseUrl).replace(/\/+$/, '')
  if (!base) throw new Error('缺少 API 地址')
  if (!toText(apiKey)) throw new Error('缺少 API 密钥')
  const response = await fetchByNetworkPolicy(`${base}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${toText(apiKey)}`,
      'Content-Type': 'application/json',
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(toText(payload?.error?.message || payload?.message || `HTTP ${response.status}`))
  }
  const list = Array.isArray(payload?.data) ? payload.data : []
  return list
    .map((item) => ({
      id: toText(item?.id),
      ownedBy: toText(item?.owned_by || item?.ownedBy),
      object: toText(item?.object),
    }))
    .filter((item) => item.id)
}

app.get('/api/model-providers', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM ${modelProviderTable} ORDER BY provider_name ASC`)
    return res.json({
      code: 200,
      message: 'success',
      data: (result.rows || []).map(normalizeModelProviderRow),
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取模型配置失败: ${error.message}`, data: [] })
  }
})

app.post('/api/model-providers', authMiddleware, async (req, res) => {
  const providerName = toText(req.body?.providerName)
  if (!providerName) return res.status(400).json({ code: 400, message: '缺少 providerName', data: null })
  const providerType = toText(req.body?.providerType || 'OpenAI')
  const enabled = req.body?.enabled !== false
  const apiKey = toText(req.body?.apiKey)
  const apiBaseUrl = toText(req.body?.apiBaseUrl)
  try {
    const result = await pool.query(
      `
      INSERT INTO ${modelProviderTable}
      (provider_name, provider_type, enabled, api_key, api_base_url, models_json, fetched_models_json, updated_at)
      VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, '[]'::jsonb, NOW())
      RETURNING *
      `,
      [providerName, providerType, enabled, apiKey, apiBaseUrl],
    )
    return res.json({ code: 200, message: 'created', data: normalizeModelProviderRow(result.rows?.[0] || {}) })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `新增模型供应商失败: ${error.message}`, data: null })
  }
})

app.put('/api/model-providers/:providerName', authMiddleware, async (req, res) => {
  const providerName = toText(req.params?.providerName)
  if (!providerName) return res.status(400).json({ code: 400, message: '缺少 providerName', data: null })
  const providerType = toText(req.body?.providerType || 'OpenAI')
  const enabled = req.body?.enabled !== false
  const apiKey = toText(req.body?.apiKey)
  const apiBaseUrl = toText(req.body?.apiBaseUrl)
  const models = Array.isArray(req.body?.models) ? req.body.models : []
  const fetchedModels = Array.isArray(req.body?.fetchedModels) ? req.body.fetchedModels : []
  const normalizedFetchedModels = fetchedModels
    .map((item) => ({
      id: toText(item?.id),
      ownedBy: toText(item?.ownedBy || item?.owned_by),
      object: toText(item?.object),
      sourceType: toText(item?.sourceType || 'saved'),
    }))
    .filter((item) => item.id)
  try {
    const client = await pool.connect()
    let result
    try {
      await client.query('BEGIN')
      result = await client.query(
        `
        INSERT INTO ${modelProviderTable}
        (provider_name, provider_type, enabled, api_key, api_base_url, models_json, fetched_models_json, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())
        ON CONFLICT (provider_name) DO UPDATE
        SET provider_type = EXCLUDED.provider_type,
            enabled = EXCLUDED.enabled,
            api_key = EXCLUDED.api_key,
            api_base_url = EXCLUDED.api_base_url,
            models_json = EXCLUDED.models_json,
            fetched_models_json = EXCLUDED.fetched_models_json,
            updated_at = NOW()
        RETURNING *
        `,
        [providerName, providerType, enabled, apiKey, apiBaseUrl, JSON.stringify(models), JSON.stringify(normalizedFetchedModels)],
      )
      await replaceProviderModelRows(client, providerName, normalizedFetchedModels)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return res.json({ code: 200, message: 'updated', data: normalizeModelProviderRow(result.rows[0] || {}) })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `保存模型配置失败: ${error.message}`, data: null })
  }
})

app.patch('/api/model-providers/:providerName/rename', authMiddleware, async (req, res) => {
  const providerName = toText(req.params?.providerName)
  const nextProviderName = toText(req.body?.providerName)
  const nextProviderType = toText(req.body?.providerType || '')
  if (!providerName) return res.status(400).json({ code: 400, message: '缺少 providerName', data: null })
  if (!nextProviderName) return res.status(400).json({ code: 400, message: '缺少新供应商名称', data: null })
  try {
    let updated
    if (nextProviderType) {
      updated = await pool.query(
        `
        UPDATE ${modelProviderTable}
        SET provider_name = $2, provider_type = $3, updated_at = NOW()
        WHERE provider_name = $1
        RETURNING *
        `,
        [providerName, nextProviderName, nextProviderType],
      )
    } else {
      updated = await pool.query(
        `
        UPDATE ${modelProviderTable}
        SET provider_name = $2, updated_at = NOW()
        WHERE provider_name = $1
        RETURNING *
        `,
        [providerName, nextProviderName],
      )
    }
    if (!updated.rows?.[0]) {
      return res.status(404).json({ code: 404, message: '模型供应商不存在', data: null })
    }
    return res.json({ code: 200, message: 'renamed', data: normalizeModelProviderRow(updated.rows[0]) })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `重命名失败: ${error.message}`, data: null })
  }
})

app.post('/api/model-providers/:providerName/test', authMiddleware, async (req, res) => {
  const providerName = toText(req.params?.providerName)
  if (!providerName) return res.status(400).json({ code: 400, message: '缺少 providerName', data: null })
  try {
    const row = await pool.query(
      `SELECT * FROM ${modelProviderTable} WHERE provider_name = $1 LIMIT 1`,
      [providerName],
    )
    const item = normalizeModelProviderRow(row.rows?.[0] || {})
    if (!item.providerName) return res.status(404).json({ code: 404, message: '模型供应商不存在', data: null })
    const overrideApiKey = toText(req.body?.apiKey)
    const overrideApiBaseUrl = toText(req.body?.apiBaseUrl)
    const testApiKey = overrideApiKey || item.apiKey
    const testApiBaseUrl = overrideApiBaseUrl || item.apiBaseUrl
    const models = await fetchProviderModelCatalog(testApiBaseUrl, testApiKey)
    return res.json({ code: 200, message: 'ok', data: { ok: true, count: models.length } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `连接检测失败: ${error.message}`, data: { ok: false } })
  }
})

app.post('/api/model-providers/:providerName/fetch-models', authMiddleware, async (req, res) => {
  const providerName = toText(req.params?.providerName)
  if (!providerName) return res.status(400).json({ code: 400, message: '缺少 providerName', data: null })
  try {
    const row = await pool.query(
      `SELECT * FROM ${modelProviderTable} WHERE provider_name = $1 LIMIT 1`,
      [providerName],
    )
    const item = normalizeModelProviderRow(row.rows?.[0] || {})
    if (!item.providerName) return res.status(404).json({ code: 404, message: '模型供应商不存在', data: null })
    const models = await fetchProviderModelCatalog(item.apiBaseUrl, item.apiKey)
    const client = await pool.connect()
    let saved
    try {
      await client.query('BEGIN')
      saved = await client.query(
        `
        UPDATE ${modelProviderTable}
        SET fetched_models_json = $2::jsonb, updated_at = NOW()
        WHERE provider_name = $1
        RETURNING *
        `,
        [providerName, JSON.stringify(models)],
      )
      await replaceProviderModelRows(client, providerName, models.map((item) => ({ ...item, sourceType: 'fetch' })))
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return res.json({
      code: 200,
      message: 'success',
      data: normalizeModelProviderRow(saved.rows?.[0] || {}),
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `获取模型列表失败: ${error.message}`, data: null })
  }
})

app.delete('/api/model-providers/:providerName', authMiddleware, async (req, res) => {
  const providerName = toText(req.params?.providerName)
  if (!providerName) return res.status(400).json({ code: 400, message: '缺少 providerName', data: null })
  try {
    await pool.query(`DELETE FROM ${modelProviderTable} WHERE provider_name = $1`, [providerName])
    return res.json({ code: 200, message: 'deleted', data: { providerName } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除模型供应商失败: ${error.message}`, data: null })
  }
})

const crawlEnvGuideSteps = [
  '确认后端服务已重启到最新版本，并可访问 /api/health。',
  '确认 web-access 服务已启动，且 CDP 连接可用。',
  '使用 Chrome 打开目标列表页并完成加载，再点击“检测环境”。',
]

function normalizeUrlForPrecheck(input = '') {
  const text = toText(input)
  if (!text) return ''
  try {
    const parsed = new URL(text)
    parsed.hash = ''
    if (parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '/')
    }
    return parsed.toString()
  } catch {
    return text
  }
}

function isSamePrecheckUrl(targetUrl = '', currentUrl = '') {
  const a = normalizeUrlForPrecheck(targetUrl)
  const b = normalizeUrlForPrecheck(currentUrl)
  if (!a || !b) return false
  if (a === b) return true
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.host === ub.host && ua.pathname === ub.pathname && ua.search === ub.search
  } catch {
    return false
  }
}

function normalizeCdpTargetsPayload(payload = null) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.value)) return payload.value
  return []
}

function getCdpTargetId(item = {}) {
  return toText(item?.targetId || item?.id)
}

async function buildWebAccessPrecheckResult(targetUrl = '') {
  try {
    const targetsPayload = await fetchCdpProxyJsonStrict('/targets', {}, 10000)
    const targets = normalizeCdpTargetsPayload(targetsPayload)
    const gasgooTargets = targets.filter((item) => safeHostFromUrl(item?.url || '').includes('gasgoo.com'))
    const normalizedTargetUrl = normalizeUrlForPrecheck(targetUrl)
    const targetMatched = normalizedTargetUrl
      ? targets.some((item) => isSamePrecheckUrl(normalizedTargetUrl, toText(item?.url)))
      : gasgooTargets.length > 0
    const matchedTarget = normalizedTargetUrl
      ? targets.find((item) => isSamePrecheckUrl(normalizedTargetUrl, toText(item?.url)))
      : (gasgooTargets[0] || null)
    let captchaDetected = false
    if (targetMatched && getCdpTargetId(matchedTarget)) {
      try {
        const evaluated = await fetchCdpProxyJson(
          `/eval?target=${encodeURIComponent(getCdpTargetId(matchedTarget))}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: `(() => {
              const html = String(document.documentElement?.outerHTML || '')
              const txt = String(document.body?.innerText || '')
              const hasCaptcha = /TencentCaptcha|TCaptcha\\.js|\\/WafCaptcha|请完成验证|captcha/i.test(html) || /请完成验证|验证码|captcha/i.test(txt)
              return {
                hasCaptcha,
                title: String(document.title || ''),
                readyState: String(document.readyState || ''),
              }
            })()`,
          },
          12000,
        )
        captchaDetected = evaluated?.value?.hasCaptcha === true
      } catch {
        captchaDetected = false
      }
    }
    const targetCheckMessage = normalizedTargetUrl
      ? (targetMatched
        ? `已检测到目标页标签：${normalizedTargetUrl}`
        : `未检测到目标页标签：${normalizedTargetUrl}`)
      : (gasgooTargets.length > 0
        ? ('检测到 Gasgoo 标签页 ' + String(gasgooTargets.length) + ' 个')
        : '未检测到 Gasgoo 标签页')
    const ready = targets.length > 0 && targetMatched && !captchaDetected
    return {
      ready,
      checks: [
        { name: 'web-access-proxy', ready: true, message: `web-access 服务可用（${cdpProxyBaseUrl}）` },
        { name: 'web-access-cdp', ready: true, message: 'CDP 服务可用（可见标签页 ' + String(targets.length) + ' 个）' },
        { name: 'target-tab', ready: targetMatched, message: targetCheckMessage },
        { name: 'captcha-state', ready: !captchaDetected, message: captchaDetected ? '目标页仍是验证码页面，请先在该页完成验证' : '目标页未检测到验证码拦截' },
      ],
      steps: [],
      hint: ready ? '' : (normalizedTargetUrl
        ? (captchaDetected
          ? '目标页仍是验证码页面，请先在 web-access 浏览器完成验证后再抓取。'
          : '未检测到当前节点对应目标页，请先点击“执行”自动打开目标页，或手工打开后再检测。')
        : '未检测到可用目标页，请先在 web-access 浏览器打开目标页后再检测。'),
    }
  } catch (error) {
    return {
      ready: false,
      checks: [
        {
          name: 'web-access-proxy',
          ready: false,
          message: 'web-access 服务不可用：' + toText(error?.message || 'unknown error'),
        },
        {
          name: 'web-access-cdp',
          ready: false,
          message: 'CDP 环境未就绪（web-access 服务不可用）',
        },
      ],
      steps: [],
      hint: '请先启动 web-access 服务并完成页面加载，再执行抓取。',
    }
  }
}

function escapePowerShellSingleQuotedText(input = '') {
  return String(input || '').replace(/'/g, "''")
}

async function fetchCdpProxyJsonStrict(endpoint = '', init = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 15000)))
  try {
    const response = await fetchByNetworkPolicy(`${cdpProxyBaseUrl}${endpoint}`, {
      ...init,
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`CDP proxy HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function isWebAccessProxyReady(timeoutMs = 2500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(800, Number(timeoutMs || 2500)))
  try {
    const response = await fetchByNetworkPolicy(`${cdpProxyBaseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) return false
    const payload = await response.json().catch(() => ({}))
    return toText(payload?.status) === 'ok'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function summarizeExecError(error) {
  const baseMessage = toText(error?.message || 'unknown error')
  const stdoutText = toText(error?.stdout || '').trim()
  const stderrText = toText(error?.stderr || '').trim()
  const details = [stderrText, stdoutText].filter(Boolean)
  const detailText = details
    .map((item) => item.split(/\r?\n/g).filter(Boolean).slice(0, 4).join(' | '))
    .filter(Boolean)
    .join(' || ')
  if (!detailText) return baseMessage
  return `${baseMessage} | ${detailText}`.slice(0, 600)
}

function isChromeRemoteDebugNotReadyError(errorLike = '') {
  const text = toText(errorLike).toLowerCase()
  if (!text) return false
  return /chrome:\s*not connected|allow remote debugging|remote-debugging|chrome 未开启远程调试端口|连接超时，请检查 chrome 调试设置/.test(text)
}

async function openTargetUrlInWebAccessCdp(targetUrl = '') {
  const normalized = toText(targetUrl)
  if (!normalized) return null
  try {
    const targetsPayload = await fetchCdpProxyJsonStrict('/targets', {}, 8000)
    const targets = normalizeCdpTargetsPayload(targetsPayload)
    const sameTarget = targets.find((item) => isSamePrecheckUrl(normalized, toText(item?.url)))
    if (sameTarget) {
      return {
        targetId: getCdpTargetId(sameTarget),
        reused: true,
      }
    }

    const reusableTarget = targets.find((item) => {
      const host = safeHostFromUrl(item?.url || '')
      return host.includes('gasgoo.com') && getCdpTargetId(item)
    })
    if (reusableTarget) {
      const reusableId = getCdpTargetId(reusableTarget)
      await fetchCdpProxyJsonStrict(
        `/navigate?target=${encodeURIComponent(reusableId)}&url=${encodeURIComponent(normalized)}`,
        {},
        10000,
      )
      return {
        targetId: reusableId,
        reused: true,
        navigated: true,
      }
    }
  } catch {
    // Ignore reuse errors and fallback to creating a new tab.
  }

  let lastError = null
  for (let i = 0; i < 8; i += 1) {
    try {
      const created = await fetchCdpProxyJsonStrict(`/new?url=${encodeURIComponent(normalized)}`, {}, 10000)
      return created
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
  }
  throw lastError || new Error('cdp open target failed')
}

async function waitForTargetTabVisible(targetUrl = '', timeoutMs = 10000) {
  const normalizedTargetUrl = normalizeUrlForPrecheck(targetUrl)
  if (!normalizedTargetUrl) return false
  const start = Date.now()
  while (Date.now() - start < Math.max(1000, Number(timeoutMs || 10000))) {
    try {
      const targetsPayload = await fetchCdpProxyJsonStrict('/targets', {}, 5000)
      const targets = normalizeCdpTargetsPayload(targetsPayload)
      if (targets.some((item) => isSamePrecheckUrl(normalizedTargetUrl, toText(item?.url)))) {
        return true
      }
    } catch {
      // ignore retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

async function runWebAccessAutoFix(targetUrl = '') {
  const actions = []
  const urlText = toText(targetUrl)
  if (urlText) {
    let openedByCdp = false
    try {
      await openTargetUrlInWebAccessCdp(urlText)
      const visible = await waitForTargetTabVisible(urlText, 8000)
      openedByCdp = visible
      actions.push({
        name: 'open-target-url',
        success: visible,
        message: visible
          ? ('已在 web-access 浏览器打开目标网页：' + urlText)
          : ('已发送打开指令，但未检测到目标页标签：' + urlText),
      })
    } catch (error) {
      actions.push({ name: 'open-target-url-cdp', success: false, message: '通过 CDP 打开目标网页失败：' + toText(error?.message || 'unknown error') })
    }
    if (openedByCdp) {
      return actions
    }
  }

  const startConfig = await resolveWebAccessStartConfig()
  if (startConfig?.command) {
    try {
      const startArgs = Array.isArray(startConfig.args) ? [...startConfig.args] : []
      if (startConfig.mode === 'project-script' && urlText) {
        startArgs.push('-TargetUrl', urlText)
      }
      await execFileAsync(startConfig.command, startArgs, {
        cwd: toText(startConfig.cwd) || process.cwd(),
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      })
      if (startConfig.mode === 'project-script') {
        actions.push({
          name: 'start-web-access',
          success: true,
          message: '已执行项目内 web-access 启动脚本（含旧进程检测）：' + toText(startConfig.scriptPath),
        })
      } else if (startConfig.mode === 'builtin') {
        actions.push({
          name: 'start-web-access',
          success: true,
          message: '已执行内置 web-access 启动脚本：' + toText(startConfig.scriptPath),
        })
      } else {
        const startScript = Array.isArray(startArgs)
          ? startArgs.find((item) => /start-web-access\.ps1$/i.test(toText(item)))
          : ''
        actions.push({
          name: 'start-web-access',
          success: true,
          message: startScript
            ? ('已执行启动命令（含旧进程检测）：' + toText(startScript))
            : ('已执行启动命令：' + startConfig.command),
        })
      }
    } catch (error) {
      const proxyReady = await isWebAccessProxyReady(3000)
      if (proxyReady) {
        actions.push({
          name: 'start-web-access',
          success: true,
          message: '启动命令返回异常，但 web-access 服务已就绪，继续执行后续步骤',
        })
      } else {
        const failureSummary = summarizeExecError(error)
        if (isChromeRemoteDebugNotReadyError(failureSummary)) {
          actions.push({
            name: 'start-web-access',
            success: false,
            message: 'Chrome 远程调试未就绪：请在 Chrome 打开 chrome://inspect/#remote-debugging 并勾选 Allow remote debugging，然后重试“执行”',
          })
        } else {
          actions.push({ name: 'start-web-access', success: false, message: '启动命令执行失败：' + failureSummary })
        }
      }
    }
  } else {
    actions.push({
      name: 'start-web-access',
      success: false,
      message: '未找到可用的 web-access 启动脚本；可配置 WEB_ACCESS_START_COMMAND，或安装/恢复 ~/.codex/skills/web-access',
    })
  }

  if (urlText) {
    try {
      await openTargetUrlInWebAccessCdp(urlText)
      const visible = await waitForTargetTabVisible(urlText, 10000)
      actions.push({
        name: 'open-target-url-after-start',
        success: visible,
        message: visible
          ? ('启动后已在 web-access 浏览器打开目标网页：' + urlText)
          : ('启动后已发送打开指令，但仍未检测到目标页标签：' + urlText),
      })
      return actions
    } catch (error) {
      actions.push({ name: 'open-target-url-after-start', success: false, message: '启动后仍无法通过 CDP 打开目标网页：' + toText(error?.message || 'unknown error') })
    }
  }

  return actions
}

app.get('/api/crawl/precheck', authMiddleware, async (req, res) => {
  const skill = toText(req.query.skill).toLowerCase()
  const targetUrl = toText(req.query.targetUrl)
  if (!isWebAccessSkill(skill)) {
    return res.json({
      code: 200,
      message: 'success',
      data: {
        skill,
        ready: true,
        checks: [{ name: 'skill', ready: true, message: '当前技能无需 web-access 环境预检' }],
        steps: [],
        hint: '',
      },
    })
  }
  const result = await buildWebAccessPrecheckResult(targetUrl)
  return res.json({
    code: 200,
    message: 'success',
    data: {
      skill: 'web-access',
      ...result,
    },
  })
})

app.post('/api/crawl/precheck/execute', authMiddleware, async (req, res) => {
  const skill = toText(req.body?.skill || req.query?.skill).toLowerCase()
  const targetUrl = toText(req.body?.targetUrl || req.query?.targetUrl)
  if (!isWebAccessSkill(skill)) {
    return res.json({
      code: 200,
      message: 'success',
      data: {
        skill,
        actions: [],
        precheck: {
          ready: true,
          checks: [{ name: 'skill', ready: true, message: '当前技能无需执行环境修复' }],
          steps: [],
          hint: '',
        },
      },
    })
  }
  const actions = await runWebAccessAutoFix(targetUrl)
  const precheck = await buildWebAccessPrecheckResult(targetUrl)
  return res.json({
    code: 200,
    message: 'success',
    data: {
      skill: 'web-access',
      actions,
      precheck,
    },
  })
})

app.get('/api/inventories', authMiddleware, async (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize || 10), 1), 100)
  const offset = (page - 1) * pageSize
  const keyword = String(req.query.keyword || '').trim()
  const status = String(req.query.status || '').trim()

  const filters = []
  const params = []
  if (keyword) {
    params.push(`%${keyword}%`)
    filters.push(`(asset_code ILIKE $${params.length} OR asset_name ILIKE $${params.length} OR owner ILIKE $${params.length})`)
  }
  if (status) {
    params.push(status)
    filters.push(`status = $${params.length}`)
  }
  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  try {
    const countSql = `SELECT COUNT(*)::int AS total FROM ${inventoryTable} ${whereSql}`
    const countResult = await pool.query(countSql, params)
    const total = countResult.rows[0]?.total ?? 0

    params.push(pageSize, offset)
    const listSql = `
      SELECT
        id,
        asset_code AS "assetCode",
        asset_name AS "assetName",
        department,
        owner,
        status,
        location,
        TO_CHAR(check_date, 'YYYY-MM-DD') AS "checkDate",
        COALESCE(remark, '') AS remark,
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI') AS "updateTime"
      FROM ${inventoryTable}
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `
    const listResult = await pool.query(listSql, params)
    return res.json({
      code: 200,
      message: 'success',
      data: listResult.rows,
      page,
      pageSize,
      total,
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询失败: ${error.message}`, data: null })
  }
})

app.get('/api/inventories/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效的资产记录 ID', data: null })
  }

  try {
    const sql = `
      SELECT
        id,
        asset_code AS "assetCode",
        asset_name AS "assetName",
        department,
        owner,
        status,
        location,
        TO_CHAR(check_date, 'YYYY-MM-DD') AS "checkDate",
        COALESCE(remark, '') AS remark,
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI') AS "updateTime"
      FROM ${inventoryTable}
      WHERE id = $1
      LIMIT 1
    `
    const result = await pool.query(sql, [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '资产记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/inventories', authMiddleware, async (req, res) => {
  const { assetCode, assetName, department, owner, status, location, checkDate, remark = '' } = req.body
  if (!assetCode || !assetName || !department || !owner || !status || !location || !checkDate) {
    return res.status(400).json({ code: 400, message: '缺少必填字段', data: null })
  }

  try {
    const sql = `
      INSERT INTO ${inventoryTable} (
        asset_code, asset_name, department, owner, status, location, check_date, remark, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      RETURNING
        id,
        asset_code AS "assetCode",
        asset_name AS "assetName",
        department,
        owner,
        status,
        location,
        TO_CHAR(check_date, 'YYYY-MM-DD') AS "checkDate",
        COALESCE(remark, '') AS remark,
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI') AS "updateTime"
    `
    const values = [assetCode, assetName, department, owner, status, location, checkDate, remark]
    const result = await pool.query(sql, values)
    return res.status(201).json({ code: 201, message: 'created', data: result.rows[0] })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ code: 409, message: '资产编码已存在', data: null })
    }
    return res.status(500).json({ code: 500, message: `提交失败: ${error.message}`, data: null })
  }
})

app.put('/api/inventories/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效的资产记录 ID', data: null })
  }

  const { assetCode, assetName, department, owner, status, location, checkDate, remark = '' } = req.body
  if (!assetCode || !assetName || !department || !owner || !status || !location || !checkDate) {
    return res.status(400).json({ code: 400, message: '缺少必填字段', data: null })
  }

  try {
    const sql = `
      UPDATE ${inventoryTable}
      SET
        asset_code = $1,
        asset_name = $2,
        department = $3,
        owner = $4,
        status = $5,
        location = $6,
        check_date = $7,
        remark = $8,
        updated_at = NOW()
      WHERE id = $9
      RETURNING
        id,
        asset_code AS "assetCode",
        asset_name AS "assetName",
        department,
        owner,
        status,
        location,
        TO_CHAR(check_date, 'YYYY-MM-DD') AS "checkDate",
        COALESCE(remark, '') AS remark,
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI') AS "updateTime"
    `
    const values = [assetCode, assetName, department, owner, status, location, checkDate, remark, id]
    const result = await pool.query(sql, values)
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '资产记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: result.rows[0] })
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ code: 409, message: '资产编码已存在', data: null })
    }
    return res.status(500).json({ code: 500, message: `更新失败: ${error.message}`, data: null })
  }
})

app.delete('/api/inventories/batch', authMiddleware, async (req, res) => {
  const inputIds = Array.isArray(req.body?.ids) ? req.body.ids : []
  const ids = inputIds
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)

  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效的 ids 数组', data: null })
  }

  try {
    const sql = `DELETE FROM ${inventoryTable} WHERE id = ANY($1::bigint[]) RETURNING id`
    const result = await pool.query(sql, [ids])
    return res.json({
      code: 200,
      message: 'deleted',
      data: {
        deletedCount: result.rowCount || 0,
        deletedIds: result.rows.map((row) => row.id),
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `批量删除失败: ${error.message}`, data: null })
  }
})

app.delete('/api/inventories/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效的资产记录 ID', data: null })
  }

  try {
    const sql = `DELETE FROM ${inventoryTable} WHERE id = $1 RETURNING id`
    const result = await pool.query(sql, [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '资产记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除失败: ${error.message}`, data: null })
  }
})

app.get('/api/sessions/recent', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 20)
  try {
    const sql = `
      SELECT
        s.id,
        s.title,
        s.pinned,
        s.owner,
        TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(s.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt",
        COALESCE(msg.message_count, 0) AS "messageCount",
        COALESCE(msg.latest_question, '') AS "latestQuestion"
      FROM ${chatSessionTable} s
      LEFT JOIN (
        SELECT
          session_id,
          COUNT(*)::int AS message_count,
          MAX(CASE WHEN role = 'user' THEN content ELSE '' END) AS latest_question
        FROM ${chatMessageTable}
        GROUP BY session_id
      ) msg ON msg.session_id = s.id
      ORDER BY s.pinned DESC, s.updated_at DESC
      LIMIT $1
    `
    const result = await pool.query(sql, [limit])
    return res.json({ code: 200, message: 'success', data: result.rows.map(normalizeSessionRow) })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询最近会话失败: ${error.message}`, data: null })
  }
})

app.get('/api/sessions', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const offset = Math.max(Number(req.query.offset || 0), 0)
  try {
    const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM ${chatSessionTable}`)
    const sql = `
      SELECT
        s.id,
        s.title,
        s.pinned,
        s.owner,
        TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(s.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt",
        COALESCE(msg.message_count, 0) AS "messageCount",
        COALESCE(msg.latest_question, '') AS "latestQuestion"
      FROM ${chatSessionTable} s
      LEFT JOIN (
        SELECT
          session_id,
          COUNT(*)::int AS message_count,
          MAX(CASE WHEN role = 'user' THEN content ELSE '' END) AS latest_question
        FROM ${chatMessageTable}
        GROUP BY session_id
      ) msg ON msg.session_id = s.id
      ORDER BY s.pinned DESC, s.updated_at DESC
      LIMIT $1 OFFSET $2
    `
    const rows = await pool.query(sql, [limit, offset])
    return res.json({
      code: 200,
      message: 'success',
      data: {
        total: Number(totalRes.rows[0]?.total || 0),
        list: rows.rows.map(normalizeSessionRow),
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询会话列表失败: ${error.message}`, data: null })
  }
})

app.post('/api/sessions', authMiddleware, async (req, res) => {
  const firstPrompt = toText(req.body?.firstPrompt)
  const selectedTags = Array.isArray(req.body?.selectedTags) ? req.body.selectedTags : []
  const title = toText(req.body?.title) || buildSessionTitleByPrompt(firstPrompt)
  try {
    const created = await pool.query(
      `
      INSERT INTO ${chatSessionTable} (title, owner, meta)
      VALUES ($1, $2, $3::jsonb)
      RETURNING
        id,
        title,
        pinned,
        owner,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      `,
      [title, req.authUser?.userName || req.authUser?.username || 'unknown', JSON.stringify({ selectedTags })],
    )
    return res.json({
      code: 200,
      message: 'created',
      data: normalizeSessionRow({ ...created.rows[0], messageCount: 0, latestQuestion: '' }),
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `创建会话失败: ${error.message}`, data: null })
  }
})

app.get('/api/sessions/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效会话ID', data: null })
  }
  try {
    const sessionRes = await pool.query(
      `
      SELECT
        id,
        title,
        pinned,
        owner,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${chatSessionTable}
      WHERE id = $1
      `,
      [id],
    )
    if (sessionRes.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '会话不存在', data: null })
    }
    const msgRes = await pool.query(
      `
      SELECT
        id,
        role,
        content,
        meta,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
      FROM ${chatMessageTable}
      WHERE session_id = $1
      ORDER BY id ASC
      `,
      [id],
    )
    return res.json({
      code: 200,
      message: 'success',
      data: {
        ...normalizeSessionRow({ ...sessionRes.rows[0], messageCount: msgRes.rowCount, latestQuestion: '' }),
        messages: msgRes.rows.map((row) => ({
          id: String(row.id),
          role: row.role,
          content: row.content,
          meta: row.meta || {},
          createdAt: row.createdAt,
        })),
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询会话详情失败: ${error.message}`, data: null })
  }
})

app.patch('/api/sessions/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效会话ID', data: null })
  }
  const payload = req.body || {}
  const setClauses = []
  const params = []
  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    params.push(toText(payload.title) || '未命名会话')
    setClauses.push(`title = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'pinned')) {
    params.push(Boolean(payload.pinned))
    setClauses.push(`pinned = $${params.length}`)
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可更新字段', data: null })
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  try {
    const updated = await pool.query(
      `
      UPDATE ${chatSessionTable}
      SET ${setClauses.join(', ')}
      WHERE id = $${params.length}
      RETURNING
        id,
        title,
        pinned,
        owner,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      `,
      params,
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '会话不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: normalizeSessionRow(updated.rows[0]) })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新会话失败: ${error.message}`, data: null })
  }
})

app.delete('/api/sessions/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效会话ID', data: null })
  }
  try {
    const deleted = await pool.query(`DELETE FROM ${chatSessionTable} WHERE id = $1 RETURNING id`, [id])
    if (deleted.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '会话不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除会话失败: ${error.message}`, data: null })
  }
})

app.post('/api/sessions/:id/message', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效会话ID', data: null })
  }
  const content = toText(req.body?.content)
  const selectedTags = Array.isArray(req.body?.selectedTags) ? req.body.selectedTags : []
  if (!content) {
    return res.status(400).json({ code: 400, message: '消息不能为空', data: null })
  }
  try {
    const existed = await pool.query(`SELECT id FROM ${chatSessionTable} WHERE id = $1 LIMIT 1`, [id])
    if (existed.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '会话不存在', data: null })
    }
    if (shouldAutoTriggerCrawl(content, selectedTags)) {
      const result = await executePromptCrawl({ prompt: content, selectedTags, sessionId: id })
      return res.json({
        code: 200,
        message: 'crawl_done',
        data: result,
      })
    }
    const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
    const tagMap = parseTagMap(selectedTags)
    const runLogs = [
      `${nowText()} | 接收输入：${content.slice(0, 60)}${content.length > 60 ? '...' : ''}`,
      `${nowText()} | 语义理解：识别为普通会话问答`,
      `${nowText()} | 生成回答：模型 ${tagMap.model || 'gpt-5.4'}，技能 ${tagMap.skill || '通用对话'}`,
    ]
    const answer = (() => {
      if (/什么模型|哪个模型|用了什么模型/.test(content)) {
        return `当前会话默认模型是 ${tagMap.model || 'gpt-5.4'}。如果你想切换，我可以按你选择的模型继续。`
      }
      if (/你好|在吗|hello|hi/i.test(content)) {
        return '你好，我在。你可以直接告诉我目标，我会先理解语义再决定是否需要爬取或调用其他能力。'
      }
      return `我已理解你的问题：${content.slice(0, 120)}。这是普通会话内容，不会自动触发爬虫。需要我继续给出详细方案或直接执行吗？`
    })()

    await saveSessionMessage(id, 'user', content, {
      type: 'question',
      selectedTags,
    })
    await saveSessionMessage(id, 'assistant', answer, {
      type: 'chat_result',
      runLogs,
      answer,
      model: tagMap.model || 'gpt-5.4',
    })
    return res.json({
      code: 200,
      message: 'chat_done',
      data: {
        runLogs,
        answer,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `普通会话执行失败: ${error.message}`, data: null })
  }
})

app.get('/api/crawl-tasks', authMiddleware, async (req, res) => {
  const keyword = String(req.query.keyword || '').trim()
  const status = String(req.query.status || '').trim()
  const filters = []
  const params = []
  if (keyword) {
    params.push(`%${keyword}%`)
    filters.push(`(task_name ILIKE $${params.length} OR nl_command ILIKE $${params.length})`)
  }
  if (status) {
    params.push(status)
    filters.push(`status = $${params.length}`)
  }
  const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''

  try {
    const sql = `
      SELECT
        id,
        task_name AS "taskName",
        nl_command AS "nlCommand",
        mode,
        frequency,
        parse_status AS "parseStatus",
        parse_confidence AS "parseConfidence",
        compliance_passed AS "compliancePassed",
        status,
        retry_count AS "retryCount",
        max_retry AS "maxRetry",
        records_collected AS "recordsCollected",
        success_rate AS "successRate",
        dirty_rate AS "dirtyRate",
        error_message AS "errorMessage",
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt",
        TO_CHAR(started_at, 'YYYY-MM-DD HH24:MI:SS') AS "startedAt",
        TO_CHAR(ended_at, 'YYYY-MM-DD HH24:MI:SS') AS "endedAt"
      FROM ${crawlTaskTable}
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT 200
    `
    const result = await pool.query(sql, params)
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询爬取任务失败: ${error.message}`, data: null })
  }
})

app.post('/api/crawl-tasks', authMiddleware, async (req, res) => {
  const {
    taskName = '',
    nlCommand = '',
    sourceUrls = [],
    fieldMapping = {},
    filterRules = {},
    mode = 'incremental',
    frequency = 'day',
    requestIntervalMs = 1200,
  } = req.body || {}

  const nlParsed = nlCommand ? parseNaturalCommand(nlCommand) : null
  if (nlCommand && nlParsed?.parseStatus === 'failed') {
    return res.status(400).json({ code: 400, message: nlParsed.reason || '自然语言指令解析失败', data: null })
  }

  const finalTaskName = String(taskName || nlParsed?.taskName || '').trim()
  if (!finalTaskName) {
    return res.status(400).json({ code: 400, message: '任务名称不能为空', data: null })
  }
  const finalMode = ['full', 'incremental'].includes(mode) ? mode : nlParsed?.mode || 'incremental'
  const finalFrequency = ['day', 'week'].includes(frequency) ? frequency : nlParsed?.frequency || 'day'
  const finalSources = Array.isArray(sourceUrls) && sourceUrls.length > 0 ? sourceUrls : nlParsed?.sources || []
  const finalFilterRules = Object.keys(filterRules || {}).length > 0 ? filterRules : nlParsed?.filterRules || {}
  const compliance = complianceCheck(nlCommand, finalSources)

  try {
    const sql = `
      INSERT INTO ${crawlTaskTable}
      (
        task_name, nl_command, source_urls, field_mapping, filter_rules, mode, frequency,
        request_interval_ms, parse_status, parse_confidence, compliance_passed,
        status, created_by, updated_at
      )
      VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      RETURNING id
    `
    const createdBy = String(req.authUser?.username || req.authUser?.userName || 'system')
    const result = await pool.query(sql, [
      finalTaskName,
      nlCommand || '',
      JSON.stringify(finalSources),
      JSON.stringify(fieldMapping || {}),
      JSON.stringify(finalFilterRules || {}),
      finalMode,
      finalFrequency,
      Math.max(Number(requestIntervalMs || 1200), 500),
      nlParsed ? nlParsed.parseStatus : 'parsed',
      nlParsed ? nlParsed.parseConfidence : 0.9,
      compliance.passed,
      compliance.passed ? 'pending' : 'failed',
      createdBy,
    ])
    const taskId = result.rows[0].id
    await appendTaskLog(
      taskId,
      compliance.passed ? 'info' : 'error',
      compliance.passed ? '任务创建成功，待调度执行' : `任务创建但合规校验未通过: ${compliance.reason}`,
      1,
    )
    return res.status(201).json({
      code: 201,
      message: compliance.passed ? 'created' : 'created_with_compliance_warning',
      data: {
        id: taskId,
        taskName: finalTaskName,
        compliancePassed: compliance.passed,
        complianceReason: compliance.reason,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `创建任务失败: ${error.message}`, data: null })
  }
})

app.get('/api/crawl-tasks/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效任务ID', data: null })
  }
  try {
    const sql = `
      SELECT
        id,
        task_name AS "taskName",
        nl_command AS "nlCommand",
        source_urls AS "sourceUrls",
        field_mapping AS "fieldMapping",
        filter_rules AS "filterRules",
        mode,
        frequency,
        request_interval_ms AS "requestIntervalMs",
        parse_status AS "parseStatus",
        parse_confidence AS "parseConfidence",
        compliance_passed AS "compliancePassed",
        status,
        retry_count AS "retryCount",
        max_retry AS "maxRetry",
        records_collected AS "recordsCollected",
        success_rate AS "successRate",
        dirty_rate AS "dirtyRate",
        error_message AS "errorMessage",
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt",
        TO_CHAR(started_at, 'YYYY-MM-DD HH24:MI:SS') AS "startedAt",
        TO_CHAR(ended_at, 'YYYY-MM-DD HH24:MI:SS') AS "endedAt"
      FROM ${crawlTaskTable}
      WHERE id = $1
      LIMIT 1
    `
    const result = await pool.query(sql, [id])
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '任务不存在', data: null })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询任务详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/crawl-tasks/:id/start', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效任务ID', data: null })
  }
  try {
    const result = await simulateTaskExecution(id, 'start')
    if (!result.ok) {
      return res.status(result.code).json({ code: result.code, message: result.message, data: null })
    }
    return res.json({ code: 200, message: result.message, data: { id } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `任务执行失败: ${error.message}`, data: null })
  }
})

app.post('/api/crawl-tasks/:id/stop', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效任务ID', data: null })
  }
  try {
    const updated = await pool.query(
      `UPDATE ${crawlTaskTable}
       SET status='stopped', ended_at=NOW(), updated_at=NOW(), error_message='用户手动停止'
       WHERE id=$1
       RETURNING id`,
      [id],
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '任务不存在', data: null })
    }
    await appendTaskLog(id, 'warning', '任务已被用户手动停止', 1)
    return res.json({ code: 200, message: 'stopped', data: { id } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `停止任务失败: ${error.message}`, data: null })
  }
})

app.post('/api/crawl-tasks/:id/retry', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效任务ID', data: null })
  }
  try {
    const current = await pool.query(`SELECT retry_count AS "retryCount", max_retry AS "maxRetry" FROM ${crawlTaskTable} WHERE id=$1`, [id])
    if (current.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '任务不存在', data: null })
    }
    const row = current.rows[0]
    if (Number(row.retryCount) >= Number(row.maxRetry)) {
      return res.status(400).json({ code: 400, message: '已达到最大重试次数', data: null })
    }
    const result = await simulateTaskExecution(id, 'retry')
    if (!result.ok) {
      return res.status(result.code).json({ code: result.code, message: result.message, data: null })
    }
    return res.json({ code: 200, message: 'retry_triggered', data: { id } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `重跑失败: ${error.message}`, data: null })
  }
})

app.get('/api/crawl-tasks/:id/logs', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效任务ID', data: null })
  }
  try {
    const sql = `
      SELECT
        id,
        task_id AS "taskId",
        level,
        message,
        attempt,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt"
      FROM ${crawlLogTable}
      WHERE task_id = $1
      ORDER BY id DESC
      LIMIT 200
    `
    const result = await pool.query(sql, [id])
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询日志失败: ${error.message}`, data: null })
  }
})

app.get('/api/crawl-tasks/:id/quality-report', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效任务ID', data: null })
  }
  try {
    const sql = `
      SELECT
        task_id AS "taskId",
        total_count AS "totalCount",
        dirty_count AS "dirtyCount",
        duplicate_count AS "duplicateCount",
        required_missing_count AS "requiredMissingCount",
        quality_passed AS "qualityPassed",
        report_json AS "reportJson",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${crawlQualityTable}
      WHERE task_id = $1
      LIMIT 1
    `
    const result = await pool.query(sql, [id])
    if (result.rowCount === 0) {
      return res.json({
        code: 200,
        message: 'success',
        data: {
          taskId: id,
          totalCount: 0,
          dirtyCount: 0,
          duplicateCount: 0,
          requiredMissingCount: 0,
          qualityPassed: false,
          reportJson: { message: '暂无质量报告，请先执行任务' },
          updatedAt: null,
        },
      })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询质量报告失败: ${error.message}`, data: null })
  }
})

app.post('/api/crawl-execute', authMiddleware, async (req, res) => {
  const { prompt = '', selectedTags = [], sessionId = null } = req.body || {}
  try {
    const result = await executePromptCrawl({ prompt, selectedTags, sessionId })
    return res.json({
      code: 200,
      message: 'crawl_done',
      data: result,
    })
  } catch (error) {
    const status = /未在输入内容中识别到可爬取URL/.test(error.message || '') ? 400 : 500
    return res.status(status).json({ code: status, message: `执行爬取失败: ${error.message}`, data: null })
  }
})

app.post('/api/supply-chain/nodes/:id/supplier-crawl-tasks', authMiddleware, async (req, res) => {
  const nodeId = Number(req.params.id)
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    return res.status(400).json({ code: 400, message: '无效节点ID', data: null })
  }
  try {
    const nodeRes = await pool.query(
      `SELECT id, node_title AS "nodeTitle", COALESCE(NULLIF(node_url, ''), source_url) AS "nodeUrl", source_url AS "sourceUrl"
       FROM ${supplyChainNodeTable}
       WHERE id = $1
       LIMIT 1`,
      [nodeId],
    )
    if (nodeRes.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '节点不存在', data: null })
    }
    const node = nodeRes.rows[0]
    const urlsText = toText(req.body?.urlsText)
    const bodyUrls = Array.isArray(req.body?.urls) ? req.body.urls.join('\n') : ''
    const manualUrls = parseUrlText(urlsText || bodyUrls)

    // 默认把“当前节点 + 下级节点”的URL一起纳入任务，确保按节点逐个进入抓取供应商。
    const relatedNodes = await collectNodeUrlsForSupplierCrawl(nodeId)
    const treeUrls = relatedNodes
      .map((item) => toText(item.nodeUrl || item.sourceUrl))
      .filter((item) => isSupplierListUrl(item))

    const urls = [...new Set([
      ...manualUrls,
      ...treeUrls,
      toText(node.nodeUrl),
      toText(node.sourceUrl),
    ].filter((item) => isSupplierListUrl(item)))]

    if (urls.length === 0) {
      return res.status(400).json({ code: 400, message: '未识别到可抓取 URL', data: null })
    }
    const model = toText(req.body?.model) || codexModelOptions[0]
    const skill = toText(req.body?.skill) || supplierSkillOptions[0]
    const homepageOnly = normalizeSupplierHomepageOnly(req.body?.homepageOnly)
    const taskId = createSupplierTaskId()
    const task = {
      taskId,
      nodeId,
      nodeName: toText(req.body?.nodeName) || toText(node.nodeTitle),
      sourceUrl: toText(node.sourceUrl || node.nodeUrl),
      model,
      skill,
      homepageOnly,
      urls,
      status: 'pending',
      progress: 0,
      totalUrls: urls.length,
      processedUrls: 0,
      totalRows: 0,
      estimatedTotalRows: 0,
      successRows: 0,
      failedRows: 0,
      runLogs: [],
      errorMessage: '',
      fileName: '',
      filePath: '',
      downloadUrl: '',
      records: [],
      imported: false,
      importSummary: null,
      cancelRequested: false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    }
    supplierCrawlTaskStore.set(taskId, task)
    schedulePersistSupplierTaskStore()
    launchSupplierCrawlTask(task)
    return res.json({
      code: 200,
      message: 'created',
      data: {
        ...normalizeSupplierTask(task),
        resolvedUrls: urls,
        resolvedUrlCount: urls.length,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `创建任务失败: ${error.message}`, data: null })
  }
})

app.post('/api/suppliers/source-crawl-tasks', authMiddleware, async (req, res) => {
  try {
    const urlsText = toText(req.body?.urlsText)
    const bodyUrls = Array.isArray(req.body?.urls) ? req.body.urls.join('\n') : ''
    const urls = [...new Set(parseUrlText(urlsText || bodyUrls).filter((item) => isSupplierListUrl(item)))]
    if (urls.length === 0) {
      return res.status(400).json({ code: 400, message: '未识别到可抓取 URL', data: null })
    }
    const rawUrlNodeMeta = Array.isArray(req.body?.urlNodeMeta) ? req.body.urlNodeMeta : []
    const urlNodeMetaMap = {}
    for (const item of rawUrlNodeMeta) {
      const data = item && typeof item === 'object' ? item : {}
      const key = normalizeSupplierTaskUrlKey(data.url)
      if (!key) continue
      const parsedNodeId = data.nodeId === null || typeof data.nodeId === 'undefined' || data.nodeId === ''
        ? null
        : Number(data.nodeId)
      urlNodeMetaMap[key] = {
        nodeId: Number.isInteger(parsedNodeId) && parsedNodeId > 0 ? parsedNodeId : null,
        nodeName: toText(data.nodeName),
        sourceUrl: toText(data.sourceUrl),
      }
    }
    const model = toText(req.body?.model) || codexModelOptions[0]
    const skill = toText(req.body?.skill) || supplierSkillOptions[0]
    const crawlMode = String(req.body?.crawlMode || '').trim().toLowerCase() === 'list' ? 'list' : ''
    const homepageOnly = normalizeSupplierHomepageOnly(req.body?.homepageOnly)
    const allowPlaywrightDetail = normalizeSupplierAllowPlaywrightDetail(req.body?.allowPlaywrightDetail)
    const taskId = createSupplierTaskId()
    const task = {
      taskId,
      nodeId: null,
      nodeName: toText(req.body?.nodeName) || '',
      sourceUrl: '',
      urlNodeMetaMap,
      model,
      skill,
      crawlMode,
      homepageOnly,
      allowPlaywrightDetail,
      urls,
      status: 'pending',
      progress: 0,
      totalUrls: urls.length,
      processedUrls: 0,
      totalRows: 0,
      estimatedTotalRows: 0,
      successRows: 0,
      failedRows: 0,
      runLogs: [],
      errorMessage: '',
      fileName: '',
      filePath: '',
      downloadUrl: '',
      records: [],
      imported: false,
      importSummary: null,
      cancelRequested: false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    }
    supplierCrawlTaskStore.set(taskId, task)
    schedulePersistSupplierTaskStore()
    launchSupplierCrawlTask(task)
    return res.json({
      code: 200,
      message: 'created',
      data: {
        ...normalizeSupplierTask(task),
        resolvedUrls: urls,
        resolvedUrlCount: urls.length,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `创建任务失败: ${error.message}`, data: null })
  }
})

app.get('/api/supplier-crawl-tasks/:taskId', authMiddleware, (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = supplierCrawlTaskStore.get(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在', data: null })
  }
  return res.json({ code: 200, message: 'success', data: normalizeSupplierTask(task) })
})

app.post('/api/supplier-crawl-tasks/:taskId/cancel', authMiddleware, (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = supplierCrawlTaskStore.get(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在', data: null })
  }
  if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
    return res.json({ code: 200, message: 'already_finished', data: normalizeSupplierTask(task) })
  }
  task.cancelRequested = true
  task.status = 'cancelling'
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  task.runLogs.push(`${nowText()} | 收到取消指令，正在结束任务...`)
  schedulePersistSupplierTaskStore()
  return res.json({ code: 200, message: 'cancel_requested', data: normalizeSupplierTask(task) })
})

app.post('/api/supplier-crawl-tasks/:taskId/import', authMiddleware, async (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = supplierCrawlTaskStore.get(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在', data: null })
  }
  if (task.status !== 'done') {
    return res.status(400).json({ code: 400, message: '任务尚未完成，不能入库', data: null })
  }
  try {
    const includeProfile = req.body?.includeProfile === true || String(req.body?.includeProfile || '').toLowerCase() === 'true'
    const forcedProfileSource = normalizeSupplierProfileView(req.body?.profileSource)
    const importTarget = toText(req.body?.importTarget).toLowerCase()
    const resolvedImportTarget = importTarget || (forcedProfileSource === 'gas' ? 'gas-supplier' : '')
    let records = Array.isArray(task.records) ? task.records : []
    if (records.length === 0 && task.fileName) {
      const csvPath = path.join(crawlExportDir, path.basename(task.fileName))
      const csvText = await fs.readFile(csvPath, 'utf8')
      records = parseCsvObjects(csvText).map((item) => ({
        nodeId: toText(item.node_id) || task.nodeId,
        nodeName: toText(item.node_name) || task.nodeName,
        model: toText(item.model) || task.model,
        skill: toText(item.skill) || task.skill,
        sourceUrl: toText(item.source_url),
        listPageUrl: toText(item.list_page_url),
        detailUrl: toText(item.detail_url),
        supplierProfileUrl: toText(item.supplier_profile_url),
        companyName: toText(item.company_name),
        mainProducts: toText(item.main_products),
        fitExport: toText(item.fit_export),
        qualitySystem: toText(item.quality_system),
        region: toText(item.region),
        contactAction: toText(item.contact_action),
        website: toText(item.website),
        address: toText(item.address),
        companyIntro: toText(item.company_intro),
        fitSituation: toText(item.fit_situation),
        exportSituation: toText(item.export_situation),
        certificates: toText(item.certificates),
        companyType: toText(item.company_type),
        orgCode: toText(item.org_code),
        establishedDate: toText(item.established_date),
        registeredCapital: toText(item.registered_capital),
        employeesCount: toText(item.employees_count),
        legalRepresentative: toText(item.legal_representative),
        newsSummary: toText(item.news_summary),
        status: toText(item.status),
        errorMessage: toText(item.error_message),
      }))
    }
    const validRecords = records.filter((item) => toText(item.companyName))
    if (resolvedImportTarget === 'gas-supplier') {
      const gasSummary = await importGasSupplierRows(validRecords, task.fileName || '')
      const gasProfileSource = forcedProfileSource || 'gas'
      const profileRecords = validRecords.map((item) => ({ ...item, profileSource: gasProfileSource }))
      const profileSummary = includeProfile
        ? await importSupplierProfileRows(profileRecords)
        : { inserted: 0, updated: 0, skipped: true, affectedNodeIds: [] }
      const gasNodeIds = [
        ...new Set(validRecords.map((item) => Number(item.nodeId)).filter((item) => Number.isInteger(item) && item > 0)),
      ]
      const profileNodeIds = Array.isArray(profileSummary.affectedNodeIds)
        ? profileSummary.affectedNodeIds
        : []
      const gasSyncSummary = await refreshGasSupplyChainSyncedSupplierCounts([
        ...new Set([...gasNodeIds, ...profileNodeIds].map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)),
      ])
      const importSummary = {
        ...gasSummary,
        profileInserted: profileSummary.inserted || 0,
        profileUpdated: profileSummary.updated || 0,
        profileSkipped: Boolean(profileSummary.skipped),
        importedCompanies: [...new Set(validRecords.map((item) => sanitizeSupplierCompanyName(toText(item.companyName))).filter(Boolean))].length,
        profileSource: gasProfileSource,
        gasSyncedNodeCount: gasSyncSummary.updatedNodeCount || 0,
        gasSyncedSupplierTotal: gasSyncSummary.totalSuppliers || 0,
        gasSyncedNodeDetails: gasSyncSummary.nodeCounts || [],
      }
      task.imported = true
      task.importSummary = importSummary
      schedulePersistSupplierTaskStore()
      return res.json({ code: 200, message: 'imported', data: importSummary })
    }
    const profileRecords = forcedProfileSource
      ? validRecords.map((item) => ({ ...item, profileSource: forcedProfileSource }))
      : validRecords
    const baseSummary = await importSupplierBaseRows(validRecords, task.fileName || '')
    const profileSummary = includeProfile
      ? await importSupplierProfileRows(profileRecords)
      : { inserted: 0, updated: 0, skipped: true, affectedNodeIds: [] }
    const gasSyncSummary = includeProfile
      ? await refreshGasSupplyChainSyncedSupplierCounts(profileSummary.affectedNodeIds || [])
      : { updatedNodeCount: 0, totalSuppliers: 0, nodeCounts: [] }
    const importSummary = {
      ...baseSummary,
      profileInserted: profileSummary.inserted || 0,
      profileUpdated: profileSummary.updated || 0,
      profileSkipped: Boolean(profileSummary.skipped),
      importedCompanies: [...new Set(validRecords.map((item) => toText(item.companyName)).filter(Boolean))].length,
      profileSource: forcedProfileSource || '',
      gasSyncedNodeCount: gasSyncSummary.updatedNodeCount || 0,
      gasSyncedSupplierTotal: gasSyncSummary.totalSuppliers || 0,
      gasSyncedNodeDetails: gasSyncSummary.nodeCounts || [],
    }
    task.imported = true
    task.importSummary = importSummary
    schedulePersistSupplierTaskStore()
    return res.json({ code: 200, message: 'imported', data: importSummary })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `入库失败: ${error.message}`, data: null })
  }
})

app.get('/api/crawl-exports/:fileName', authMiddleware, async (req, res) => {
  const fileName = String(req.params.fileName || '')
  const safeName = path.basename(fileName)
  if (!safeName || safeName !== fileName) {
    return res.status(400).json({ code: 400, message: '非法文件名', data: null })
  }
  const absPath = path.join(crawlExportDir, safeName)
  try {
    await fs.access(absPath)
    return res.download(absPath)
  } catch {
    return res.status(404).json({ code: 404, message: 'CSV文件不存在', data: null })
  }
})

app.post('/api/supply-chain/import-csv', authMiddleware, async (req, res) => {
  const fileName = String(req.body?.fileName || '').trim()
  const csvText = String(req.body?.csvText || '')
  try {
    if (csvText) {
      const records = parseCsvObjects(csvText)
      const result = await importSupplyChainRecords(records, fileName || 'uploaded.csv')
      return res.json({ code: 200, message: 'imported', data: result })
    }
    if (!fileName) {
      return res.status(400).json({ code: 400, message: '请提供 fileName 或 csvText', data: null })
    }
    const result = await importSupplyChainCsv(fileName)
    return res.json({ code: 200, message: 'imported', data: result })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `导入CSV失败: ${error.message}`, data: null })
  }
})

app.delete('/api/supply-chain/clear-all', authMiddleware, async (_req, res) => {
  try {
    const deletedNodes = await pool.query(`DELETE FROM ${supplyChainNodeTable}`)
    return res.json({
      code: 200,
      message: 'cleared',
      data: { deletedCount: deletedNodes.rowCount || 0 },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `清空失败: ${error.message}`, data: null })
  }
})

app.get('/api/supply-chain/records', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000)
  const keyword = String(req.query.keyword || '').trim()
  const parentKeyword = String(req.query.parentKeyword || '').trim()
  const filters = []
  const params = []
  if (keyword) {
    params.push(`%${keyword}%`)
    filters.push(`(child.node_title ILIKE $${params.length} OR child.node_url ILIKE $${params.length} OR child.source_url ILIKE $${params.length})`)
  }
  if (parentKeyword) {
    params.push(`%${parentKeyword}%`)
    filters.push(`(CAST(child.parent_id AS TEXT) ILIKE $${params.length} OR COALESCE(parent.node_title, '') ILIKE $${params.length})`)
  }
  params.push(limit)
  const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
  try {
    const sql = `
      SELECT
        child.id,
        child.parent_id AS "parentId",
        child.node_title AS "nodeName",
        child.node_level AS "nodeLevel",
        COALESCE(NULLIF(child.node_url, ''), child.source_url) AS "sourceUrl",
        child.source_url AS "sourceSiteUrl",
        child.node_url AS "nodeUrl",
        parent.node_title AS "parentName",
        TO_CHAR(child.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${supplyChainNodeTable} child
      LEFT JOIN ${supplyChainNodeTable} parent ON parent.id = child.parent_id
      ${whereSql}
      ORDER BY child.node_level ASC, child.id ASC
      LIMIT $${params.length}
    `
    const result = await pool.query(sql, params)
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询供应链记录失败: ${error.message}`, data: null })
  }
})

app.get('/api/supply-chain/records/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const result = await pool.query(
      `
      SELECT
        child.id,
        child.parent_id AS "parentId",
        child.node_title AS "nodeName",
        child.node_level AS "nodeLevel",
        COALESCE(NULLIF(child.node_url, ''), child.source_url) AS "sourceUrl",
        child.source_url AS "sourceSiteUrl",
        child.node_url AS "nodeUrl",
        parent.node_title AS "parentName",
        TO_CHAR(child.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(child.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${supplyChainNodeTable} child
      LEFT JOIN ${supplyChainNodeTable} parent ON parent.id = child.parent_id
      WHERE child.id = $1
      LIMIT 1
      `,
      [id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/supply-chain/records', authMiddleware, async (req, res) => {
  const nodeName = toText(req.body?.nodeName)
  const parentId = req.body?.parentId ? Number(req.body.parentId) : null
  const nodeLevel = Number(req.body?.nodeLevel || 1)
  const sourceUrl = toText(req.body?.sourceUrl)
  if (!nodeName) {
    return res.status(400).json({ code: 400, message: '节点名称不能为空', data: null })
  }
  if (!Number.isInteger(nodeLevel) || nodeLevel < 1 || nodeLevel > 5) {
    return res.status(400).json({ code: 400, message: '节点层级仅支持 1-5 级', data: null })
  }
  try {
    const created = await pool.query(
      `
      INSERT INTO ${supplyChainNodeTable}
      (parent_id, node_level, node_title, source_url, node_url, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id
      `,
      [parentId, nodeLevel, nodeName, sourceUrl, sourceUrl],
    )
    return res.json({ code: 200, message: 'created', data: { id: String(created.rows[0].id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `新增失败: ${error.message}`, data: null })
  }
})

app.put('/api/supply-chain/records/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  const payload = req.body || {}
  const setClauses = []
  const params = []
  if (Object.prototype.hasOwnProperty.call(payload, 'nodeName')) {
    params.push(toText(payload.nodeName))
    setClauses.push(`node_title = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'parentId')) {
    params.push(payload.parentId ? Number(payload.parentId) : null)
    setClauses.push(`parent_id = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nodeLevel')) {
    params.push(Number(payload.nodeLevel))
    setClauses.push(`node_level = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sourceUrl')) {
    params.push(toText(payload.sourceUrl))
    setClauses.push(`source_url = $${params.length}`)
    params.push(toText(payload.sourceUrl))
    setClauses.push(`node_url = $${params.length}`)
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可更新字段', data: null })
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  try {
    const updated = await pool.query(
      `UPDATE ${supplyChainNodeTable} SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params,
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新失败: ${error.message}`, data: null })
  }
})

app.delete('/api/supply-chain/records/item/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const deleted = await pool.query(`DELETE FROM ${supplyChainNodeTable} WHERE id = $1 RETURNING id`, [id])
    if (deleted.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除失败: ${error.message}`, data: null })
  }
})

app.delete('/api/supply-chain/records/batch-delete', authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : []
  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效 ids', data: null })
  }
  try {
    const deleted = await pool.query(
      `DELETE FROM ${supplyChainNodeTable} WHERE id = ANY($1::bigint[]) RETURNING id`,
      [ids],
    )
    return res.json({
      code: 200,
      message: 'batch_deleted',
      data: { deletedCount: deleted.rowCount || 0 },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `批量删除失败: ${error.message}`, data: null })
  }
})

app.get('/api/suppliers', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000)
  const keyword = String(req.query.keyword || '').trim()
  const fuzzy = String(req.query.fuzzy ?? 'true') !== 'false'
  const nodeId = Number(req.query.nodeId || 0)
  const filters = []
  const params = []
  if (keyword) {
    const searchFields = [
      'company_name',
      'node_name',
      'main_products',
      'quality_system',
      'region',
      'list_page_url',
      'detail_url',
      'source_url',
    ]
    const rawTokens = keyword.split(/[\s,，。；;、|/]+/g).map((t) => t.trim()).filter(Boolean)
    const compactTokens = rawTokens.map((t) => t.replace(/[-_]/g, '')).filter(Boolean)
    const variants = fuzzy
      ? [...new Set([keyword, ...rawTokens, ...compactTokens])]
      : [keyword]
    const variantClauses = []
    for (const variant of variants) {
      params.push(`%${variant}%`)
      const p = `$${params.length}`
      variantClauses.push(`(${searchFields.map((field) => `${field} ILIKE ${p}`).join(' OR ')})`)
    }
    filters.push(`(${variantClauses.join(' OR ')})`)
  }
  if (Number.isInteger(nodeId) && nodeId > 0) {
    params.push(nodeId)
    filters.push(`node_id = $${params.length}`)
  }
  params.push(limit)
  const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
  try {
    const sql = `
      SELECT
        id,
        node_id AS "nodeId",
        node_name AS "nodeName",
        model,
        skill,
        company_name AS "companyName",
        TRIM(BOTH '；' FROM CONCAT_WS('；',
          NULLIF(main_products, ''),
          NULLIF(fit_export, ''),
          NULLIF(quality_system, ''),
          NULLIF(region, ''),
          NULLIF(contact_action, '')
        )) AS "remark",
        main_products AS "mainProducts",
        fit_export AS "fitExport",
        quality_system AS "qualitySystem",
        region,
        contact_action AS "contactAction",
        list_page_url AS "listPageUrl",
        detail_url AS "detailUrl",
        source_url AS "sourceUrl",
        source_file AS "sourceFile",
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${supplierBaseTable}
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length}
    `
    const result = await pool.query(sql, params)
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询供应商失败: ${error.message}`, data: null })
  }
})

app.get('/api/suppliers/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        node_id AS "nodeId",
        node_name AS "nodeName",
        model,
        skill,
        company_name AS "companyName",
        TRIM(BOTH '；' FROM CONCAT_WS('；',
          NULLIF(main_products, ''),
          NULLIF(fit_export, ''),
          NULLIF(quality_system, ''),
          NULLIF(region, ''),
          NULLIF(contact_action, '')
        )) AS "remark",
        main_products AS "mainProducts",
        fit_export AS "fitExport",
        quality_system AS "qualitySystem",
        region,
        contact_action AS "contactAction",
        list_page_url AS "listPageUrl",
        detail_url AS "detailUrl",
        source_url AS "sourceUrl",
        source_file AS "sourceFile",
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${supplierBaseTable}
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/suppliers', authMiddleware, async (req, res) => {
  const companyName = toText(req.body?.companyName)
  if (!companyName) {
    return res.status(400).json({ code: 400, message: '供应商名称不能为空', data: null })
  }
  const nodeIdRaw = req.body?.nodeId
  const nodeId = nodeIdRaw === null || nodeIdRaw === '' || typeof nodeIdRaw === 'undefined'
    ? null
    : Number(nodeIdRaw)
  if (nodeId !== null && (!Number.isInteger(nodeId) || nodeId <= 0)) {
    return res.status(400).json({ code: 400, message: 'nodeId 必须为正整数', data: null })
  }
  try {
    const remark = toText(req.body?.remark)
    const mainProducts = remark || toText(req.body?.mainProducts)
    const fitExport = remark ? '' : toText(req.body?.fitExport)
    const qualitySystem = remark ? '' : toText(req.body?.qualitySystem)
    const region = remark ? '' : toText(req.body?.region)
    const contactAction = remark ? '' : toText(req.body?.contactAction)
    const inserted = await pool.query(
      `
      INSERT INTO ${supplierBaseTable}
      (
        node_id, node_name, model, skill, company_name, main_products, fit_export, quality_system, region,
        contact_action, list_page_url, detail_url, source_url, source_file, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      RETURNING id
      `,
      [
        nodeId,
        toText(req.body?.nodeName),
        toText(req.body?.model),
        toText(req.body?.skill),
        companyName,
        mainProducts,
        fitExport,
        qualitySystem,
        region,
        contactAction,
        toText(req.body?.listPageUrl),
        toText(req.body?.detailUrl),
        toText(req.body?.sourceUrl),
        toText(req.body?.sourceFile),
      ],
    )
    return res.json({ code: 200, message: 'created', data: { id: String(inserted.rows[0].id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `新增供应商失败: ${error.message}`, data: null })
  }
})

app.put('/api/suppliers/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  const payload = req.body || {}
  const setClauses = []
  const params = []
  if (Object.prototype.hasOwnProperty.call(payload, 'remark')) {
    const remark = toText(payload.remark)
    params.push(remark)
    setClauses.push(`main_products = $${params.length}`)
    params.push('')
    setClauses.push(`fit_export = $${params.length}`)
    params.push('')
    setClauses.push(`quality_system = $${params.length}`)
    params.push('')
    setClauses.push(`region = $${params.length}`)
    params.push('')
    setClauses.push(`contact_action = $${params.length}`)
  }
  const textFieldMap = {
    nodeName: 'node_name',
    model: 'model',
    skill: 'skill',
    companyName: 'company_name',
    mainProducts: 'main_products',
    fitExport: 'fit_export',
    qualitySystem: 'quality_system',
    region: 'region',
    contactAction: 'contact_action',
    listPageUrl: 'list_page_url',
    detailUrl: 'detail_url',
    sourceUrl: 'source_url',
    sourceFile: 'source_file',
  }
  for (const [key, column] of Object.entries(textFieldMap)) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      params.push(toText(payload[key]))
      setClauses.push(`${column} = $${params.length}`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nodeId')) {
    const nodeIdRaw = payload.nodeId
    const parsed = nodeIdRaw === null || nodeIdRaw === '' || typeof nodeIdRaw === 'undefined'
      ? null
      : Number(nodeIdRaw)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed <= 0)) {
      return res.status(400).json({ code: 400, message: 'nodeId 必须为正整数', data: null })
    }
    params.push(parsed)
    setClauses.push(`node_id = $${params.length}`)
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可更新字段', data: null })
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  try {
    const updated = await pool.query(
      `UPDATE ${supplierBaseTable} SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params,
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新供应商失败: ${error.message}`, data: null })
  }
})

app.delete('/api/suppliers/item/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const deleted = await pool.query(`DELETE FROM ${supplierBaseTable} WHERE id = $1 RETURNING id`, [id])
    if (deleted.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除供应商失败: ${error.message}`, data: null })
  }
})

app.delete('/api/suppliers/batch-delete', authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : []
  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效 ids', data: null })
  }
  try {
    const deleted = await pool.query(
      `DELETE FROM ${supplierBaseTable} WHERE id = ANY($1::bigint[]) RETURNING id`,
      [ids],
    )
    return res.json({
      code: 200,
      message: 'batch_deleted',
      data: { deletedCount: deleted.rowCount || 0 },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `批量删除供应商失败: ${error.message}`, data: null })
  }
})

app.delete('/api/suppliers/clear-all', authMiddleware, async (_req, res) => {
  try {
    const deleted = await pool.query(`DELETE FROM ${supplierBaseTable} RETURNING id`)
    return res.json({
      code: 200,
      message: 'cleared',
      data: { deletedCount: deleted.rowCount || 0 },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `清空供应商信息来源失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-suppliers', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000)
  const keyword = toText(req.query.keyword)
  const nodeId = Number(req.query.nodeId || 0)
  const params = []
  const whereClauses = []
  if (Number.isInteger(nodeId) && nodeId > 0) {
    params.push(nodeId)
    whereClauses.push(`s.gas_node_id = $${params.length}`)
  }
  if (keyword) {
    params.push(`%${keyword}%`)
    whereClauses.push(`(
      s.company_name ILIKE $${params.length}
      OR s.gas_node_name ILIKE $${params.length}
      OR s.main_products ILIKE $${params.length}
      OR s.source_url ILIKE $${params.length}
      OR s.list_page_url ILIKE $${params.length}
      OR s.detail_url ILIKE $${params.length}
    )`)
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  params.push(limit)
  try {
    const result = await pool.query(
      `
      SELECT
        s.id,
        s.gas_node_id AS "gasNodeId",
        s.gas_node_name AS "gasNodeName",
        s.company_name AS "companyName",
        s.region AS "location",
        s.region,
        s.registered_capital AS "registeredCapital",
        s.established_date AS "establishedDate",
        s.main_products AS "mainProducts",
        s.detail_url AS "detailUrl",
        s.source_url AS "sourceUrl",
        s.list_page_url AS "listPageUrl",
        s.model,
        s.skill,
        TO_CHAR(s.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(s.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${gasSupplierTable} s
      ${whereSql}
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT $${params.length}
      `,
      params,
    )
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询GAS供应商失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-suppliers/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        gas_node_id AS "gasNodeId",
        gas_node_name AS "gasNodeName",
        company_name AS "companyName",
        region AS "location",
        region,
        registered_capital AS "registeredCapital",
        established_date AS "establishedDate",
        main_products AS "mainProducts",
        detail_url AS "detailUrl",
        source_url AS "sourceUrl",
        list_page_url AS "listPageUrl",
        model,
        skill,
        source_file AS "sourceFile",
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${gasSupplierTable}
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询GAS供应商详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/gas-suppliers', authMiddleware, async (req, res) => {
  const companyName = sanitizeSupplierCompanyName(toText(req.body?.companyName))
  if (!companyName) {
    return res.status(400).json({ code: 400, message: '供应商名称不能为空', data: null })
  }
  try {
    const inserted = await pool.query(
      `
      INSERT INTO ${gasSupplierTable}
        (gas_node_id, gas_node_name, company_name, region, registered_capital, established_date, main_products, detail_url, source_url, list_page_url, model, skill, source_file, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      RETURNING id
      `,
      [
        req.body?.gasNodeId ? Number(req.body.gasNodeId) : null,
        toText(req.body?.gasNodeName),
        companyName,
        toText(req.body?.location || req.body?.region),
        toText(req.body?.registeredCapital),
        toText(req.body?.establishedDate),
        toText(req.body?.mainProducts),
        toText(req.body?.detailUrl),
        toText(req.body?.sourceUrl),
        toText(req.body?.listPageUrl),
        toText(req.body?.model),
        toText(req.body?.skill),
        toText(req.body?.sourceFile),
      ],
    )
    return res.json({ code: 200, message: 'created', data: { id: String(inserted.rows[0].id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `新增GAS供应商失败: ${error.message}`, data: null })
  }
})

app.put('/api/gas-suppliers/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  const payload = req.body || {}
  const textFieldMap = {
    gasNodeName: 'gas_node_name',
    companyName: 'company_name',
    location: 'region',
    region: 'region',
    registeredCapital: 'registered_capital',
    establishedDate: 'established_date',
    mainProducts: 'main_products',
    detailUrl: 'detail_url',
    sourceUrl: 'source_url',
    listPageUrl: 'list_page_url',
    model: 'model',
    skill: 'skill',
    sourceFile: 'source_file',
  }
  const setClauses = []
  const params = []
  if (Object.prototype.hasOwnProperty.call(payload, 'gasNodeId')) {
    params.push(payload.gasNodeId ? Number(payload.gasNodeId) : null)
    setClauses.push(`gas_node_id = $${params.length}`)
  }
  for (const [key, column] of Object.entries(textFieldMap)) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
    const raw = toText(payload[key])
    params.push(key === 'companyName' ? sanitizeSupplierCompanyName(raw) : raw)
    setClauses.push(`${column} = $${params.length}`)
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可更新字段', data: null })
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  try {
    const updated = await pool.query(
      `UPDATE ${gasSupplierTable} SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params,
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新GAS供应商失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-suppliers/item/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const deleted = await pool.query(`DELETE FROM ${gasSupplierTable} WHERE id = $1 RETURNING id`, [id])
    if (deleted.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除GAS供应商失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-suppliers/batch-delete', authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : []
  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效 ids', data: null })
  }
  try {
    const deleted = await pool.query(
      `DELETE FROM ${gasSupplierTable} WHERE id = ANY($1::bigint[]) RETURNING id`,
      [ids],
    )
    return res.json({ code: 200, message: 'batch_deleted', data: { deletedCount: deleted.rowCount || 0 } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `批量删除GAS供应商失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-suppliers/clear-all', authMiddleware, async (_req, res) => {
  try {
    const deleted = await pool.query(`DELETE FROM ${gasSupplierTable} RETURNING id`)
    return res.json({ code: 200, message: 'cleared', data: { deletedCount: deleted.rowCount || 0 } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `清空GAS供应商失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-oems', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000)
  const keyword = toText(req.query.keyword)
  const params = []
  const whereClauses = []
  if (keyword) {
    params.push(`%${keyword}%`)
    whereClauses.push(`(
      oem_name ILIKE $${params.length}
      OR brand ILIKE $${params.length}
      OR vehicle_model ILIKE $${params.length}
      OR region ILIKE $${params.length}
      OR registered_capital ILIKE $${params.length}
      OR website ILIKE $${params.length}
    )`)
  }
  params.push(limit)
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        oem_name AS "oemName",
        brand,
        vehicle_model AS "vehicleModel",
        region,
        registered_capital AS "registeredCapital",
        website,
        model,
        skill,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${gasOemTable}
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length}
      `,
      params,
    )
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询整车厂失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-oems/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        oem_name AS "oemName",
        brand,
        vehicle_model AS "vehicleModel",
        region,
        registered_capital AS "registeredCapital",
        website,
        model,
        skill,
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${gasOemTable}
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询整车厂详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/gas-oems', authMiddleware, async (req, res) => {
  const oemName = sanitizeSupplierCompanyName(toText(req.body?.oemName))
  if (!oemName) {
    return res.status(400).json({ code: 400, message: '车企名称不能为空', data: null })
  }
  try {
      const inserted = await pool.query(
        `
      INSERT INTO ${gasOemTable}
        (oem_name, brand, vehicle_model, region, registered_capital, website, model, skill, source_file, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      RETURNING id
      `,
      [
        oemName,
        toText(req.body?.brand),
        toText(req.body?.vehicleModel),
        toText(req.body?.region),
        toText(req.body?.registeredCapital),
        toText(req.body?.website),
        toText(req.body?.model),
        toText(req.body?.skill),
        toText(req.body?.sourceFile),
      ],
    )
    return res.json({ code: 200, message: 'created', data: { id: String(inserted.rows[0].id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `新增整车厂失败: ${error.message}`, data: null })
  }
})

app.put('/api/gas-oems/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  const payload = req.body || {}
  const textFieldMap = {
    oemName: 'oem_name',
    brand: 'brand',
    vehicleModel: 'vehicle_model',
    region: 'region',
    registeredCapital: 'registered_capital',
    website: 'website',
    model: 'model',
    skill: 'skill',
    sourceFile: 'source_file',
  }
  const setClauses = []
  const params = []
  for (const [key, column] of Object.entries(textFieldMap)) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
    const raw = toText(payload[key])
    params.push(key === 'oemName' ? sanitizeSupplierCompanyName(raw) : raw)
    setClauses.push(`${column} = $${params.length}`)
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可更新字段', data: null })
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  try {
    const updated = await pool.query(
      `UPDATE ${gasOemTable} SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params,
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新整车厂失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-oems/item/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const deleted = await pool.query(`DELETE FROM ${gasOemTable} WHERE id = $1 RETURNING id`, [id])
    if (deleted.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除整车厂失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-oems/batch-delete', authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : []
  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效 ids', data: null })
  }
  try {
    const deleted = await pool.query(
      `DELETE FROM ${gasOemTable} WHERE id = ANY($1::bigint[]) RETURNING id`,
      [ids],
    )
    return res.json({ code: 200, message: 'batch_deleted', data: { deletedCount: deleted.rowCount || 0 } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `批量删除整车厂失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-oems/clear-all', authMiddleware, async (_req, res) => {
  try {
    const deleted = await pool.query(`DELETE FROM ${gasOemTable} RETURNING id`)
    return res.json({ code: 200, message: 'cleared', data: { deletedCount: deleted.rowCount || 0 } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `清空整车厂失败: ${error.message}`, data: null })
  }
})

app.post('/api/gas-oems/sync-tasks/:taskId/import', authMiddleware, async (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = supplierCrawlTaskStore.get(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在', data: null })
  }
  if (task.status !== 'done') {
    return res.status(400).json({ code: 400, message: '任务尚未完成，不能入库', data: null })
  }
  try {
    let records = Array.isArray(task.records) ? task.records : []
    if (records.length === 0 && task.fileName) {
      const csvPath = path.join(crawlExportDir, path.basename(task.fileName))
      const csvText = await fs.readFile(csvPath, 'utf8')
      records = parseCsvObjects(csvText).map((item) => ({
        oemName: toText(item.company_name),
        companyName: toText(item.company_name),
        brand: toText(item.brand),
        vehicleModel: toText(item.vehicle_model || item.vehicleModel),
        region: toText(item.region),
        registeredCapital: toText(item.registered_capital),
        website: toText(item.website || item.detail_url),
        model: toText(item.model) || task.model,
        skill: toText(item.skill) || task.skill,
      }))
    }
    const validRecords = records.filter((item) => toText(item.oemName || item.companyName))
    const importSummary = await importGasOemRows(validRecords, task.fileName || '')
    task.imported = true
    task.importSummary = importSummary
    schedulePersistSupplierTaskStore()
    return res.json({ code: 200, message: 'imported', data: importSummary })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `整车厂入库失败: ${error.message}`, data: null })
  }
})

app.get('/api/supplier-profiles/options', authMiddleware, async (req, res) => {
  const view = normalizeSupplierProfileView(req.query.view)
  const treeTable = view === 'gas' ? gasSupplyChainNodeTable : supplyChainNodeTable
  const sourceWhereSql = view === 'gys'
    ? `WHERE (node_id IS NULL OR node_id NOT IN (SELECT id FROM ${gasSupplyChainNodeTable})) AND detail_url NOT ILIKE '%gasgoo%' AND list_page_url NOT ILIKE '%gasgoo%'`
    : ''
  try {
    const [oemResult, countryResult, certResult, sourceResult, treeResult] = await Promise.all([
      view === 'gas'
        ? pool.query(`
          WITH gas_oem AS (
            SELECT oem_name AS name
            FROM ${gasOemTable}
            WHERE oem_name <> ''
          ),
          profile_oem AS (
            SELECT DISTINCT jsonb_array_elements_text(fit_oems) AS name
            FROM ${supplierProfileTable}
            WHERE profile_source = 'gas' AND jsonb_typeof(fit_oems) = 'array'
          ),
          merged AS (
            SELECT name FROM gas_oem
            UNION
            SELECT name FROM profile_oem
          )
          SELECT
            ROW_NUMBER() OVER (ORDER BY name) AS id,
            name
          FROM merged
          WHERE COALESCE(name, '') <> ''
          ORDER BY name ASC
          LIMIT 5000
        `)
        : pool.query(`SELECT id, name FROM ${supplierOemDictTable} ORDER BY sort_order ASC, id ASC LIMIT 1000`),
      pool.query(`SELECT id, name FROM ${supplierCountryDictTable} ORDER BY sort_order ASC, id ASC LIMIT 1000`),
      pool.query(`SELECT id, name FROM ${supplierCertDictTable} ORDER BY sort_order ASC, id ASC LIMIT 1000`),
      view === 'gas'
        ? pool.query(`
          SELECT
            s.id,
            s.gas_node_id AS "nodeId",
            COALESCE(NULLIF(s.gas_node_name, ''), n.node_title, '') AS "nodeName",
            s.company_name AS "companyName",
            s.detail_url AS "detailUrl",
            s.list_page_url AS "listPageUrl",
            s.main_products AS "mainProducts",
            '' AS "fitExport",
            '' AS "qualitySystem",
            s.region
          FROM ${gasSupplierTable} s
          LEFT JOIN ${gasSupplyChainNodeTable} n ON n.id = s.gas_node_id
          ORDER BY s.updated_at DESC, s.id DESC
          LIMIT 5000
        `)
        : pool.query(`
          SELECT
            id,
            node_id AS "nodeId",
            node_name AS "nodeName",
            company_name AS "companyName",
            detail_url AS "detailUrl",
            list_page_url AS "listPageUrl",
            main_products AS "mainProducts",
            fit_export AS "fitExport",
            quality_system AS "qualitySystem",
            region
          FROM ${supplierBaseTable}
          ${sourceWhereSql}
          ORDER BY updated_at DESC, id DESC
          LIMIT 3000
        `),
      pool.query(`
        SELECT
          id,
          parent_id AS "parentId",
          node_level AS "nodeLevel",
          node_title AS "nodeTitle"
        FROM ${treeTable}
        ORDER BY node_level ASC, id ASC
        LIMIT 20000
      `),
    ])
    const treeNodeMap = new Map()
    for (const row of treeResult.rows) {
      treeNodeMap.set(row.id, {
        key: String(row.id),
        value: Number(row.id),
        title: toText(row.nodeTitle),
        parentId: row.parentId,
        children: [],
      })
    }
    const treeRoots = []
    for (const node of treeNodeMap.values()) {
      if (node.parentId && treeNodeMap.has(node.parentId)) {
        treeNodeMap.get(node.parentId).children.push(node)
      } else {
        treeRoots.push(node)
      }
    }
    return res.json({
      code: 200,
      message: 'success',
      data: {
        oemOptions: oemResult.rows.map((item, index) => ({ id: item.id ?? index + 1, name: item.name })),
        countryOptions: countryResult.rows.map((item) => ({ id: item.id, name: item.name })),
        certificationOptions: certResult.rows.map((item) => ({ id: item.id, name: item.name })),
        sourceOptions: sourceResult.rows.map((item) => ({
          id: item.id,
          nodeId: item.nodeId,
          nodeName: item.nodeName,
          companyName: sanitizeSupplierCompanyName(item.companyName),
          detailUrl: item.detailUrl,
          listPageUrl: item.listPageUrl,
          mainProducts: item.mainProducts,
          fitExport: item.fitExport,
          qualitySystem: item.qualitySystem,
          region: item.region,
        })),
        supplyChainTree: treeRoots,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询档案基础选项失败: ${error.message}`, data: null })
  }
})

app.get('/api/supplier-profiles', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000)
  const keyword = toText(req.query.keyword)
  const view = normalizeSupplierProfileView(req.query.view)
  const params = []
  const whereClauses = []
  if (view) {
    params.push(view)
    whereClauses.push(`profile_source = $${params.length}`)
  }
  if (keyword) {
    params.push(`%${keyword}%`)
    whereClauses.push(`(
        company_name ILIKE $1
        OR company_name_en ILIKE $1
        OR legal_representative ILIKE $1
        OR contact_person ILIKE $1
        OR phone ILIKE $1
        OR mobile ILIKE $1
        OR email ILIKE $1
        OR website ILIKE $1
        OR supplier_profile_url ILIKE $1
        OR org_code ILIKE $1
        OR fit_situation ILIKE $1
        OR export_situation ILIKE $1
        OR certificates ILIKE $1
        OR company_news ILIKE $1
        OR fit_oems::text ILIKE $1
        OR product_fit_details::text ILIKE $1
        OR export_countries::text ILIKE $1
        OR certificate_items::text ILIKE $1
        OR company_tags::text ILIKE $1
        OR main_product_names::text ILIKE $1
        OR business_info::text ILIKE $1
        OR industrial_commercial_info::text ILIKE $1
      )`.replace(/\$1/g, `$${params.length}`))
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  params.push(limit)
  const limitParam = `$${params.length}`
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        profile_source AS "profileSource",
        source_supplier_id AS "sourceSupplierId",
        related_node_id AS "relatedNodeId",
        related_node_name AS "relatedNodeName",
        related_node_ids AS "relatedNodeIds",
        related_node_names AS "relatedNodeNames",
        company_name AS "companyName",
        company_name_en AS "companyNameEn",
        legal_representative AS "legalRepresentative",
        org_code AS "orgCode",
        COALESCE(NULLIF(org_code, ''), industrial_commercial_info ->> '统一社会信用代码', '') AS "unifiedSocialCreditCode",
        contact_person AS "contactPerson",
        phone,
        mobile,
        email,
        website,
        supplier_profile_url AS "supplierProfileUrl",
        fit_oems AS "fitOems",
        product_fit_details AS "productFitDetails",
        certificates,
        main_product_names AS "mainProductNames",
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${supplierProfileTable}
      ${whereSql}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limitParam}
      `,
      params,
    )
    const data = result.rows.map((row) => {
      const relatedNodeIds = parseBigintArrayLoose(row.relatedNodeIds)
      const relatedNodeNames = parseStringArray(row.relatedNodeNames)
      return {
        ...row,
        relatedNodeIds,
        relatedNodeNames,
        relatedNodeName: relatedNodeNames.length > 0 ? relatedNodeNames.join('，') : toText(row.relatedNodeName),
        supplierProfileUrl: toText(row.supplierProfileUrl || row.website),
        fitOems: parseStringArray(row.fitOems),
        productFitDetails: Array.isArray(row.productFitDetails) ? row.productFitDetails : [],
        mainProductNames: parseStringArray(row.mainProductNames),
      }
    })
    return res.json({ code: 200, message: 'success', data })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询供应商档案失败: ${error.message}`, data: null })
  }
})

app.get('/api/supplier-profiles/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  const view = normalizeSupplierProfileView(req.query.view)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const client = await pool.connect()
    try {
      const detail = await fetchSupplierProfileDetailById(client, id)
      if (!detail || (view && detail.profileSource !== view)) {
        return res.status(404).json({ code: 404, message: '记录不存在', data: null })
      }
      return res.json({ code: 200, message: 'success', data: detail })
    } finally {
      client.release()
    }
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询供应商档案详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/supplier-profiles', authMiddleware, async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const profileId = await saveSupplierProfileRecord(client, null, {
      ...(req.body || {}),
      profileSource: normalizeSupplierProfileView(req.query.view) || req.body?.profileSource,
    })
    await client.query('COMMIT')
    return res.json({ code: 200, message: 'created', data: { id: String(profileId) } })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const status = /不能为空/.test(error?.message || '') ? 400 : 500
    return res.status(status).json({ code: status, message: `新增供应商档案失败: ${error.message}`, data: null })
  } finally {
    client.release()
  }
})

app.put('/api/supplier-profiles/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  const view = normalizeSupplierProfileView(req.query.view)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existed = await fetchSupplierProfileDetailById(client, id)
    if (!existed || (view && existed.profileSource !== view)) {
      await client.query('ROLLBACK')
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    await saveSupplierProfileRecord(client, id, {
      ...(req.body || {}),
      profileSource: view || req.body?.profileSource || existed.profileSource,
    })
    await client.query('COMMIT')
    return res.json({ code: 200, message: 'updated', data: { id: String(id) } })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const status = /不能为空/.test(error?.message || '') ? 400 : 500
    return res.status(status).json({ code: status, message: `更新供应商档案失败: ${error.message}`, data: null })
  } finally {
    client.release()
  }
})

app.delete('/api/supplier-profiles/batch-delete', authMiddleware, async (req, res) => {
  const view = normalizeSupplierProfileView(req.query.view || req.body?.view)
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((item) => parsePositiveBigintId(item)).filter(Boolean)
    : []
  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效 ids', data: null })
  }
  try {
    const whereSourceSql = view ? ' AND profile_source = $2' : ''
    const deleted = await pool.query(
      `DELETE FROM ${supplierProfileTable} WHERE id = ANY($1::bigint[])${whereSourceSql} RETURNING id`,
      view ? [ids, view] : [ids],
    )
    return res.json({
      code: 200,
      message: 'batch_deleted',
      data: { deletedCount: deleted.rowCount || 0 },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `批量删除供应商档案失败: ${error.message}`, data: null })
  }
})

app.delete('/api/supplier-profiles/clear-all', authMiddleware, async (req, res) => {
  const view = normalizeSupplierProfileView(req.query.view || req.body?.view)
  try {
    const deleted = await pool.query(
      `DELETE FROM ${supplierProfileTable}${view ? ' WHERE profile_source = $1' : ''} RETURNING id`,
      view ? [view] : [],
    )
    return res.json({
      code: 200,
      message: 'cleared',
      data: { deletedCount: deleted.rowCount || 0 },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `清空供应商档案失败: ${error.message}`, data: null })
  }
})

app.delete('/api/supplier-profiles/:id', authMiddleware, async (req, res) => {
  const id = parsePositiveBigintId(req.params.id)
  const view = normalizeSupplierProfileView(req.query.view)
  if (!id) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const deleted = await pool.query(
      `DELETE FROM ${supplierProfileTable} WHERE id = $1::bigint${view ? ' AND profile_source = $2' : ''} RETURNING id`,
      view ? [id, view] : [id],
    )
    if (deleted.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除供应商档案失败: ${error.message}`, data: null })
  }
})

app.get('/api/supply-chain/tree', authMiddleware, async (req, res) => {
  const sourceUrl = String(req.query.sourceUrl || '').trim()
  const businessEntity = String(req.query.businessEntity || '').trim()
  const filters = []
  const params = []
  if (sourceUrl) {
    params.push(sourceUrl)
    filters.push(`source_url = $${params.length}`)
  }
  if (businessEntity) {
    params.push(businessEntity)
    filters.push(`business_entity = $${params.length}`)
  }
  const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
  try {
    const sql = `
      SELECT
        id,
        parent_id AS "parentId",
        node_level AS "nodeLevel",
        node_title AS "nodeTitle",
        node_url AS "nodeUrl",
        source_url AS "sourceUrl",
        business_entity AS "businessEntity"
      FROM ${supplyChainNodeTable}
      ${whereSql}
      ORDER BY node_level ASC, id ASC
      LIMIT 20000
    `
    const result = await pool.query(sql, params)
    const rows = result.rows
    const nodeMap = new Map()
    rows.forEach((row) => {
      nodeMap.set(row.id, {
        key: String(row.id),
        id: row.id,
        parentId: row.parentId,
        title: row.nodeTitle,
        nodeLevel: row.nodeLevel,
        nodeUrl: row.nodeUrl,
        sourceUrl: row.sourceUrl,
        businessEntity: row.businessEntity,
        pathTitles: [],
        children: [],
      })
    })

    const roots = []
    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId).children.push(node)
      } else {
        roots.push(node)
      }
    }

    const rootNode = roots.find((item) => item.title === supplyChainRootTitle)
    if (rootNode) {
      const others = roots.filter((item) => item.id !== rootNode.id)
      rootNode.children = [...rootNode.children, ...others]
      roots.length = 0
      roots.push(rootNode)
    }

    const fillPath = (nodes, parentPath = []) => {
      for (const node of nodes) {
        node.pathTitles = [...parentPath, node.title]
        if (node.children.length > 0) {
          fillPath(node.children, node.pathTitles)
        }
      }
    }
    fillPath(roots)

    return res.json({
      code: 200,
      message: 'success',
      data: {
        totalNodes: rows.length,
        roots,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询供应链树失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-supply-chain/tree', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        parent_id AS "parentId",
        node_level AS "nodeLevel",
        node_title AS "nodeTitle",
        node_url AS "nodeUrl",
        source_url AS "sourceUrl",
        synced_supplier_count AS "syncedSupplierCount",
        TO_CHAR(synced_at, 'YYYY-MM-DD HH24:MI:SS') AS "syncedAt"
      FROM ${gasSupplyChainNodeTable}
      ORDER BY node_level ASC, id ASC
      LIMIT 20000
      `,
    )
    const nodeMap = new Map()
    result.rows.forEach((row) => {
      nodeMap.set(row.id, {
        key: String(row.id),
        id: row.id,
        parentId: row.parentId,
        title: row.nodeTitle,
        nodeLevel: row.nodeLevel,
        nodeUrl: row.nodeUrl,
        sourceUrl: row.sourceUrl,
        syncedSupplierCount: Number(row.syncedSupplierCount || 0),
        syncedAt: row.syncedAt || '',
        children: [],
      })
    })
    const roots = []
    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId).children.push(node)
      } else {
        roots.push(node)
      }
    }
    return res.json({ code: 200, message: 'success', data: { totalNodes: result.rows.length, roots } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询 GAS 供应链树失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-supply-chain/records', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 1000), 1), 5000)
  const keyword = String(req.query.keyword || '').trim()
  const parentKeyword = String(req.query.parentKeyword || '').trim()
  const filters = []
  const params = []
  if (keyword) {
    params.push(`%${keyword}%`)
    filters.push(`(child.node_title ILIKE $${params.length} OR child.node_url ILIKE $${params.length} OR child.source_url ILIKE $${params.length})`)
  }
  if (parentKeyword) {
    params.push(`%${parentKeyword}%`)
    filters.push(`(CAST(child.parent_id AS TEXT) ILIKE $${params.length} OR COALESCE(parent.node_title, '') ILIKE $${params.length})`)
  }
  params.push(limit)
  const whereSql = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''
  try {
    const result = await pool.query(
      `
      SELECT
        child.id,
        child.parent_id AS "parentId",
        child.node_title AS "nodeName",
        child.node_level AS "nodeLevel",
        COALESCE(NULLIF(child.node_url, ''), child.source_url) AS "sourceUrl",
        child.source_url AS "sourceSiteUrl",
        child.node_url AS "nodeUrl",
        child.synced_supplier_count AS "syncedSupplierCount",
        TO_CHAR(child.synced_at, 'YYYY-MM-DD HH24:MI:SS') AS "syncedAt",
        parent.node_title AS "parentName",
        TO_CHAR(child.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${gasSupplyChainNodeTable} child
      LEFT JOIN ${gasSupplyChainNodeTable} parent ON parent.id = child.parent_id
      ${whereSql}
      ORDER BY child.node_level ASC, child.id ASC
      LIMIT $${params.length}
      `,
      params,
    )
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询 GAS 供应链记录失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-supply-chain/records/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const result = await pool.query(
      `
      SELECT
        child.id,
        child.parent_id AS "parentId",
        child.node_title AS "nodeName",
        child.node_level AS "nodeLevel",
        COALESCE(NULLIF(child.node_url, ''), child.source_url) AS "sourceUrl",
        child.source_url AS "sourceSiteUrl",
        child.node_url AS "nodeUrl",
        child.synced_supplier_count AS "syncedSupplierCount",
        TO_CHAR(child.synced_at, 'YYYY-MM-DD HH24:MI:SS') AS "syncedAt",
        parent.node_title AS "parentName",
        TO_CHAR(child.created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(child.updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${gasSupplyChainNodeTable} child
      LEFT JOIN ${gasSupplyChainNodeTable} parent ON parent.id = child.parent_id
      WHERE child.id = $1
      LIMIT 1
      `,
      [id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'success', data: result.rows[0] })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询 GAS 供应链详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/gas-supply-chain/records', authMiddleware, async (req, res) => {
  const nodeName = toText(req.body?.nodeName)
  const parentIdRaw = req.body?.parentId
  const parentId = parentIdRaw === null || parentIdRaw === '' || typeof parentIdRaw === 'undefined' ? null : Number(parentIdRaw)
  const nodeLevel = Number(req.body?.nodeLevel || 1)
  const sourceUrl = toText(req.body?.sourceUrl)
  const syncedSupplierCount = Math.max(0, Number(req.body?.syncedSupplierCount || 0))
  if (!nodeName) {
    return res.status(400).json({ code: 400, message: '节点名称不能为空', data: null })
  }
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
    return res.status(400).json({ code: 400, message: 'parentId 必须为空或正整数', data: null })
  }
  if (!Number.isInteger(nodeLevel) || nodeLevel < 1 || nodeLevel > 5) {
    return res.status(400).json({ code: 400, message: '节点层级仅支持 1-5 级', data: null })
  }
  try {
    const created = await pool.query(
      `
      INSERT INTO ${gasSupplyChainNodeTable}
      (parent_id, node_level, node_title, source_url, node_url, synced_supplier_count, synced_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id
      `,
      [parentId, nodeLevel, nodeName, sourceUrl, sourceUrl, syncedSupplierCount, syncedSupplierCount > 0 ? new Date().toISOString() : null],
    )
    return res.json({ code: 200, message: 'created', data: { id: String(created.rows[0].id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `新增 GAS 供应链失败: ${error.message}`, data: null })
  }
})

app.put('/api/gas-supply-chain/records/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  const payload = req.body || {}
  const setClauses = []
  const params = []
  if (Object.prototype.hasOwnProperty.call(payload, 'nodeName')) {
    params.push(toText(payload.nodeName))
    setClauses.push(`node_title = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'parentId')) {
    const parentIdRaw = payload.parentId
    const parentId = parentIdRaw === null || parentIdRaw === '' || typeof parentIdRaw === 'undefined' ? null : Number(parentIdRaw)
    if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
      return res.status(400).json({ code: 400, message: 'parentId 必须为空或正整数', data: null })
    }
    params.push(parentId)
    setClauses.push(`parent_id = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nodeLevel')) {
    const nodeLevel = Number(payload.nodeLevel)
    if (!Number.isInteger(nodeLevel) || nodeLevel < 1 || nodeLevel > 5) {
      return res.status(400).json({ code: 400, message: '节点层级仅支持 1-5 级', data: null })
    }
    params.push(nodeLevel)
    setClauses.push(`node_level = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'sourceUrl')) {
    params.push(toText(payload.sourceUrl))
    setClauses.push(`source_url = $${params.length}`)
    params.push(toText(payload.sourceUrl))
    setClauses.push(`node_url = $${params.length}`)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'syncedSupplierCount')) {
    const count = Math.max(0, Number(payload.syncedSupplierCount || 0))
    params.push(count)
    setClauses.push(`synced_supplier_count = $${params.length}`)
    params.push(count > 0 ? new Date().toISOString() : null)
    setClauses.push(`synced_at = $${params.length}`)
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可更新字段', data: null })
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  try {
    const updated = await pool.query(
      `UPDATE ${gasSupplyChainNodeTable} SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params,
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新 GAS 供应链失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-supply-chain/records/item/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const deleted = await pool.query(`DELETE FROM ${gasSupplyChainNodeTable} WHERE id = $1 RETURNING id`, [id])
    if (deleted.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'deleted', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `删除 GAS 供应链失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-supply-chain/records/batch-delete', authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)
    : []
  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效 ids', data: null })
  }
  try {
    const deleted = await pool.query(
      `DELETE FROM ${gasSupplyChainNodeTable} WHERE id = ANY($1::bigint[]) RETURNING id`,
      [ids],
    )
    return res.json({ code: 200, message: 'batch_deleted', data: { deletedCount: deleted.rowCount || 0 } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `批量删除 GAS 供应链失败: ${error.message}`, data: null })
  }
})

app.delete('/api/gas-supply-chain/clear-all', authMiddleware, async (_req, res) => {
  try {
    const deleted = await pool.query(`DELETE FROM ${gasSupplyChainNodeTable} RETURNING id`)
    return res.json({ code: 200, message: 'cleared', data: { deletedCount: deleted.rowCount || 0 } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `清空 GAS 供应链失败: ${error.message}`, data: null })
  }
})

app.post('/api/gas-supply-chain/sync-tasks', authMiddleware, async (req, res) => {
  try {
    const urlsText = toText(req.body?.urlsText)
    const urls = parseUrlText(urlsText).filter((item) => {
      try {
        const parsed = new URL(item)
        return parsed.hostname.toLowerCase() === 'i.gasgoo.com'
      } catch {
        return false
      }
    })
    const normalizedUrls = urls.length > 0 ? [...new Set(urls)] : ['https://i.gasgoo.com/']
    const sourceUrl = normalizedUrls[0]
    const model = toText(req.body?.model) || codexModelOptions[0]
    const skill = 'web-access'
    const requestedMode = toText(req.body?.mode || 'full').toLowerCase()
    const mode = requestedMode === 'incremental' ? 'incremental' : 'full'
    const localExtractorCommand = ''
    const localExtractorArgs = []
    const localExtractorCwd = ''
    const localExtractorTimeoutMs = Math.max(5000, Number(gasSyncLocalExtractTimeoutMsDefault || 180000))
    const taskId = createGasSupplyChainTaskId()
    const task = {
      taskId,
      sourceUrl,
      model,
      skill,
      mode,
      urls: normalizedUrls,
      localExtractorCommand,
      localExtractorArgs,
      localExtractorCwd,
      localExtractorTimeoutMs,
      status: 'pending',
      progress: 0,
      totalUrls: normalizedUrls.length,
      processedUrls: 0,
      totalRows: 0,
      estimatedTotalRows: 0,
      successRows: 0,
      failedRows: 0,
      runLogs: [],
      errorMessage: '',
      fileName: '',
      filePath: '',
      downloadUrl: '',
      records: [],
      imported: false,
      importSummary: null,
      cancelRequested: false,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    }
    gasSupplyChainTaskStore.set(taskId, task)
    schedulePersistGasSupplyChainTaskStore()
    void runGasSupplyChainSyncTask(task).catch((error) => {
      task.status = 'failed'
      task.errorMessage = error.message || '任务执行失败'
      task.progress = 100
      task.endedAt = new Date().toISOString()
      const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
      task.runLogs.push(`${nowText()} | 执行失败：${task.errorMessage}`)
      schedulePersistGasSupplyChainTaskStore()
    })
    return res.json({
      code: 200,
      message: 'created',
      data: {
        ...normalizeGasSupplyChainTask(task),
        resolvedUrls: normalizedUrls,
        resolvedUrlCount: normalizedUrls.length,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `创建 GAS 同步任务失败: ${error.message}`, data: null })
  }
})

app.get('/api/gas-supply-chain/sync-tasks/:taskId', authMiddleware, (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = gasSupplyChainTaskStore.get(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在', data: null })
  }
  return res.json({ code: 200, message: 'success', data: normalizeGasSupplyChainTask(task) })
})

app.post('/api/gas-supply-chain/sync-tasks/:taskId/cancel', authMiddleware, (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = gasSupplyChainTaskStore.get(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在', data: null })
  }
  if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
    return res.json({ code: 200, message: 'already_finished', data: normalizeGasSupplyChainTask(task) })
  }
  task.cancelRequested = true
  task.status = 'cancelling'
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  task.runLogs.push(`${nowText()} | 收到取消指令，正在结束任务...`)
  schedulePersistGasSupplyChainTaskStore()
  return res.json({ code: 200, message: 'cancel_requested', data: normalizeGasSupplyChainTask(task) })
})

app.post('/api/gas-supply-chain/sync-tasks/:taskId/import', authMiddleware, async (req, res) => {
  const taskId = String(req.params.taskId || '').trim()
  const task = gasSupplyChainTaskStore.get(taskId)
  if (!task) {
    return res.status(404).json({ code: 404, message: '任务不存在', data: null })
  }
  if (task.status !== 'done') {
    return res.status(400).json({ code: 400, message: '任务尚未完成，不能入库', data: null })
  }
  try {
    let records = Array.isArray(task.records) ? task.records : []
    if (records.length === 0 && task.fileName) {
      const csvPath = path.join(crawlExportDir, path.basename(task.fileName))
      const csvText = await fs.readFile(csvPath, 'utf8')
      records = parseCsvObjects(csvText).map((item) => ({
        sourceUrl: toText(item.source_url),
        pageUrl: toText(item.page_url),
        model: toText(item.model) || task.model,
        skill: toText(item.skill) || task.skill,
        mode: toText(item.mode) || task.mode,
        nodeLevel: Number(item.node_level || 0),
        nodeCode: toText(item.node_code),
        nodeTitle: toText(item.node_title),
        nodeUrl: toText(item.node_url),
        parentCode: toText(item.parent_code),
        parentTitle: toText(item.parent_title),
        parentUrl: toText(item.parent_url),
        level1Code: toText(item.level1_code),
        level1Title: toText(item.level1_title),
        level1Url: toText(item.level1_url),
        level2Code: toText(item.level2_code),
        level2Title: toText(item.level2_title),
        level2Url: toText(item.level2_url),
        level3Code: toText(item.level3_code),
        level3Title: toText(item.level3_title),
        level3Url: toText(item.level3_url),
        lineage: toText(item.lineage),
        status: toText(item.status),
        errorMessage: toText(item.error_message),
      }))
    }
    const validRecords = records.filter((item) => Number(item.nodeLevel) >= 1 && Number(item.nodeLevel) <= 3 && toText(item.nodeTitle))
    const importSummary = await importGasSupplyChainTaskRows(validRecords, task.mode || 'full')
    task.imported = true
    task.importSummary = importSummary
    schedulePersistGasSupplyChainTaskStore()
    return res.json({ code: 200, message: 'imported', data: importSummary })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `GAS 供应链入库失败: ${error.message}`, data: null })
  }
})

app.post('/api/gas-supply-chain/sync-import', authMiddleware, async (req, res) => {
  const taskId = toText(req.body?.taskId)
  if (!taskId) {
    return res.status(400).json({ code: 400, message: '缺少 taskId', data: null })
  }
  req.params.taskId = taskId
  return app._router.handle(req, res, () => {})
})

app.get('/api/gas-supplier-portrait-settings', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT settings_json AS "settingsJson" FROM ${gasSupplierPortraitSettingTable} WHERE setting_key = $1 LIMIT 1`,
      ['default'],
    )
    const settings = result.rows[0]?.settingsJson || {}
    return res.json({ code: 200, message: 'success', data: settings })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取评分设置失败: ${error.message}`, data: null })
  }
})

app.put('/api/gas-supplier-portrait-settings', authMiddleware, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    await pool.query(
      `
      INSERT INTO ${gasSupplierPortraitSettingTable} (setting_key, settings_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (setting_key)
      DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()
      `,
      ['default', JSON.stringify(body || {})],
    )
    return res.json({ code: 200, message: 'success', data: body })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `保存评分设置失败: ${error.message}`, data: null })
  }
})

app.get('/api/ui-style-settings', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT settings_json AS "settingsJson" FROM ${gasSupplierPortraitSettingTable} WHERE setting_key = $1 LIMIT 1`,
      ['ui_style_v1'],
    )
    const settings = result.rows[0]?.settingsJson || {}
    return res.json({ code: 200, message: 'success', data: settings })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取UI样式设置失败: ${error.message}`, data: null })
  }
})

app.put('/api/ui-style-settings', authMiddleware, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    await pool.query(
      `
      INSERT INTO ${gasSupplierPortraitSettingTable} (setting_key, settings_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (setting_key)
      DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()
      `,
      ['ui_style_v1', JSON.stringify(body || {})],
    )
    return res.json({ code: 200, message: 'success', data: body })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `保存UI样式设置失败: ${error.message}`, data: null })
  }
})

app.get('/api/menu-visibility-settings', authMiddleware, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT settings_json AS "settingsJson" FROM ${gasSupplierPortraitSettingTable} WHERE setting_key = $1 LIMIT 1`,
      ['menu_visibility_v1'],
    )
    const settings = result.rows[0]?.settingsJson || {}
    return res.json({ code: 200, message: 'success', data: settings })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取菜单设置失败: ${error.message}`, data: null })
  }
})

app.put('/api/menu-visibility-settings', authMiddleware, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    await pool.query(
      `
      INSERT INTO ${gasSupplierPortraitSettingTable} (setting_key, settings_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (setting_key)
      DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = NOW()
      `,
      ['menu_visibility_v1', JSON.stringify(body || {})],
    )
    return res.json({ code: 200, message: 'success', data: body })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `保存菜单设置失败: ${error.message}`, data: null })
  }
})

app.get('/api/stocks/overview', authMiddleware, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 500), 1), 2000)
  try {
    const sql = `
      SELECT
        symbol,
        COUNT(*)::int AS "totalBars",
        TO_CHAR(MIN(trade_date), 'YYYY-MM-DD') AS "firstTradeDate",
        TO_CHAR(MAX(trade_date), 'YYYY-MM-DD') AS "lastTradeDate",
        ROUND(last(close, trade_date::timestamptz)::numeric, 4) AS "latestClose",
        last(volume, trade_date::timestamptz)::bigint AS "latestVolume"
      FROM demo_stock.all_stocks_5yr
      GROUP BY symbol
      ORDER BY symbol
      LIMIT $1
    `
    const result = await pool.query(sql, [limit])
    return res.json({ code: 200, message: 'success', data: result.rows })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `股票概览查询失败: ${error.message}`, data: null })
  }
})

app.get('/api/stocks/kline', authMiddleware, async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase()
  const cycle = String(req.query.cycle || '1d').trim().toLowerCase()
  const from = String(req.query.from || '').trim()
  const to = String(req.query.to || '').trim()

  if (!symbol) {
    return res.status(400).json({ code: 400, message: '缺少 symbol 参数', data: null })
  }

  const cycleToBucket = {
    '1d': '1 day',
    '1w': '1 week',
    '30d': '30 days',
  }
  const bucketInterval = cycleToBucket[cycle]
  if (!bucketInterval) {
    return res.status(400).json({ code: 400, message: 'cycle 仅支持 1d/1w/30d', data: null })
  }

  try {
    const sql = `
      WITH stock_src AS (
        SELECT
          trade_date::timestamptz AS ts,
          open,
          high,
          low,
          close,
          volume
        FROM demo_stock.all_stocks_5yr
        WHERE symbol = $1
          AND ($2::date IS NULL OR trade_date >= $2::date)
          AND ($3::date IS NULL OR trade_date <= $3::date)
      )
      SELECT
        EXTRACT(EPOCH FROM time_bucket($4::interval, ts))::bigint AS "time",
        ROUND(first(open, ts)::numeric, 4) AS "open",
        ROUND(max(high)::numeric, 4) AS "high",
        ROUND(min(low)::numeric, 4) AS "low",
        ROUND(last(close, ts)::numeric, 4) AS "close",
        sum(volume)::bigint AS "volume"
      FROM stock_src
      GROUP BY time_bucket($4::interval, ts)
      ORDER BY time_bucket($4::interval, ts)
    `
    const result = await pool.query(sql, [symbol, from || null, to || null, bucketInterval])
    return res.json({
      code: 200,
      message: 'success',
      data: {
        symbol,
        cycle,
        bucket: bucketInterval,
        from: from || null,
        to: to || null,
        bars: result.rows,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `K线查询失败: ${error.message}`, data: null })
  }
})

async function callPreciseSourcingLlm(state) {
  const apiKey = toText(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.QWEN_API_KEY)
  if (!apiKey) return ''

  const model = toText(state?.model || process.env.OPENAI_CHAT_MODEL || process.env.LANGCHAIN_CHAT_MODEL || process.env.DEFAULT_LLM_MODEL || 'gpt-4.1-mini')
  const baseUrl = toText(process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com')
  const customSystemPrompt = toText(state?.systemPrompt)
  const presetKey = toText(state?.systemPromptPresetKey || 'default')
  const promptPresetMap = {
    default: '你是汽车供应链精准寻源助手。目标：基于数据库/知识库/互联网证据输出可执行候选建议。要求：先结论后证据；默认Top3；每条含名称、匹配理由、风险提示；无证据要明确说明；中文简洁结构化输出。',
    risk: '你是汽车供应链采购风控助手。目标：优先识别风险再推荐候选。要求：先给风险等级与原因，再给Top3候选；每条包含匹配点、主要风险、核验项；证据不足必须标注“待核验”；中文简洁输出。',
    fast: '你是汽车供应链线索筛选助手。目标：快速给出可跟进线索。要求：先直接回答，再给Top3；每条只写名称+一句理由+推荐动作；控制篇幅；无命中给替代关键词；中文输出。',
  }
  const resolvedSystemPrompt = customSystemPrompt || promptPresetMap[presetKey] || promptPresetMap.default
  const resolveSupplierDisplayName = (item = {}) => toText(
    item?.companyName
    || item?.company_name
    || item?.name
    || item?.supplier_name
    || item?.oem_name
    || item?.businessEntity
    || item?.brand
    || '',
  )
  const resolveSupplierSourceUrl = (item = {}) => toText(
    item?.sourceUrl
    || item?.source_url
    || item?.detailUrl
    || item?.detail_url
    || item?.website
    || '',
  )
  const evidencePayload = {
    intent: toText(state.intent || 'supplier_search'),
    generateCharts: state.generateCharts !== false,
    reportTemplateType: toText(state?.reportTemplate?.type || ''),
    userInput: state.userInput,
    supplierRows: (state.supplierRows || []).slice(0, 5).map((item) => ({
      name: resolveSupplierDisplayName(item),
      sourceUrl: resolveSupplierSourceUrl(item),
      matchScore: Number(item?._matchScore || 0),
      matchFields: Array.isArray(item?._matchFieldScores)
        ? item._matchFieldScores.slice(0, 5).map((entry) => ({
          label: toText(entry?.field).split('.').filter(Boolean).pop() || '多字段',
          relevance: Number(entry?.score || 0) >= 1.6 ? '高相关' : (Number(entry?.score || 0) >= 0.9 ? '中相关' : '低相关'),
        }))
        : [],
    })),
    kbHits: (state.kbHits || []).slice(0, 5).map((item) => ({
      docName: toText(item.docName || item.docId),
      cosineDistance: Number(item.cosineDistance || 0),
      snippet: toText(item.chunkText).slice(0, 80),
    })),
    webHits: (state.webHits || []).slice(0, 5).map((item) => ({
      title: toText(item.title || item.name || ''),
      url: toText(item.url || item.link || ''),
      snippet: toText(item.snippet || item.content || '').slice(0, 100),
    })),
  }
  try {
    const prompt = ChatPromptTemplate.fromMessages([
      ['system', '{systemPrompt}'],
      ['human', `请基于证据输出中文简洁结果，严格使用以下模板（不超过12行）：
【直接回答】先正面回答用户问题（一句话）
【结论】一句话
【意图】一句话
【命中统计】DB x条，RAG y条，WEB z条
【候选供应商Top3】每行“序号. 名称 | 理由(不超过20字)”
【下一步】1-3条可执行动作
${state?.generateCharts === false ? '【图表】不生成图表。' : '【图表】给出建议图表类型（如柱状图/雷达图）及字段。'}
${toText(state?.reportTemplate?.type) ? `【报告模板】按 ${toText(state.reportTemplate.type)} 模板组织章节。` : ''}

证据JSON：
{evidenceJson}`],
    ])

    const llm = new ChatOpenAI({
      apiKey,
      model,
      temperature: Math.max(0, Math.min(1, Number(state?.temperature ?? 0.2))),
      configuration: {
        baseURL: /\/v\d+$/i.test(baseUrl.replace(/\/+$/, '')) ? baseUrl.replace(/\/+$/, '') : `${baseUrl.replace(/\/+$/, '')}/v1`,
      },
    })

    const chain = prompt.pipe(llm)
    const result = await chain.invoke({
      systemPrompt: resolvedSystemPrompt,
      evidenceJson: JSON.stringify(evidencePayload),
    })

    const text = (() => {
      if (typeof result?.content === 'string') return toText(result.content)
      if (Array.isArray(result?.content)) {
        return result.content
          .map((part) => toText(part?.text || part?.content || (typeof part === 'string' ? part : '')))
          .filter(Boolean)
          .join('\n')
      }
      return ''
    })()
    return text
  } catch (error) {
    const errMsg = toText(error?.message || '')
    if (/not supported when using Codex with a ChatGPT account/i.test(errMsg)) return ''
    return errMsg ? `模型调用失败：${errMsg}` : ''
  }
}

function buildPreciseSourcingFallbackAnswer(state) {
  const toReadableFieldLabel = (fieldPath = '') => {
    const text = toText(fieldPath)
    if (!text) return '多字段'
    if (text.includes('business_info') && text.includes('配套客户')) return '配套客户'
    if (text.includes('company_intro')) return '公司简介'
    if (text.includes('main_products')) return '主营产品'
    if (text.includes('oem_name')) return '整车厂名称'
    if (text.includes('supplier_name')) return '供应商名称'
    const parts = text.split('.').filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : '多字段'
  }
  const toLevelText = (score = 0) => {
    const value = Number(score || 0)
    if (value >= 1.6) return '高相关'
    if (value >= 0.9) return '中相关'
    return '低相关'
  }
  const toReadableReason = (fieldPath = '', score = 0) => {
    const label = toReadableFieldLabel(fieldPath)
    const level = toLevelText(score)
    return `${label}命中（${level}）`
  }
  const resolveSupplierDisplayName = (item = {}) => toText(
    item?.companyName
    || item?.company_name
    || item?.name
    || item?.supplier_name
    || item?.oem_name
    || item?.businessEntity
    || item?.brand
    || '',
  )
  const resolveSupplierSourceUrl = (item = {}) => toText(
    item?.sourceUrl
    || item?.source_url
    || item?.detailUrl
    || item?.detail_url
    || item?.website
    || '',
  )
  const suppliers = Array.isArray(state?.supplierRows) ? state.supplierRows : []
  const kbHits = Array.isArray(state?.kbHits) ? state.kbHits : []
  const supplierTop = suppliers
    .slice(0, 3)
    .map((item, idx) => {
      const name = resolveSupplierDisplayName(item) || '未知供应商'
      const url = resolveSupplierSourceUrl(item) || '无URL'
      const reason = Array.isArray(item?._matchFieldScores) && item._matchFieldScores.length > 0
        ? toReadableReason(item._matchFieldScores[0]?.field, item._matchFieldScores[0]?.score)
        : '证据命中（中相关）'
      return `${idx + 1}. ${name}（${url}）| ${reason}`
    })
    .join('\n')
  const ragDerivedTop = kbHits
    .slice(0, 5)
    .map((item) => {
      const source = toText(item?.docName || item?.docId || item?.source || '')
      const m = source.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{4,40}(公司|集团|股份|有限|汽车|科技))/)
      return m?.[1] || ''
    })
    .filter(Boolean)
  const ragTopCandidates = Array.from(new Set(ragDerivedTop)).slice(0, 3)
  const ragTop = kbHits
    .slice(0, 5)
    .map((item, idx) => {
      const distance = Number(item?.cosineDistance || 0)
      const similarity = Math.max(0, Math.min(1, 1 - distance))
      return `${idx + 1}. ${toText(item?.docName || item?.docId || '未知文档')} | 相似度=${similarity.toFixed(4)}`
    })
    .join('\n')
  return [
    `【结论】${suppliers.length > 0 ? '已完成初筛，建议按证据相关度推进候选核验。' : '数据库未直接命中，但已从RAG提取可跟进线索。'}`,
    `【命中统计】DB ${suppliers.length}条，RAG ${kbHits.length}条`,
    '',
    '【候选供应商Top3】',
    (supplierTop || ragTopCandidates.map((name, idx) => `${idx + 1}. ${name}（来自RAG证据）`).join('\n') || '暂无（请放宽条件或关闭严格模式）'),
    '',
    '【下一步】',
    '1. 用 RAG 命中文档关键词反查供应商主数据。',
    '2. 进入准入排查补齐认证、量产、客户字段。',
    '3. 以认证完整度+相关性+可联系性输出Top10。',
    ragTop ? `\n【RAG参考】\n${ragTop}` : '',
  ].join('\n')
}

function toCompactKbHit(hit = {}) {
  const chunkText = toText(hit?.chunkText)
  return {
    id: hit?.id,
    kbId: toText(hit?.kbId),
    docId: toText(hit?.docId),
    docName: toText(hit?.docName),
    docUrl: toText(hit?.docUrl),
    chunkIndex: Number(hit?.chunkIndex || 0),
    cosineDistance: Number(hit?.cosineDistance || 0),
    euclideanDistance: Number(hit?.euclideanDistance || 0),
    sourceType: toText(hit?.sourceType),
    snippetPreview: chunkText.slice(0, 220),
    chunkText,
  }
}

const preciseSourcingLangGraph = createPreciseSourcingLangGraph({
  async classifyIntent(userInput = '') {
    const text = toText(userInput).toLowerCase()
    if (!text) return 'supplier_search'
    if (/只查数据库|仅数据库|只看数据库|db/.test(text)) return 'db_only'
    if (/只查知识库|仅知识库|只看知识库|仅rag|只用rag|rag only/.test(text)) return 'kb_qa'
    if (/报告|汇报|ppt|word|excel|模板/.test(text)) return 'report_generate'
    return 'supplier_search'
  },
  async parseDemand(userInput = '') {
    const text = toText(userInput)
    const stopWords = new Set([
      '帮我', '搜索', '查找', '寻找', '一下', '一下子', '的', '和', '与', '以及', '供应商', '配套', '企业',
      '同时', '同时也', '互联网信息', '网上信息', '网络信息', '相关信息', '资料', '线索',
    ])
    const coarse = text
      .split(/[\s,，。；;、|/]+|请|帮我|帮忙|搜索|查找|寻找|找出|匹配|推荐|筛选|关于|有关|针对|相关|以及|和|与|的|供应商|配套|企业/g)
      .map((x) => x.trim())
      .filter(Boolean)
    const orgLikeRaw = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,30}(?:集团|公司|汽车|股份|有限|科技|工业|供应链|东风|比亚迪)/g) || []
    const orgLike = orgLikeRaw
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && !/(帮我|帮忙|搜索|查找|寻找|找出|匹配|推荐|筛选)/.test(x))
    const keywords = [...new Set([...coarse, ...orgLike].filter((w) => w.length >= 2 && !stopWords.has(w)).slice(0, 12))]
    const needWebSearch = /(互联网|网上|网络|web|网页|新闻|公开信息|官网)/i.test(text)
    return {
      keywords,
      raw: text.slice(0, 800),
      needWebSearch,
    }
  },
  async searchSuppliers(userInput, authHeader = '', options = {}) {
    const dbTopK = Math.min(Math.max(Number(options?.dbTopK || 10), 1), 100)
    const selected = Array.isArray(options?.selectedDbTables) ? options.selectedDbTables.map((x) => toText(x)) : []
    const strictMode = options?.strictMode === true
    const rows = []
    try {
      const dbToolRaw = await invokeRunnableTool(preciseSourcingToolbox.byName.sqlSearchSuppliers, {
        query: toText(userInput),
        limit: dbTopK,
        selectedDbTables: Array.isArray(options?.selectedDbTables) ? options.selectedDbTables : [],
        strictMode: options?.strictMode === true,
      }, { tool: 'sql_search_suppliers' })
      const dbToolResult = normalizeToolJsonResult(dbToolRaw)
      const dbRows = Array.isArray(dbToolResult?.data?.rows) ? dbToolResult.data.rows : []
      if (dbToolResult?.ok && dbRows.length > 0) {
        rows.push(...dbRows.map((r, idx) => ({
          ...r,
          _fromTable: toText(r?._fromTable || 'supplier_base_info'),
          _rowId: toText(r?.id || r?.company_name || r?.companyName || `tool-supplier-${idx}`),
          companyName: toText(r?.company_name || r?.companyName || r?.name || r?.oem_name || ''),
          sourceUrl: toText(r?.source_url || r?.sourceUrl || r?.detail_url || r?.detailUrl || r?.website || ''),
          mainProducts: toText(r?.main_products || r?.mainProducts || ''),
          region: toText(r?.region || r?.location || ''),
        })))
      }
    } catch {
      // Toolbox DB 失败时不打断主查询链路
    }
    const queryTextRaw = toText(userInput)
    const queryText = queryTextRaw.toLowerCase()
    const stopWords = new Set(['帮我', '搜索', '查找', '寻找', '一下', '一下子', '的', '和', '与', '以及', '供应商', '配套', '企业'])
    const demandKeywords = Array.isArray(options?.demand?.keywords) ? options.demand.keywords.map((x) => toText(x)).filter(Boolean) : []
    const coarseTokens = queryTextRaw
      .split(/[\s,，。；;、|/]+|请|帮我|帮忙|搜索|查找|寻找|找出|匹配|推荐|筛选|关于|有关|针对|相关|以及|和|与|的|供应商|配套|企业/g)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && !stopWords.has(x))
    const orgLikeMatchesRaw = queryTextRaw.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,20}(?:公司|集团|汽车|科技|股份|有限|东风|比亚迪)/g) || []
    const orgLikeMatches = orgLikeMatchesRaw
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && !/(帮我|帮忙|搜索|查找|寻找|找出|匹配|推荐|筛选)/.test(x))
    const searchTerms = [...new Set([...demandKeywords, ...coarseTokens, ...orgLikeMatches])].slice(0, 10)
    const tokens = searchTerms.map((x) => x.toLowerCase())

    function quoteIdent(name = '') {
      const value = toText(name)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return ''
      return `"${value.replaceAll('"', '""')}"`
    }

    const tableAliasMap = {
      suppliers: 'supplier_base_info',
      supplier_profiles: 'supplier_profile',
      supply_chain_node: 'supply_chain_node',
      gas_supply_chain_node: 'gas_supply_chain_node',
      gas_suppliers: 'gas_supplier',
      gas_supplier_profiles: 'supplier_profile',
      gas_oems: 'gas_oem',
      inventories: 'asset_inventory',
    }

    const selectedTables = selected
      .map((value) => {
        const part = value.includes('.') ? value.split('.')[1] : value
        const key = toText(part)
        return tableAliasMap[key] || key
      })
      .filter((name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))

    let candidateTables = selectedTables
    if (candidateTables.length === 0) {
      const tableRes = await pool.query(
        `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
          AND (
            table_name ILIKE '%supplier%'
            OR table_name ILIKE '%supply%'
            OR table_name ILIKE '%oem%'
            OR table_name ILIKE '%profile%'
          )
        ORDER BY table_name ASC
        LIMIT 60
        `,
        [schemaName],
      )
      candidateTables = (tableRes.rows || []).map((r) => toText(r.table_name)).filter(Boolean)
    }
    if (candidateTables.length === 0) return []

    const colRes = await pool.query(
      `
      SELECT table_name, column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2::text[])
      ORDER BY table_name ASC, ordinal_position ASC
      `,
      [schemaName, candidateTables],
    )
    const textTypeSet = new Set(['character varying', 'text', 'json', 'jsonb', 'varchar'])
    const tableColsMap = new Map()
    for (const row of (colRes.rows || [])) {
      const tableName = toText(row.table_name)
      const colName = toText(row.column_name)
      const dataType = toText(row.data_type).toLowerCase()
      const udtName = toText(row.udt_name).toLowerCase()
      const isTextLike = textTypeSet.has(dataType) || udtName === 'json' || udtName === 'jsonb'
      if (!isTextLike) continue
      if (!tableColsMap.has(tableName)) tableColsMap.set(tableName, [])
      tableColsMap.get(tableName).push(colName)
    }

    const perTableLimit = Math.min(50, Math.max(4, Math.ceil(dbTopK / Math.max(candidateTables.length, 1)) + 3))
    for (const tableName of candidateTables) {
      const columns = (tableColsMap.get(tableName) || []).filter((c) => c)
      if (columns.length === 0) continue
      const safeSchema = quoteIdent(schemaName)
      const safeTable = quoteIdent(tableName)
      if (!safeSchema || !safeTable) continue
      const predicates = []
      const params = []
      const qVariants = (searchTerms.length > 0 ? searchTerms : [queryTextRaw]).filter(Boolean).slice(0, 8)
      for (const v of qVariants) {
        params.push(`%${v}%`)
        const p = `$${params.length}`
        const colExpr = columns
          .slice(0, 40)
          .map((col) => `${quoteIdent(col)}::text ILIKE ${p}`)
          .join(' OR ')
        if (colExpr) predicates.push(`(${colExpr})`)
      }
      if (predicates.length === 0) continue
      params.push(perTableLimit)
      const sql = `
        SELECT *
        FROM ${safeSchema}.${safeTable}
        WHERE ${predicates.join(' OR ')}
        LIMIT $${params.length}
      `
      try {
        const result = await pool.query(sql, params)
        const rowsFromTable = Array.isArray(result.rows) ? result.rows : []
        rows.push(...rowsFromTable.map((r, idx) => ({
          ...r,
          _fromTable: tableName,
          _rowId: toText(r.id || r.company_name || r.companyName || `${tableName}-${idx}`),
          companyName: toText(r.company_name || r.companyName || r.name || r.oem_name || ''),
          sourceUrl: toText(r.source_url || r.sourceUrl || r.detail_url || r.detailUrl || r.website || ''),
          mainProducts: toText(r.main_products || r.mainProducts || ''),
          region: toText(r.region || r.location || ''),
        })))
      } catch {
        continue
      }
    }
    function normalizeCompanyNameForKey(input = '') {
      return toText(input)
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[（(]/g, '(')
        .replace(/[）)]/g, ')')
        .replace(/[·•]/g, '')
        .trim()
    }

    const dedup = new Map()
    function roughContentLength(item = {}) {
      const parts = [
        item?.companyName,
        item?.mainProducts,
        item?.business_info,
        item?.company_intro,
        item?.main_products,
        item?.oem_name,
      ]
      return parts.map((x) => toText(x).length).reduce((a, b) => a + b, 0)
    }

    for (const item of rows) {
      const companyKey = normalizeCompanyNameForKey(item?.companyName || item?.company_name || item?.name || item?.supplier_name)
      const urlKey = toText(item?.sourceUrl || item?.source_url || item?.detailUrl || item?.detail_url || item?.website).trim().toLowerCase()
      const fallbackId = toText(item?.id || item?.name || item?.supplier_name || item?._rowId || Math.random())
      const key = companyKey || urlKey || fallbackId
      if (!dedup.has(key)) {
        dedup.set(key, item)
      } else {
        const prev = dedup.get(key)
        if (roughContentLength(item) > roughContentLength(prev)) dedup.set(key, item)
      }
    }
    function flattenTextFields(value, path = '', out = []) {
      if (value == null) return out
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const text = String(value).trim()
        if (text) out.push({ path: path || 'value', text })
        return out
      }
      if (Array.isArray(value)) {
        value.forEach((item, idx) => flattenTextFields(item, `${path}[${idx}]`, out))
        return out
      }
      if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (String(k).startsWith('_')) continue
          flattenTextFields(v, path ? `${path}.${k}` : k, out)
        }
      }
      return out
    }

    function scoreField(text = '') {
      const lower = toText(text).toLowerCase()
      if (!lower) return 0
      let score = 0
      for (const tk of tokens) {
        if (!tk) continue
        if (lower.includes(tk)) score += Math.max(0.8, Math.min(2.2, tk.length / 3))
      }
      if (queryText && lower.includes(queryText)) score += 3
      if (!tokens.length && queryText && lower.includes(queryText.slice(0, 8))) score += 0.5
      return score
    }

    const mapped = Array.from(dedup.values()).map((item) => {
      const fields = flattenTextFields(item)
      const scored = fields
        .map((entry) => ({ ...entry, score: scoreField(entry.text) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
      const top = scored.slice(0, 6)
      const rowScore = top.reduce((sum, entry) => sum + entry.score, 0)
      return {
        ...item,
        _matchFields: top.map((entry) => entry.path),
        _matchFieldScores: top.map((entry) => ({ field: entry.path, score: Number(entry.score.toFixed(3)) })),
        _matchScore: Number(rowScore.toFixed(3)),
      }
    })
    .sort((a, b) => Number(b._matchScore || 0) - Number(a._matchScore || 0))

    const positive = mapped.filter((item) => Number(item?._matchScore || 0) > 0)
    if (!strictMode) {
      return (positive.length > 0 ? positive : mapped).slice(0, dbTopK)
    }

    const strictThreshold = positive.length > 0
      ? Math.max(1.2, Number((positive[0]?._matchScore || 0)) * 0.25)
      : 0
    const strictFiltered = positive.filter((item) => Number(item?._matchScore || 0) >= strictThreshold)
    return (strictFiltered.length > 0 ? strictFiltered : (positive.length > 0 ? positive : mapped)).slice(0, dbTopK)
  },
  async searchRag(kbIds, userInput, topK, authHeader = '', _demand = {}, strictMode = false) {
    const targets = Array.isArray(kbIds) ? kbIds.map((x) => toText(x)).filter(Boolean) : [toText(kbIds)].filter(Boolean)
    const rows = []
    try {
      const ragToolRaw = await invokeRunnableTool(preciseSourcingToolbox.byName.ragSearchEvidence, {
        kbIds: targets,
        query: toText(userInput),
        topK: Math.min(Number(topK || 20), 20),
        strictKeyword: true,
      }, { tool: 'rag_search_evidence' })
      const ragToolResult = normalizeToolJsonResult(ragToolRaw)
      const ragHits = Array.isArray(ragToolResult?.data?.hits) ? ragToolResult.data.hits : []
      if (ragToolResult?.ok && ragHits.length > 0) {
        rows.push(...ragHits)
      }
    } catch {
      // Toolbox RAG 失败时回退到既有 HTTP 查询链路
    }
    if (rows.length > 0) return rows
    for (const kbId of targets) {
      let ragPayload = {}
      let lastError = null
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const ragResponse = await fetchByNetworkPolicy(`http://127.0.0.1:${port}/api/knowledge-bases/${encodeURIComponent(toText(kbId))}/search`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(toText(authHeader) ? { Authorization: toText(authHeader) } : {}),
            },
            body: JSON.stringify({
              query: toText(userInput),
              topK: Math.min(Number(topK || 20), 20),
              metric: 'cosine',
              strictKeyword: true,
              scoreThreshold: strictMode ? 0.45 : null,
            }),
          })
          ragPayload = await ragResponse.json().catch(() => ({}))
          if (ragResponse.ok) {
            lastError = null
            break
          }
          lastError = new Error(toText(ragPayload?.message || `RAG HTTP ${ragResponse.status}`))
        } catch (error) {
          lastError = error
        }
      }
      if (lastError) throw lastError
      const items = Array.isArray(ragPayload?.data?.results) ? ragPayload.data.results : []
      rows.push(...items)
    }
    return rows
  },
  async traceStep(step = '', payload = {}) {
    try {
      await invokeRunnableTool(preciseSourcingToolbox.byName.traceTool, { step: toText(step), payload }, { tool: 'trace_agent_step' })
    } catch {
      // ignore trace failure
    }
  },
  async fuseEvidence(state = {}) {
    const supplierRows = Array.isArray(state?.supplierRows) ? state.supplierRows : []
    const kbHits = Array.isArray(state?.kbHits) ? state.kbHits : []
    const webHits = Array.isArray(state?.webHits) ? state.webHits : []
    const llmCandidates = await extractSupplierCandidatesByLlmBatch(webHits, 6, toText(state?.model), { query: toText(state?.userInput) })
    const webSuppliers = Array.from(new Set(
      webHits
        .flatMap((item, idx) => {
          const fromLlm = Array.isArray(llmCandidates?.[idx]) ? llmCandidates[idx] : []
          const fromRule = extractSupplierCandidatesFromText(`${toText(item?.title)} ${toText(item?.snippet || item?.content)}`, 6, { query: toText(state?.userInput) })
          return [...fromLlm, ...fromRule]
        })
        .map((x) => toText(x))
        .filter(Boolean),
    ))
    const fusedSuppliers = supplierRows
      .map((row) => {
        const name = toText(
          row?.companyName
          || row?.company_name
          || row?.name
          || row?.supplier_name
          || '',
        )
        const webSupportCount = name
          ? webSuppliers.filter((candidate) => candidate.includes(name) || name.includes(candidate)).length
          : 0
        return {
          ...row,
          _webSupportCount: webSupportCount,
          _fusedScore: Number((Number(row?._matchScore || 0) + webSupportCount * 1.2).toFixed(3)),
        }
      })
      .sort((a, b) => Number(b?._fusedScore || 0) - Number(a?._fusedScore || 0))
    return {
      suppliers: fusedSuppliers.slice(0, 20),
      kbHits: kbHits.slice(0, 20),
      webHits: webHits.slice(0, 20),
      webDerivedSuppliers: webSuppliers.slice(0, 10),
    }
  },
  async searchWeb(query = '', topK = 5) {
    const raw = await invokeRunnableTool(preciseSourcingToolbox.byName.webSearchTool, {
      query: toText(query),
      topK: Math.min(Math.max(Number(topK || 5), 1), 10),
    }, { tool: 'web_search_supplier_signals' })
    const parsed = normalizeToolJsonResult(raw)
    if (!parsed?.ok) throw new Error(toText(parsed?.error || 'web_search_failed'))
    return Array.isArray(parsed?.data?.results) ? parsed.data.results : []
  },
  async generateChart(params = {}) {
    const raw = await invokeRunnableTool(preciseSourcingToolbox.byName.chartGeneratorTool, params, { tool: 'python_chart_generator' })
    const parsed = normalizeToolJsonResult(raw)
    if (!parsed?.ok) throw new Error(toText(parsed?.error || 'chart_generate_failed'))
    return parsed?.artifact || parsed?.data || parsed
  },
  async exportReport(params = {}) {
    const raw = await invokeRunnableTool(preciseSourcingToolbox.byName.fileExporterTool, params, { tool: 'file_exporter' })
    const parsed = normalizeToolJsonResult(raw)
    if (!parsed?.ok) throw new Error(toText(parsed?.error || 'file_export_failed'))
    return parsed?.artifact || parsed?.data || parsed
  },
  async generateAnswer(state) {
    let answer = await callPreciseSourcingLlm(state)
    const fallbackAnswer = buildPreciseSourcingFallbackAnswer(state)
    if (!toText(answer)) answer = fallbackAnswer
    else if (toText(answer).startsWith('模型调用失败')) answer = `${toText(answer)}\n\n${fallbackAnswer}`
    return answer
  },
})

app.post('/api/agents/precise-sourcing/chat', authMiddleware, async (req, res) => {
  const traceVersion = 'ps-v20260506-04'
  const owner = toText(req.authUser?.userName || req.authUser?.username || 'unknown')
  const userInput = toText(req.body?.message)
  const authHeader = toText(req.headers.authorization)
  const kbIdInput = toText(req.body?.kbId)
  const kbIdsInput = Array.isArray(req.body?.kbIds) ? req.body.kbIds.map((x) => toText(x)).filter(Boolean) : []
  const selectedDbTables = Array.isArray(req.body?.selectedDbTables) ? req.body.selectedDbTables.map((x) => toText(x)).filter(Boolean) : []
  const selectedToolsRaw = Array.isArray(req.body?.selectedTools)
    ? req.body.selectedTools.map((x) => toText(x)).filter(Boolean)
    : []
  const selectedSkillsRaw = Array.isArray(req.body?.selectedSkills)
    ? req.body.selectedSkills.map((x) => toText(x)).filter(Boolean)
    : []
  const selectedTools = [...new Set([...selectedToolsRaw, ...selectedSkillsRaw])]
  const topK = Math.min(Math.max(Number(req.body?.topK || 20), 5), 50)
  const dbTopK = Math.min(Math.max(Number(req.body?.dbTopK || 10), 1), 100)
  const generateCharts = req.body?.generateCharts !== false
  const temperature = Math.max(0, Math.min(1, Number(req.body?.temperature ?? 0.2)))
  const reportTemplate = req.body?.reportTemplate && typeof req.body.reportTemplate === 'object' ? req.body.reportTemplate : null
  const strictMode = req.body?.strictMode === true
  const selectedModel = toText(req.body?.model)
  const systemPrompt = toText(req.body?.systemPrompt)
  const systemPromptPresetKey = toText(req.body?.systemPromptPresetKey || 'default')
  if (!userInput) {
    return res.status(400).json({ code: 400, message: '缺少参数：message', data: null })
  }
  const toolCatalog = getLangchainToolCatalog()
  const allowedToolKeys = new Set(toolCatalog.map((item) => item.key))
  const unavailableTools = selectedTools.filter((key) => {
    const item = toolCatalog.find((tool) => tool.key === key)
    return item && item.available === false
  })
  const invalidTools = selectedTools.filter((key) => !allowedToolKeys.has(key))
  if (invalidTools.length > 0) {
    return res.status(400).json({ code: 400, message: `存在未知工具: ${invalidTools.join(', ')}`, data: null })
  }
  if (unavailableTools.length > 0) {
    const reasonMap = new Map(toolCatalog.map((item) => [item.key, item.reason || '工具当前不可用']))
    const reasonText = unavailableTools.map((key) => `${key}(${reasonMap.get(key) || '不可用'})`).join(', ')
    return res.status(400).json({ code: 400, message: `所选工具不可用: ${reasonText}`, data: null })
  }
  const targetKbId = kbIdInput || kbIdsInput[0] || toText(knowledgeBaseStore.keys().next()?.value)
  const targetKbIds = kbIdsInput.length > 0 ? kbIdsInput : (targetKbId ? [targetKbId] : [])

  try {
    const graphResult = await preciseSourcingLangGraph.run({
      userInput,
      authHeader,
      kbId: targetKbId || '',
      kbIds: targetKbIds,
      topK: Math.min(topK, 20),
      dbTopK,
      selectedDbTables,
      strictMode,
      selectedSkills: selectedTools,
      selectedTools,
      model: selectedModel,
      systemPrompt,
      systemPromptPresetKey,
      generateCharts,
      temperature,
      reportTemplate,
    })
    const payload = await buildPreciseSourcingResponsePayload({
      graphResult,
      traceVersion,
      userInput,
      selectedTools,
      targetKbId,
      targetKbIds,
      selectedDbTables,
      reportTemplate,
      modelName: selectedModel,
    })
    await persistPreciseSourcingRun({
      owner,
      userInput,
      payload,
      selectedTools,
      targetKbIds,
      selectedDbTables,
      modelName: selectedModel,
    }).catch(() => {})
    return res.json({
      code: 200,
      message: 'success',
      data: payload,
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `精准寻源智能体执行失败: ${error.message}`, data: null })
  }
})

function normalizeImageDataUrl(input) {
  const value = toText(input)
  if (!value) return ''
  const ok = /^data:image\/(png|jpeg|jpg|gif|webp|bmp);base64,[a-z0-9+/=\r\n]+$/i.test(value)
  return ok ? value : ''
}

async function invokeRunnableTool(tool, input, metadata = {}) {
  if (!tool || typeof tool.invoke !== 'function') {
    throw new Error(`tool_not_invokable:${toText(metadata?.tool || 'unknown')}`)
  }
  try {
    if (typeof tool.withRetry === 'function') {
      return await tool
        .withRetry({
          stopAfterAttempt: 2,
        })
        .withConfig({
          tags: ['precise-sourcing', 'tool'],
          metadata,
        })
        .invoke(input)
    }
  } catch {
    // fallback to plain invoke
  }
  return await tool.invoke(input)
}

function parsePreciseSourcingStructuredOutput(answer = '') {
  const text = toText(answer)
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const pickAfter = (label) => {
    const row = lines.find((line) => line.startsWith(label))
    return row ? toText(row.replace(label, '')) : ''
  }
  const top3 = lines
    .filter((line) => /^\d+\.\s/.test(line))
    .slice(0, 5)
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
  const riskLevel = (() => {
    const low = text.match(/(低风险|低)/)
    const high = text.match(/(高风险|高)/)
    const mid = text.match(/(中风险|中)/)
    if (high) return 'high'
    if (mid) return 'medium'
    if (low) return 'low'
    return ''
  })()
  return {
    summary: pickAfter('【结论】') || pickAfter('结论：'),
    directAnswer: pickAfter('【直接回答】') || '',
    intent: pickAfter('【意图】') || '',
    riskLevel,
    topCandidates: top3,
    nextSteps: lines.filter((line) => /^(\d+\.)/.test(line)).slice(0, 3),
    rawText: text,
  }
}

function extractSupplierCandidatesFromText(text = '', limit = 5, options = {}) {
  const content = toText(text)
  if (!content) return []
  const queryText = toText(options?.query || '')
  const queryTargets = Array.from(new Set(
    queryText
      .split(/[\s,，。；;、|/]+|请|帮我|帮忙|搜索|查找|寻找|找出|匹配|推荐|筛选|关于|有关|针对|相关|以及|和|与|的|供应商|配套|企业/g)
      .map((x) => toText(x))
      .filter((x) => x.length >= 2),
  ))
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,40}(?:股份有限公司|有限责任公司|有限公司|集团有限公司|集团|公司))/g
  const stopPrefix = /^(在|还在|并在|并于|尽管|同时|预计|预测|此外|另外|其中|以及|与|和|对|将|已|为|被|由|于|至于|关于)/
  const stopContains = /(公告|新闻|财经|报道|日讯|今日|昨日|今年|明年|季度|年度|项目|合作|会议|发布|消息|称|表示|指出|认为|证券|银行|保险|基金|期货|交易所|传媒|电视台|报社|研究院|人民政府|委员会|合计|控制公司|截至|万元|亿元|月公司|年公司)/
  const invalidChars = /[\s"'“”‘’《》【】\[\]{}<>|/\\]/
  const normalizeCompany = (raw = '') => toText(raw)
    .replace(/[，,。；;:：、!！?？]+$/g, '')
    .replace(/^[：:，,。；;、\-\s]+/g, '')
    .trim()
  const isValidCompany = (name = '') => {
    const value = normalizeCompany(name)
    if (!value) return false
    if (value.length < 4 || value.length > 36) return false
    if (invalidChars.test(value)) return false
    if (stopPrefix.test(value)) return false
    if (stopContains.test(value)) return false
    if (!/(股份有限公司|有限责任公司|有限公司|集团有限公司|集团|公司)$/.test(value)) return false
    if (/(供应商|互联网|证券|首页|点击|http|www\.)/i.test(value)) return false
    if (queryTargets.some((target) => target && value.includes(target) && value.length <= target.length + 4)) return false
    if (/(汽车股份有限公司|汽车集团有限公司|汽车有限公司)$/.test(value) && queryTargets.some((target) => value.includes(target))) return false
    return true
  }
  const list = []
  const seen = new Set()
  let match = null
  while ((match = pattern.exec(content)) !== null) {
    const name = normalizeCompany(match?.[1] || '')
    if (!isValidCompany(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    list.push(name)
    if (list.length >= Math.max(1, Number(limit || 5))) break
  }
  return list
}

async function extractSupplierCandidatesByLlmBatch(items = [], perItemLimit = 5, modelName = '', options = {}) {
  const rows = Array.isArray(items) ? items : []
  if (rows.length === 0) return []
  const apiKey = toText(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.QWEN_API_KEY)
  if (!apiKey) return []
  const baseUrl = toText(process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com')
  const model = toText(modelName || process.env.LANGCHAIN_CHAT_MODEL || process.env.OPENAI_CHAT_MODEL || process.env.DEFAULT_LLM_MODEL || 'gpt-4.1-mini')
  const apiBase = /\/v\d+$/i.test(baseUrl.replace(/\/+$/, '')) ? baseUrl.replace(/\/+$/, '') : `${baseUrl.replace(/\/+$/, '')}/v1`
  const queryText = toText(options?.query || '')
  const packed = rows.slice(0, 8).map((row, idx) => ({
    index: idx,
    title: toText(row?.title || row?.name || ''),
    snippet: toText(row?.snippet || row?.content || '').slice(0, 400),
    url: toText(row?.url || row?.link || ''),
  }))
  const prompt = [
    '你是企业实体抽取器。目标：从每条文本中抽取“供应商企业名称”。',
    '规则：',
    '1) 只返回公司/集团等组织实体，不要返回句子片段。',
    '2) 排除媒体、证券、金融机构、政府机构、整车厂名称本体。',
    '3) 单条最多返回 5 个。',
    '4) 若无可用实体返回空数组。',
    '5) 仅输出 JSON，格式：{"items":[{"index":0,"companies":["A公司","B有限公司"]}]}',
    '',
    `用户查询：${queryText}`,
    `输入：${JSON.stringify(packed)}`,
  ].join('\n')
  try {
    const resp = await fetchByNetworkPolicy(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: '你只输出JSON，不要解释。' },
          { role: 'user', content: prompt },
        ],
      }),
    })
    const payload = await resp.json().catch(() => ({}))
    if (!resp.ok) return []
    const raw = toText(payload?.choices?.[0]?.message?.content || '')
    const first = raw.indexOf('{')
    const last = raw.lastIndexOf('}')
    if (first < 0 || last <= first) return []
    const obj = JSON.parse(raw.slice(first, last + 1))
    const itemRows = Array.isArray(obj?.items) ? obj.items : []
    const result = Array.from({ length: packed.length }, () => [])
    for (const row of itemRows) {
      const idx = Number(row?.index)
      if (!Number.isInteger(idx) || idx < 0 || idx >= result.length) continue
      const arr = Array.isArray(row?.companies) ? row.companies : []
      result[idx] = arr.map((x) => toText(x)).filter(Boolean).slice(0, Math.max(1, Number(perItemLimit || 5)))
    }
    return result
  } catch {
    return []
  }
}

function toLangchainMessages(history = [], userMessage = '', userImageDataUrl = '') {
  const mapped = Array.isArray(history)
    ? history
      .filter((item) => item && typeof item === 'object')
      .slice(-16)
      .map((item) => {
        const role = toText(item.role) === 'assistant' ? 'assistant' : 'user'
        const content = toText(item.content)
        const imageDataUrl = normalizeImageDataUrl(item.imageDataUrl)
        if (role === 'user' && imageDataUrl) {
          return {
            role,
            content: [
              ...(content ? [{ type: 'text', text: content }] : []),
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          }
        }
        return { role, content }
      })
      .filter((item) => (Array.isArray(item.content) ? item.content.length > 0 : Boolean(item.content)))
    : []
  const current = toText(userMessage)
  const currentImage = normalizeImageDataUrl(userImageDataUrl)
  if (current || currentImage) {
    if (currentImage) {
      mapped.push({
        role: 'user',
        content: [
          ...(current ? [{ type: 'text', text: current }] : []),
          { type: 'image_url', image_url: { url: currentImage } },
        ],
      })
    } else {
      mapped.push({ role: 'user', content: current })
    }
  }
  return mapped.length > 0 ? mapped : [{ role: 'user', content: current || '你好' }]
}

const langchainModelCatalog = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2']

async function fetchLangchainModelCatalog() {
  const codexConfigPath = 'C:\\Users\\aoyon\\.codex\\config.toml'
  try {
    const text = await fs.readFile(codexConfigPath, 'utf8')
    const defaults = []
    for (const match of String(text || '').matchAll(/^\s*model\s*=\s*"([^"]+)"\s*$/gim)) {
      const name = toText(match?.[1])
      if (name) defaults.push(name)
    }
    const merged = [...new Set([...defaults, ...langchainModelCatalog])]
    return {
      platform: 'codex-local',
      models: merged,
    }
  } catch {
    return { platform: 'codex-local', models: langchainModelCatalog }
  }
}

const preciseSourcingToolbox = buildLangChainToolbox({
  pool,
  schemaName,
  async knowledgeBaseSearch({ kbIds = [], query = '', topK = 8, strictKeyword = true }) {
    const targets = Array.isArray(kbIds) ? kbIds.map((x) => toText(x)).filter(Boolean) : []
    const rows = []
    for (const kbId of targets) {
      const kb = knowledgeBaseStore.get(toText(kbId))
      if (!kb) continue
      const hits = await searchKnowledgeBaseRecords(kb, query, topK, {
        metric: 'cosine',
        strictKeyword,
      })
      rows.push(...hits.map((item) => ({
        id: item.id,
        kbId: item.kbId,
        docId: item.docId,
        docName: item.name,
        docUrl: item.url,
        chunkIndex: item.chunkIndex,
        cosineDistance: Number(item.score || 0),
        chunkText: item.content,
        sourceType: item.sourceType || '',
      })))
    }
    return rows
  },
  async webSearch({ query = '', topK = 5 }) {
    const apiKey = toText(process.env.TAVILY_API_KEY)
    if (!apiKey) throw new Error('TAVILY_API_KEY 未配置')
    const response = await fetchByNetworkPolicy('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: toText(query),
        max_results: Math.min(Math.max(Number(topK || 5), 1), 10),
        topic: 'general',
        search_depth: 'advanced',
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(toText(payload?.error || payload?.message || `Tavily HTTP ${response.status}`))
    }
    const results = Array.isArray(payload?.results) ? payload.results : []
    return results.map((item) => ({
      title: toText(item?.title),
      url: toText(item?.url),
      snippet: toText(item?.content || ''),
      score: Number(item?.score || 0),
    }))
  },
  async trace({ step, payload }) {
    console.log(`[precise-sourcing.trace] ${toText(step)}`, payload || {})
  },
  async generateChart({ chartType, title, labels, values }) {
    return await generateSourcingChartFile({ chartType, title, labels, values })
  },
  async exportFile({ format, title, rows, summary }) {
    return await exportSourcingFile({ format, title, rows, summary })
  },
})

async function buildPreciseSourcingResponsePayload({
  graphResult,
  traceVersion,
  userInput,
  selectedTools,
  targetKbId,
  targetKbIds,
  selectedDbTables,
  reportTemplate,
  modelName,
}) {
  const safeSuppliers = toJsonSafe(Array.isArray(graphResult.supplierRows) ? graphResult.supplierRows.slice(0, 20) : [])
  const safeKbHits = toJsonSafe(
    Array.isArray(graphResult.kbHits)
      ? graphResult.kbHits.slice(0, 20).map((item) => toCompactKbHit(item))
      : [],
  )
  const rawWebHits = (Array.isArray(graphResult.webHits) ? graphResult.webHits : []).slice(0, 20)
  const llmCandidates = await extractSupplierCandidatesByLlmBatch(rawWebHits, 5, toText(modelName), { query: toText(userInput) })
  const safeWebHits = toJsonSafe(
    rawWebHits.map((item, idx) => {
      const title = toText(item?.title || item?.name || '')
      const snippet = toText(item?.snippet || item?.content || '')
      const fromLlm = Array.isArray(llmCandidates?.[idx]) ? llmCandidates[idx] : []
      const fromRule = extractSupplierCandidatesFromText(`${title} ${snippet}`, 5, { query: toText(userInput) })
      const suppliers = Array.from(new Set([...fromLlm, ...fromRule].map((x) => toText(x)).filter(Boolean))).slice(0, 5)
      return {
        ...item,
        supplierCandidates: suppliers,
      }
    }),
  )
  const webDerivedSuppliers = Array.from(new Set(
    (Array.isArray(safeWebHits) ? safeWebHits : [])
      .flatMap((item) => (Array.isArray(item?.supplierCandidates) ? item.supplierCandidates : []))
      .map((x) => toText(x))
      .filter(Boolean),
  )).slice(0, 10)
  const tracesWithVersion = Array.isArray(graphResult.traces)
    ? graphResult.traces.map((item) => ({ ...item, traceVersion }))
    : []
  const artifacts = Array.isArray(graphResult.artifacts) ? graphResult.artifacts : []
  const structured = parsePreciseSourcingStructuredOutput(toText(graphResult.answer))
  const queryStatements = {
    orchestration: {
      selectedTools,
      selectedKbIds: targetKbIds,
      selectedDbTables: Array.isArray(selectedDbTables) ? selectedDbTables : [],
      reportTemplateType: toText(reportTemplate?.type || 'none'),
    },
    db: {
      keyword: toText(graphResult?.executionPlan?.dbQuery || userInput),
      template: 'SELECT * FROM <schema>.<selected_table> AS t WHERE to_jsonb(t)::text ILIKE %keyword% LIMIT <n>',
      selectedTables: Array.isArray(selectedDbTables) ? selectedDbTables : [],
    },
    rag: {
      keyword: toText(graphResult?.executionPlan?.ragQuery || userInput),
      endpoint: '/api/knowledge-bases/:id/search',
    },
    web: {
      keyword: toText(graphResult?.executionPlan?.webQuery || ''),
      provider: 'tavily',
    },
    fusion: {
      strategy: '按相关度聚合DB/RAG/WEB并去重，保留Top证据',
      dbHits: Array.isArray(safeSuppliers) ? safeSuppliers.length : 0,
      ragHits: Array.isArray(safeKbHits) ? safeKbHits.length : 0,
      webHits: Array.isArray(safeWebHits) ? safeWebHits.length : 0,
      webDerivedSuppliers,
    },
  }
  return {
    traceVersion,
    agent: 'precise-sourcing',
    kbId: targetKbId || '',
    kbIds: targetKbIds,
    intent: toText(graphResult.intent || 'supplier_search'),
    demand: graphResult.demand || {},
    answer: toText(graphResult.answer),
    structured,
    queryStatements,
    traces: tracesWithVersion,
    react: graphResult.react || { rounds: [] },
    artifacts,
    evidence: {
      suppliers: safeSuppliers,
      kbHits: safeKbHits,
      webHits: safeWebHits,
      webDerivedSuppliers,
    },
  }
}

async function persistPreciseSourcingRun({
  owner = '',
  userInput = '',
  payload = {},
  selectedTools = [],
  targetKbIds = [],
  selectedDbTables = [],
  modelName = '',
} = {}) {
  const safeOwner = toText(owner || 'unknown')
  const safePayload = payload && typeof payload === 'object' ? payload : {}
  await pool.query(
    `
    INSERT INTO ${preciseSourcingRunTable}
    (owner, trace_version, user_input, selected_tools, selected_kb_ids, selected_db_tables, model_name, answer, query_statements, evidence, traces, react, artifacts, created_at)
    VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,NOW())
    `,
    [
      safeOwner,
      toText(safePayload.traceVersion),
      toText(userInput),
      JSON.stringify(Array.isArray(selectedTools) ? selectedTools : []),
      JSON.stringify(Array.isArray(targetKbIds) ? targetKbIds : []),
      JSON.stringify(Array.isArray(selectedDbTables) ? selectedDbTables : []),
      toText(modelName),
      toText(safePayload.answer),
      JSON.stringify(safePayload.queryStatements || {}),
      JSON.stringify(safePayload.evidence || {}),
      JSON.stringify(Array.isArray(safePayload.traces) ? safePayload.traces : []),
      JSON.stringify(safePayload.react || {}),
      JSON.stringify(Array.isArray(safePayload.artifacts) ? safePayload.artifacts : []),
    ],
  )
}

async function callLangchainCompatibleChat(messages, options = {}) {
  const apiKey = toText(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.CODEX_API_KEY)
  const baseUrl = toText(process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com')
  const requestedModel = toText(options.model)
  const envDefaultModel = toText(process.env.LANGCHAIN_CHAT_MODEL || process.env.OPENAI_MODEL)
  const modelCandidates = [...new Set([
    requestedModel,
    envDefaultModel,
    ...langchainModelCatalog,
    'gpt-5.3-codex',
    'gpt-5.5',
  ].filter(Boolean))]
  const model = modelCandidates[0] || 'gpt-5.3-codex'
  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.3
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY/LLM_API_KEY，无法调用 LangChain 对话模型')
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const apiBase = /\/v\d+$/i.test(normalizedBase) ? normalizedBase : `${normalizedBase}/v1`
  let response = null
  let usedModel = model
  let lastErrorText = ''
  for (const candidate of modelCandidates) {
    response = await fetchByNetworkPolicy(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: candidate,
        messages,
        temperature,
      }),
    })
    if (response.ok) {
      usedModel = candidate
      break
    }
    const text = await response.text().catch(() => '')
    lastErrorText = text
    const unsupportedByAccount = /not supported when using Codex with a ChatGPT account/i.test(text)
    if (!unsupportedByAccount) {
      throw new Error(`模型调用失败（HTTP ${response.status}）${text ? `: ${text.slice(0, 240)}` : ''}`)
    }
  }
  if (!response || !response.ok) {
    const status = response?.status || 500
    throw new Error(`模型调用失败（HTTP ${status}）${lastErrorText ? `: ${lastErrorText.slice(0, 240)}` : ''}`)
  }
  const contentType = toText(response.headers.get('content-type')).toLowerCase()
  if (!contentType.includes('application/json')) {
    const raw = await response.text().catch(() => '')
    throw new Error(`模型接口返回非JSON内容（base=${apiBase}）。请检查 OPENAI_BASE_URL 是否为 API 地址。片段: ${raw.slice(0, 120)}`)
  }
  const payload = await response.json().catch(() => ({}))
  const first = payload?.choices?.[0]?.message
  let answer = toText(first?.content)
  if (!answer && Array.isArray(first?.content)) {
    answer = first.content
      .map((part) => toText(part?.text || part?.content || (typeof part === 'string' ? part : '')))
      .filter(Boolean)
      .join('\n')
  }
  if (!answer) {
    answer = toText(payload?.choices?.[0]?.text)
  }
  if (!answer) {
    answer = '模型已返回，但当前响应无可解析文本内容。请尝试切换模型或降低复杂度后重试。'
  }
  return { answer, raw: payload, modelRequested: usedModel, modelReturned: toText(payload?.model), apiBase }
}

async function callLangchainImageGeneration(prompt = '', options = {}) {
  const apiKey = toText(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.CODEX_API_KEY)
  const baseUrl = toText(process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com')
  const requestedModel = toText(options.imageModel || options.model)
  const configuredImageModel = toText(process.env.LANGCHAIN_IMAGE_MODEL || 'gpt-image-1')
  const imageModel = /image|dall-e|gpt-image/i.test(requestedModel) ? requestedModel : configuredImageModel
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY/LLM_API_KEY，无法调用图片生成模型')
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const apiBase = /\/v\d+$/i.test(normalizedBase) ? normalizedBase : `${normalizedBase}/v1`
  const response = await fetchByNetworkPolicy(`${apiBase}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: imageModel,
      prompt: toText(prompt),
      size: '1024x1024',
    }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`图片生成失败（HTTP ${response.status}）${text ? `: ${text.slice(0, 240)}` : ''}`)
  }
  const payload = await response.json().catch(() => ({}))
  const item = Array.isArray(payload?.data) ? payload.data[0] : null
  const imageUrl = toText(item?.url)
  const imageB64 = toText(item?.b64_json)
  if (imageUrl) {
    return { imageUrl, apiBase, model: imageModel }
  }
  if (imageB64) {
    return { imageUrl: `data:image/png;base64,${imageB64}`, apiBase, model: imageModel }
  }
  throw new Error('图片生成接口未返回可用图片地址')
}

const LangchainShellState = Annotation.Root({
  history: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  message: Annotation({ reducer: (_x, y) => y, default: () => '' }),
  imageDataUrl: Annotation({ reducer: (_x, y) => y, default: () => '' }),
  model: Annotation({ reducer: (_x, y) => y, default: () => '' }),
  imageModel: Annotation({ reducer: (_x, y) => y, default: () => 'gpt-image-1' }),
  temperature: Annotation({ reducer: (_x, y) => y, default: () => 0.3 }),
  systemMessage: Annotation({ reducer: (_x, y) => y, default: () => '' }),
  useAgent: Annotation({ reducer: (_x, y) => y, default: () => false }),
  useMcp: Annotation({ reducer: (_x, y) => y, default: () => false }),
  selectedTools: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  messages: Annotation({ reducer: (_x, y) => y, default: () => [] }),
  answer: Annotation({ reducer: (_x, y) => y, default: () => '' }),
  modelRequested: Annotation({ reducer: (_x, y) => y, default: () => '' }),
  modelReturned: Annotation({ reducer: (_x, y) => y, default: () => '' }),
  apiBase: Annotation({ reducer: (_x, y) => y, default: () => '' }),
})

function createLangchainShellGraph() {
  const graph = new StateGraph(LangchainShellState)
    .addNode('prepare', async (state) => {
      const selectedTools = Array.isArray(state.selectedTools)
        ? state.selectedTools.map((item) => toText(item)).filter(Boolean).slice(0, 20)
        : []
      const useAgent = Boolean(state.useAgent)
      const useMcp = Boolean(state.useMcp)
      const toolHint = selectedTools.length > 0
        ? `\\n\\n[运行参数]\\n- useAgent: ${useAgent}\\n- useMcp: ${useMcp}\\n- selectedTools: ${selectedTools.join(', ')}`
        : ''
      const messages = toLangchainMessages(state.history, state.message, state.imageDataUrl)
      if (toText(state.systemMessage)) {
        messages.unshift({ role: 'system', content: toText(state.systemMessage) })
      }
      if (useAgent && selectedTools.includes('web_search')) {
        try {
          const tavilyKey = await resolveTavilyApiKey({})
          const keyword = toText(state.message)
          const rows = await searchViaTavily(keyword, tavilyKey)
          const relevantRows = (Array.isArray(rows) ? rows : [])
            .map((item) => {
              const merged = `${toText(item?.title)} ${toText(item?.summary || item?.snippet)} ${toText(item?.href)}`
              const score = scoreRelevance(toText(item?.title), `${toText(item?.summary || item?.snippet)}`, keyword)
              const catlBoost = containsCatlIntent(keyword) && containsCatlIntent(merged)
              return { ...item, _agentScore: score + (catlBoost ? 3 : 0) }
            })
            .filter((item) => Number(item._agentScore || 0) > 0)
            .sort((a, b) => Number(b._agentScore || 0) - Number(a._agentScore || 0))
          if (relevantRows.length > 0) {
            const snippetText = relevantRows
              .slice(0, 5)
              .map((item, idx) => {
                const title = toText(item?.title) || '未命名结果'
                const href = toText(item?.href) || '-'
                const summary = compactText(toText(item?.summary || item?.snippet), 180)
                return `${idx + 1}. ${title}\\nURL: ${href}\\n摘要: ${summary}`
              })
              .join('\\n\\n')
            messages.unshift({
              role: 'system',
              content: `以下是“互联网搜索”实时结果（请优先基于这些结果回答，并在结论后附来源URL）：\\n\\n${snippetText}`,
            })
          } else {
            messages.unshift({
              role: 'system',
              content: '互联网搜索已执行，但未返回有效结果。请明确告知用户“本次搜索无命中”，并建议换关键词重试。',
            })
          }
        } catch (error) {
          messages.unshift({
            role: 'system',
            content: `互联网搜索执行失败：${toText(error?.message)}。请明确告知用户搜索失败原因，不要伪造实时结果。`,
          })
        }
      }
      if (toolHint) {
        messages.push({ role: 'system', content: `请参考如下工具策略进行回答（若无工具能力可直说）：${toolHint}` })
      }
      return { messages }
    })
    .addNode('call_model', async (state) => {
      const selectedTools = Array.isArray(state.selectedTools)
        ? state.selectedTools.map((item) => toText(item)).filter(Boolean)
        : []
      const shouldUseImageGen = Boolean(state.useAgent)
        && selectedTools.includes('image_gen')
        && !/(不要出图|不用出图|仅文本|只要提示词|不要图片)/i.test(toText(state.message))
      if (shouldUseImageGen) {
        const image = await callLangchainImageGeneration(toText(state.message), { model: state.model, imageModel: state.imageModel })
        const answer = [
          '已为你生成图片：',
          `![generated-image](${image.imageUrl})`,
          '',
          `图片模型：${image.model}`,
        ].join('\n')
        return {
          answer,
          modelRequested: image.model,
          modelReturned: image.model,
          apiBase: image.apiBase,
        }
      }
      const result = await callLangchainCompatibleChat(state.messages, {
        model: state.model,
        temperature: state.temperature,
      })
      return {
        answer: result.answer || '',
        modelRequested: result.modelRequested || '',
        modelReturned: result.modelReturned || '',
        apiBase: result.apiBase || '',
      }
    })
    .addEdge(START, 'prepare')
    .addEdge('prepare', 'call_model')
    .addEdge('call_model', END)
  return graph.compile()
}

const langchainShellGraph = createLangchainShellGraph()

function normalizeLangchainSessionState(input = {}) {
  const toJsonSafe = (value, fallback) => {
    try {
      const text = JSON.stringify(value)
      if (typeof text !== 'string') return fallback
      return JSON.parse(text)
    } catch {
      return fallback
    }
  }
  const normalizeSessionMessage = (msg = {}) => {
    const role = toText(msg.role) === 'assistant' ? 'assistant' : 'user'
    const content = toText(msg.content)
    const imageDataUrl = normalizeImageDataUrl(msg.imageDataUrl)
    const normalized = { role, content, imageDataUrl }
    if (role === 'assistant') {
      normalized.ts = Number.isFinite(Number(msg.ts)) ? Number(msg.ts) : Date.now()
      normalized.rawAnswer = toText(msg.rawAnswer)
      normalized.intent = toText(msg.intent)
      normalized.traceVersion = toText(msg.traceVersion)
      normalized.selectedTools = Array.isArray(msg.selectedTools) ? msg.selectedTools.map((x) => toText(x)).filter(Boolean).slice(0, 50) : []
      normalized.evidence = toJsonSafe(msg.evidence, { suppliers: [], kbHits: [], webHits: [] })
      normalized.artifacts = Array.isArray(msg.artifacts) ? toJsonSafe(msg.artifacts, []).slice(0, 50) : []
      normalized.queryStatements = toJsonSafe(msg.queryStatements, {})
      normalized.traces = Array.isArray(msg.traces) ? toJsonSafe(msg.traces, []).slice(0, 200) : []
      normalized.react = toJsonSafe(msg.react, { rounds: [] })
    } else {
      normalized.ts = Number.isFinite(Number(msg.ts)) ? Number(msg.ts) : Date.now()
    }
    return normalized
  }
  const rawSessions = Array.isArray(input?.sessions) ? input.sessions : []
  const sessions = rawSessions
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: toText(item.name).slice(0, 120),
      messages: Array.isArray(item.messages)
        ? item.messages
          .filter((msg) => msg && typeof msg === 'object')
          .map((msg) => normalizeSessionMessage(msg))
          .slice(-200)
        : [],
    }))
    .filter((item) => item.name)
    .slice(0, 100)
  const fallback = sessions.length > 0 ? sessions[0].name : 'default'
  const requestedCurrent = toText(input?.currentSession)
  const exists = sessions.some((item) => item.name === requestedCurrent)
  const currentSession = exists ? requestedCurrent : fallback
  return {
    sessions: sessions.length > 0 ? sessions : [{ name: 'default', messages: [] }],
    currentSession,
  }
}

function normalizeLangchainChatType(input = '') {
  const value = toText(input).toLowerCase()
  if (value === 'precise_sourcing') return 'precise_sourcing'
  if (value === 'rag_chat') return 'rag_chat'
  return 'multi_chat'
}

async function searchKnowledgeBaseRecords(kb, queryText = '', topK = 8, options = {}) {
  const metric = toText(options.metric).toLowerCase() === 'euclidean' ? 'euclidean' : 'cosine'
  const strictKeyword = options.strictKeyword !== false
  const perDocLimit = Math.max(1, Number(options.perDocLimit || 6))
  const scoreThresholdRaw = Number(options.scoreThreshold)
  const hasScoreThreshold = Number.isFinite(scoreThresholdRaw)
  const scoreThreshold = hasScoreThreshold ? Math.max(0, Math.min(2, scoreThresholdRaw)) : null
  const safeTopK = Math.min(Math.max(Number(topK || kb?.config?.topK || 8), 1), 200)
  const candidateK = Math.min(Math.max(safeTopK * 8, 80), 500)
  const queryVector = await embedTextByProvider(
    queryText,
    resolveKnowledgeBaseEmbeddingModel(kb),
    knowledgeVectorStoreDim,
  )
  const queryVectorLiteral = toPgVectorLiteral(queryVector)
  const orderExpr = metric === 'euclidean' ? 'embedding <-> $3::vector' : 'embedding <=> $3::vector'
  const rowsRes = await pool.query(
    `
    SELECT
      v.id,
      v.kb_id AS "kbId",
      v.doc_id AS "docId",
      v.chunk_index AS "chunkIndex",
      v.chunk_text AS "chunkText",
      d.source_type AS "sourceType",
      d.name AS "docName",
      d.url AS "docUrl",
      (v.embedding <=> $3::vector) AS "cosineDistance",
      (v.embedding <-> $3::vector) AS "euclideanDistance"
    FROM ${knowledgeBaseVectorTable} v
    LEFT JOIN ${knowledgeBaseDocumentTable} d ON d.id = v.doc_id
    WHERE v.kb_id = $1 AND embedding IS NOT NULL
    ORDER BY ${orderExpr} ASC
    LIMIT $2
    `,
    [toText(kb?.id), candidateK, queryVectorLiteral],
  )
  const tokens = queryText
    .split(/[\s,，。；;、|]+/g)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 2)
  const ranked = (rowsRes.rows || [])
    .map((row) => {
      const content = toText(row.chunkText)
      const lower = content.toLowerCase()
      const tokenHits = tokens.filter((token) => lower.includes(token)).length
      const cosineDistance = Number(row.cosineDistance || 0)
      const euclideanDistance = Number(row.euclideanDistance || 0)
      const score = metric === 'euclidean' ? euclideanDistance : cosineDistance
      return {
        id: toText(row.id),
        kbId: toText(row.kbId),
        docId: toText(row.docId),
        chunkIndex: Number(row.chunkIndex || 0),
        content,
        sourceType: toText(row.sourceType),
        name: toText(row.docName),
        url: toText(row.docUrl),
        score,
        tokenHits,
      }
    })
    .filter((item) => (!strictKeyword || tokens.length === 0 || item.tokenHits > 0))
    .filter((item) => (hasScoreThreshold ? item.score <= scoreThreshold : true))
    .sort((a, b) => Number(a.score) - Number(b.score))

  const picked = []
  const docCounts = new Map()
  for (const item of ranked) {
    const key = toText(item.docId)
    const used = Number(docCounts.get(key) || 0)
    if (used >= perDocLimit) continue
    picked.push(item)
    docCounts.set(key, used + 1)
    if (picked.length >= safeTopK) break
  }
  return picked
}

app.get('/api/langchain/session-state', authMiddleware, async (req, res) => {
  const owner = toText(req.authUser?.userName || req.authUser?.username || 'unknown')
  const chatType = normalizeLangchainChatType(req.query?.chatType)
  try {
    const result = await pool.query(
      `SELECT sessions_json, current_session FROM ${langchainSessionStateTable} WHERE owner = $1 AND chat_type = $2 LIMIT 1`,
      [owner, chatType],
    )
    if (result.rowCount === 0) {
      return res.json({
        code: 200,
        message: 'success',
        data: { sessions: [{ name: 'default', messages: [] }], currentSession: 'default' },
      })
    }
    const payload = normalizeLangchainSessionState({
      sessions: result.rows[0]?.sessions_json,
      currentSession: result.rows[0]?.current_session,
    })
    return res.json({ code: 200, message: 'success', data: payload })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取 LangChain 会话状态失败: ${error.message}`, data: null })
  }
})

app.post('/api/agents/precise-sourcing/chat-stream', authMiddleware, async (req, res) => {
  const traceVersion = 'ps-v20260506-04'
  const owner = toText(req.authUser?.userName || req.authUser?.username || 'unknown')
  const userInput = toText(req.body?.message)
  if (!userInput) {
    return res.status(400).json({ code: 400, message: '缺少参数：message', data: null })
  }
  const authHeader = toText(req.headers.authorization)
  const kbIdInput = toText(req.body?.kbId)
  const kbIdsInput = Array.isArray(req.body?.kbIds) ? req.body.kbIds.map((x) => toText(x)).filter(Boolean) : []
  const selectedDbTables = Array.isArray(req.body?.selectedDbTables) ? req.body.selectedDbTables.map((x) => toText(x)).filter(Boolean) : []
  const selectedToolsRaw = Array.isArray(req.body?.selectedTools)
    ? req.body.selectedTools.map((x) => toText(x)).filter(Boolean)
    : []
  const selectedSkillsRaw = Array.isArray(req.body?.selectedSkills)
    ? req.body.selectedSkills.map((x) => toText(x)).filter(Boolean)
    : []
  const selectedTools = [...new Set([...selectedToolsRaw, ...selectedSkillsRaw])]
  const topK = Math.min(Math.max(Number(req.body?.topK || 20), 5), 50)
  const dbTopK = Math.min(Math.max(Number(req.body?.dbTopK || 10), 1), 100)
  const generateCharts = req.body?.generateCharts !== false
  const temperature = Math.max(0, Math.min(1, Number(req.body?.temperature ?? 0.2)))
  const reportTemplate = req.body?.reportTemplate && typeof req.body.reportTemplate === 'object' ? req.body.reportTemplate : null
  const strictMode = req.body?.strictMode === true
  const selectedModel = toText(req.body?.model)
  const systemPrompt = toText(req.body?.systemPrompt)
  const systemPromptPresetKey = toText(req.body?.systemPromptPresetKey || 'default')
  const targetKbId = kbIdInput || kbIdsInput[0] || toText(knowledgeBaseStore.keys().next()?.value)
  const targetKbIds = kbIdsInput.length > 0 ? kbIdsInput : (targetKbId ? [targetKbId] : [])

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  const sendEvent = (event, data) => {
    try {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch {
      // ignore broken pipe
    }
  }
  sendEvent('start', { traceVersion, message: '开始执行' })

  try {
    const graphResult = await preciseSourcingLangGraph.run({
      onEvent: (evt) => {
        if (evt?.type === 'trace' && evt?.trace) {
          sendEvent('trace', { traceVersion, trace: evt.trace })
        }
      },
      userInput,
      authHeader,
      kbId: targetKbId || '',
      kbIds: targetKbIds,
      topK: Math.min(topK, 20),
      dbTopK,
      selectedDbTables,
      strictMode,
      selectedSkills: selectedTools,
      selectedTools,
      model: selectedModel,
      systemPrompt,
      systemPromptPresetKey,
      generateCharts,
      temperature,
      reportTemplate,
    })
    const payload = await buildPreciseSourcingResponsePayload({
      graphResult,
      traceVersion,
      userInput,
      selectedTools,
      targetKbId,
      targetKbIds,
      selectedDbTables,
      reportTemplate,
      modelName: selectedModel,
    })
    await persistPreciseSourcingRun({
      owner,
      userInput,
      payload,
      selectedTools,
      targetKbIds,
      selectedDbTables,
      modelName: selectedModel,
    }).catch(() => {})
    sendEvent('final', payload)
    sendEvent('done', { ok: true })
    res.end()
  } catch (error) {
    sendEvent('error', { message: `精准寻源智能体执行失败: ${toText(error?.message || error)}` })
    res.end()
  }
})

app.put('/api/langchain/session-state', authMiddleware, async (req, res) => {
  const owner = toText(req.authUser?.userName || req.authUser?.username || 'unknown')
  const chatType = normalizeLangchainChatType(req.body?.chatType)
  const normalized = normalizeLangchainSessionState(req.body || {})
  try {
    await pool.query(
      `
      INSERT INTO ${langchainSessionStateTable} (owner, chat_type, sessions_json, current_session, updated_at)
      VALUES ($1, $2, $3::jsonb, $4, NOW())
      ON CONFLICT (owner, chat_type) DO UPDATE
      SET sessions_json = EXCLUDED.sessions_json,
          current_session = EXCLUDED.current_session,
          updated_at = NOW()
      `,
      [owner, chatType, JSON.stringify(normalized.sessions), normalized.currentSession],
    )
    return res.json({ code: 200, message: 'updated', data: normalized })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `保存 LangChain 会话状态失败: ${error.message}`, data: null })
  }
})

app.post('/api/langchain/chat', authMiddleware, async (req, res) => {
  const messageText = toText(req.body?.message)
  if (!messageText) {
    return res.status(400).json({ code: 400, message: '缺少参数：message', data: null })
  }
  try {
    const selectedTools = Array.isArray(req.body?.selectedTools)
      ? req.body.selectedTools.map((item) => toText(item)).filter(Boolean)
      : []
    const preferImageGen = Boolean(req.body?.useAgent)
      && selectedTools.includes('image_gen')
      && !/(不要出图|不用出图|仅文本|只要提示词|不要图片)/i.test(messageText)
    if (preferImageGen) {
      const image = await callLangchainImageGeneration(messageText, {
        imageModel: toText(req.body?.imageModel || 'gpt-image-1'),
        model: toText(req.body?.model),
      })
      return res.json({
        code: 200,
        message: 'success',
        data: {
          answer: `已为你生成图片：\n![generated-image](${image.imageUrl})\n\n图片模型：${image.model}`,
          messages: Array.isArray(req.body?.history) ? req.body.history : [],
          meta: {
            modelRequested: image.model,
            modelReturned: image.model,
            apiBase: image.apiBase,
          },
        },
      })
    }
    const result = await langchainShellGraph.invoke({
      history: Array.isArray(req.body?.history) ? req.body.history : [],
      message: messageText,
      imageDataUrl: toText(req.body?.imageDataUrl),
      model: toText(req.body?.model),
      imageModel: toText(req.body?.imageModel || 'gpt-image-1'),
      temperature: Number(req.body?.temperature || 0.3),
      systemMessage: toText(req.body?.systemMessage),
      useAgent: Boolean(req.body?.useAgent),
      useMcp: Boolean(req.body?.useMcp),
      selectedTools: Array.isArray(req.body?.selectedTools) ? req.body.selectedTools : [],
    })
    return res.json({
      code: 200,
      message: 'success',
      data: {
        answer: toText(result.answer),
        messages: Array.isArray(result.messages) ? result.messages : [],
        meta: {
          modelRequested: toText(result?.modelRequested),
          modelReturned: toText(result?.modelReturned),
          apiBase: toText(result?.apiBase),
        },
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `LangChain 对话失败: ${error.message}`, data: null })
  }
})

app.get('/api/langchain/models', authMiddleware, async (_req, res) => {
  try {
    const catalog = await fetchLangchainModelCatalog()
    return res.json({
      code: 200,
      message: 'success',
      data: catalog,
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `读取模型列表失败: ${error.message}`, data: null })
  }
})

app.get('/api/langchain/tools', authMiddleware, async (_req, res) => {
  return res.json({
    code: 200,
    message: 'success',
    data: getLangchainToolCatalog(),
  })
})

app.post('/api/langchain/rag-chat', authMiddleware, async (req, res) => {
  const kbId = toText(req.body?.kbId)
  const question = toText(req.body?.question)
  const topK = Math.min(Math.max(Number(req.body?.topK || 8), 1), 20)
  const historyRounds = Math.min(Math.max(Number(req.body?.historyRounds || 3), 0), 20)
  const onlySearchResults = Boolean(req.body?.onlySearchResults)
  const scoreThreshold = Number(req.body?.scoreThreshold)
  if (!kbId || !question) {
    return res.status(400).json({ code: 400, message: '缺少参数：kbId 或 question', data: null })
  }
  try {
    const kb = knowledgeBaseStore.get(kbId)
    if (!kb) return res.status(404).json({ code: 404, message: `知识库不存在: ${kbId}`, data: null })
    const hits = await searchKnowledgeBaseRecords(kb, question, topK, {
      metric: 'cosine',
      strictKeyword: false,
      scoreThreshold: Number.isFinite(scoreThreshold) ? scoreThreshold : null,
    })
    const contextText = hits
      .slice(0, topK)
      .map((item, idx) => `证据${idx + 1}（score=${Number(item.score || 0).toFixed(4)}）:\n${toText(item.content)}`)
      .join('\n\n')
    const outputHits = hits.slice(0, topK).map((item) => ({
      id: item.id,
      kbId: item.kbId,
      docId: item.docId,
      chunkIndex: item.chunkIndex,
      score: item.score,
      content: item.content,
      source: item.name || item.url || item.sourceType || '-',
      url: item.url || '',
    }))
    if (onlySearchResults) {
      return res.json({
        code: 200,
        message: 'success',
        data: {
          answer: outputHits.length > 0 ? '已返回检索结果（未调用模型）。' : '未检索到符合条件的内容。',
          hits: outputHits,
        },
      })
    }
    const prompt = `请基于以下知识库证据回答用户问题。若证据不足，请明确说明。\n\n${contextText || '（无命中证据）'}\n\n用户问题：${question}`
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-(historyRounds * 2)) : []
    const messages = toLangchainMessages(history, prompt)
    const result = await callLangchainCompatibleChat(messages, {
      model: req.body?.model,
      temperature: req.body?.temperature,
    })
    return res.json({
      code: 200,
      message: 'success',
      data: {
        answer: result.answer,
        hits: outputHits,
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `LangChain RAG 对话失败: ${error.message}`, data: null })
  }
})

app.use((error, _req, res, _next) => {
  res.status(500).json({ code: 500, message: error.message || 'unexpected server error', data: null })
})

async function bootstrap() {
  try {
    await initDatabase()
    dbReady = true
    dbInitErrorMessage = ''
    await loadKnowledgeBaseStore()
  } catch (error) {
    dbReady = false
    dbInitErrorMessage = error.message || 'unknown_db_error'
    console.error(`Database init failed: ${dbInitErrorMessage}`)
    if (!allowStartWithoutDb) {
      console.error('Server aborted because ALLOW_START_WITHOUT_DB=false')
      process.exit(1)
    }
    console.warn('Continuing startup without DB. /api endpoints (except /api/health and /api/auth*) will return 503.')
  }
  const timer = setInterval(() => {
    if (!dbReady) {
      void tryInitializeDatabaseIfNeeded('background-timer')
    }
  }, dbReconnectIntervalMs)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
  app.listen(port, () => {
    console.log(`Asset inventory API listening at http://localhost:${port}`)
    if (dbReady) {
      console.log(`DB connected: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database} schema=${schemaName}`)
    } else {
      console.log(`DB unavailable at startup: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database} schema=${schemaName}`)
    }
    console.log(`Auth enabled: ${authEnabled}`)
  })
}

bootstrap()

