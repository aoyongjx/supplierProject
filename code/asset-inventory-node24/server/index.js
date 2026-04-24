import cors from 'cors'
import { execFile as execFileCallback } from 'child_process'
import dotenv from 'dotenv'
import express from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import pg from 'pg'
import { promisify } from 'util'

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
const supplierBaseTable = `"${schemaName}"."supplier_base_info"`
const supplierProfileTable = `"${schemaName}"."supplier_profile"`
const supplierOemDictTable = `"${schemaName}"."supplier_oem_dict"`
const supplierCountryDictTable = `"${schemaName}"."supplier_country_dict"`
const supplierCertDictTable = `"${schemaName}"."supplier_certification_dict"`
const chatSessionTable = `"${schemaName}"."chat_session"`
const chatMessageTable = `"${schemaName}"."chat_message"`
const crawlExportDir = path.join(process.cwd(), 'crawl_exports')
const supplyChainRootTitle = '新能源汽车制造供应链'
const supplierCrawlTaskStore = new Map()
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
  'Crawl4AI',
  'openclaw-grok-search',
  'vercel:agent-browser',
  'Playwright（浏览器自动化）',
  'playwright-script',
  'frontend-design',
  'ui-ux-pro-max',
  'web-design-guidelines',
]
const supplierLlmEnabled = (process.env.SUPPLIER_LLM_ENABLED || 'true') === 'true'
const supplierLlmApiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || process.env.CODEX_API_KEY || ''
const supplierLlmBaseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
const supplierLlmTimeoutMs = Math.max(3000, Number(process.env.SUPPLIER_LLM_TIMEOUT_MS || 18000))
const supplierHttpTimeoutMs = Math.max(4000, Number(process.env.SUPPLIER_HTTP_TIMEOUT_MS || 12000))
const supplierHttpRetryCount = Math.max(1, Number(process.env.SUPPLIER_HTTP_RETRY_COUNT || 1))
const supplierPlaywrightGotoTimeoutMs = Math.max(8000, Number(process.env.SUPPLIER_PW_GOTO_TIMEOUT_MS || 25000))
const supplierPlaywrightWaitMs = Math.max(400, Number(process.env.SUPPLIER_PW_WAIT_MS || 1800))
const supplierTryAllVariants = (process.env.SUPPLIER_TRY_ALL_VARIANTS || 'false') === 'true'
const pool = new Pool(dbConfig)
let dbReady = false
let dbInitErrorMessage = ''
let dbReconnectInFlight = null
let lastDbReconnectAttemptAt = 0

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

    CREATE TABLE IF NOT EXISTS ${supplierProfileTable} (
      id BIGSERIAL PRIMARY KEY,
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

    CREATE INDEX IF NOT EXISTS idx_crawl_info_source_file ON ${crawlInfoTable}(source_file, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crawl_info_business_entity ON ${crawlInfoTable}(business_entity);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_node_parent ON ${supplyChainNodeTable}(parent_id, node_level);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_node_source ON ${supplyChainNodeTable}(source_url, business_entity);
    CREATE INDEX IF NOT EXISTS idx_supplier_base_node ON ${supplierBaseTable}(node_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_base_company ON ${supplierBaseTable}(company_name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_base_unique
      ON ${supplierBaseTable}(COALESCE(node_id, 0), company_name, detail_url);
    CREATE INDEX IF NOT EXISTS idx_supplier_profile_company ON ${supplierProfileTable}(company_name, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_oem_dict_sort ON ${supplierOemDictTable}(sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_supplier_country_dict_sort ON ${supplierCountryDictTable}(sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_supplier_cert_dict_sort ON ${supplierCertDictTable}(sort_order ASC, id ASC);
    DROP INDEX IF EXISTS idx_supply_chain_node_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supply_chain_node_unique
      ON ${supplyChainNodeTable}(COALESCE(parent_id, 0), node_level, node_title, source_url);

    ALTER TABLE ${supplyChainNodeTable}
      DROP CONSTRAINT IF EXISTS supply_chain_node_node_level_check;
    ALTER TABLE ${supplyChainNodeTable}
      ADD CONSTRAINT supply_chain_node_node_level_check CHECK (node_level BETWEEN 1 AND 5);

    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS contacts JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS fit_oems JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS product_fit_details JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS export_countries JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS certificate_items JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS news_items JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_id BIGINT;
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_name VARCHAR(255) NOT NULL DEFAULT '';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_ids JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS related_node_names JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE ${supplierProfileTable} ADD COLUMN IF NOT EXISTS org_code VARCHAR(64) NOT NULL DEFAULT '';

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
  `
  await pool.query(sql)
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
  return [...new Set(tokens
    .map((item) => item.replace(/^(?:配套说明|配套情况)[:：]?/g, '').replace(/^(?:配套)/g, '').replace(/等$/g, '').trim())
    .filter((item) => item.length >= 2 && item.length <= 24 && allowPattern.test(item)))].slice(0, 80)
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
    .split(/[\n\r;；]+/g)
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
    if (/^[^.]+\.cn\.gasgoo\.com$/.test(host) && (pathname === '/' || pathname === '')) return true
    if (pathname.includes('company.php')) return true
    if (parsed.searchParams.get('mid')) return true
    if (/(supplier|detail|company)/.test(pathname) && !pathname.includes('category.php')) return true
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
  if (/company_(?:intro|goods|goods_parts|goods_export|list|video|news|contact)\.php\?mid=/i.test(htmlText)) return true
  return false
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
  if (/(company|supplier|corp|qiye|member|shop|detail|show_)/.test(text)) return true
  if (/\.html?$/.test(text) && /(company|supplier|corp|qiye|member|shop|detail|show_)/.test(text)) return true
  return false
}

function sanitizeSupplierCompanyName(name = '') {
  let text = decodeBasicHtmlEntities(stripHtml(String(name || ''))).replace(/\s+/g, ' ').trim()
  text = text
    .replace(/^(?:联系方式|公司简介|重点产品|配套情况|出口情况|企业证书|公司新闻|联系我们)\s*[-—–|｜]\s*/i, '')
    .replace(/\s*[-—–|｜]\s*汽车供应商网.*$/i, '')
    .replace(/\s*[-—–|｜]\s*中国汽车供应商网.*$/i, '')
    .replace(/\s*[-—–|｜]\s*全面展示中国最优质汽车供应商.*$/i, '')
    .replace(/\s*[-—–|｜]\s*汽车行业电子商务平台.*$/i, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text
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
  const normalizedAtomic = normalizeSupplierDetailAtomicFields({
    companyType: params.companyType,
    orgCode: params.orgCode,
    establishedDate: params.establishedDate,
    registeredCapital: params.registeredCapital,
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
    mainProducts: cleanSupplierFieldText(toText(params.mainProducts) || fromText.mainProducts),
    fitExport: cleanSupplierFieldText(toText(params.fitExport) || fromText.fitExport),
    qualitySystem: cleanSupplierFieldText(toText(params.qualitySystem) || fromText.qualitySystem),
    region: cleanSupplierFieldText(toText(params.region) || fromText.region),
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
  const companyLinkCount = [...page.matchAll(/(?:company\.php|free\.php)\?mid=\d+/gi)].length
  return {
    pageTitle: extractTitle(page),
    pageTextLen: plain.length,
    liAlistsCount,
    trCount,
    companyLinkCount,
    pageUrl: toText(pageUrl),
  }
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
  return [...urls]
}

function isSameSupplierCategoryUrl(baseUrl = '', candidateUrl = '') {
  try {
    const base = new URL(baseUrl)
    const candidate = new URL(candidateUrl)
    if (base.host !== candidate.host) return false
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
  const region = addressFromSection
    || extractSupplierLabeledValue(plain, ['地区', '所在地', '地址'], 180)
    || cleanSupplierFieldText(textByRegex(plain, /((?:北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)[^。；;]{0,40})/i))
  const contactAction = contactFromSection
    || extractSupplierLabeledValue(plain, ['联系方式', '联系人', '电话', '手机', '邮箱'], 220)
    || cleanSupplierFieldText(textByRegex(plain, /(?:联系方式|联系人|电话|手机|邮箱)[:：]?\s*([^。；;]{2,120})/i))
  const companyType = extractSupplierLabeledValue(plain, ['公司性质', '企业性质', '企业类型', '公司类型'], 80)
  const orgCode = extractSupplierLabeledValue(plain, ['机构代码', '组织机构代码', '统一社会信用代码'], 64)
  const establishedDate = extractSupplierLabeledValue(plain, ['成立日期', '成立时间'], 64)
  const registeredCapital = extractSupplierLabeledValue(plain, ['注册资本'], 96)
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

async function fetchSupplierDetailAggregateByHttp(detailUrl) {
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
  for (const candidate of buildSupplierDetailTabUrls(detailUrl)) {
    enqueueTabUrl(candidate, '')
  }

  while (queue.length > 0) {
    const current = queue.shift()
    const currentUrl = toText(current?.url)
    if (!currentUrl || fetchedUrls.has(currentUrl)) continue
    fetchedUrls.add(currentUrl)
    const detailFetched = await fetchTextWithRetries(currentUrl, supplierHttpTimeoutMs, supplierHttpRetryCount)
    const tabKey = classifySupplierDetailTab(current?.label || '', currentUrl)
    const parsed = extractSupplierDetailFromHtml(detailFetched.text, currentUrl)
    mergeParsedDetail(parsed, tabKey)
    snapshots.push({
      label: current?.label || currentUrl,
      url: currentUrl,
      html: detailFetched.text,
      plain: decodeBasicHtmlEntities(stripHtml(String(detailFetched.text || ''))).replace(/\s+/g, ' ').trim(),
    })
    for (const discovered of discoverSupplierDetailTabLinksFromHtml(detailFetched.text, currentUrl)) {
      enqueueTabUrl(discovered.url, discovered.label || discovered.tabKey || '')
    }
    if (!tabKey || tabKey === 'home') {
      for (const candidate of buildSupplierDetailTabUrls(currentUrl)) {
        enqueueTabUrl(candidate, '')
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

async function enrichSupplierRowsByDetailPages(rows, task, nowText) {
  const result = Array.isArray(rows) ? rows : []
  const candidatesCount = result.filter((row) => row?.detailUrl && row.status === 'success').length
  if (task?.runLogs) {
    task.runLogs.push(`${nowText()} | 详情补全启动：待补全 ${candidatesCount} 条`)
  }
  let resolvedCount = 0
  let failedCount = 0
  for (let i = 0; i < result.length; i += 1) {
    const row = result[i]
    if (!row?.detailUrl || row.status !== 'success') continue
    if (task?.runLogs && (i === 0 || (i + 1) % 10 === 0)) {
      task.runLogs.push(`${nowText()} | 详情补全进度：${Math.min(i + 1, candidatesCount)}/${candidatesCount}`)
    }
    const detailCandidates = buildSupplierDetailUrlCandidates(row.detailUrl)
    let lastError = ''
    let resolved = false
    for (const detailUrl of detailCandidates) {
      try {
        let { detail, mergedHtml, mergedPlain } = await fetchSupplierDetailAggregateByHttp(detailUrl)
        const llmDetail = await extractSupplierDetailByLlm({
          html: mergedHtml,
          plain: mergedPlain,
          detailUrl,
          model: task?.model || 'gpt-5.4',
        })
        detail = mergeSupplierDetailWithLlm(detail, llmDetail)
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
        row.detailUrl = detailUrl
        resolved = true
        resolvedCount += 1
        break
      } catch (error) {
        lastError = error.message || 'unknown error'
      }
    }
    if (!resolved && lastError) {
      failedCount += 1
      task?.runLogs?.push(`${nowText()} | 详情页抓取失败：${row.detailUrl}，${lastError}`)
    }
  }
  if (task?.runLogs) {
    task.runLogs.push(`${nowText()} | 详情补全完成：成功 ${resolvedCount}，失败 ${failedCount}`)
  }
  return result
}

async function extractSupplierPageDataWithPlaywright(listPageUrl, context = {}) {
  let browser
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true, args: buildPlaywrightLaunchArgs(listPageUrl) })
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
    })
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
      const companyLinkCount = document.querySelectorAll("a[href*='company.php?mid='],a[href*='free.php?mid=']").length
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
    }
    await page.close().catch(() => {})
    return { rows, totalCount, paginationUrls, finalUrl, perPage, source: 'playwright', diagnostics }
  } catch {
    return { rows: [], totalCount: 0, paginationUrls: [], finalUrl: listPageUrl, source: 'playwright', diagnostics: {} }
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
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
        toText(item.companyName),
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

async function importSupplierProfileRows(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { importedRows: 0, inserted: 0, updated: 0 }
  }
  const client = await pool.connect()
  let inserted = 0
  let updated = 0
  try {
    const [oemDictRes, countryDictRes, certDictRes] = await Promise.all([
      client.query(`SELECT name FROM ${supplierOemDictTable} ORDER BY sort_order ASC, id ASC`),
      client.query(`SELECT name FROM ${supplierCountryDictTable} ORDER BY sort_order ASC, id ASC`),
      client.query(`SELECT name FROM ${supplierCertDictTable} ORDER BY sort_order ASC, id ASC`),
    ])
    const oemDict = oemDictRes.rows.map((item) => toText(item.name)).filter(Boolean)
    const countryDict = countryDictRes.rows.map((item) => toText(item.name)).filter(Boolean)
    const certDict = certDictRes.rows.map((item) => toText(item.name)).filter(Boolean)

    await client.query('BEGIN')
    for (const item of records) {
      const companyName = toText(item.companyName)
      if (!companyName) continue
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
      const fitOems = [...new Set([
        ...extractKnownItemsFromText(fitSourceText, oemDict),
        ...extractSupplierOemCandidatesFromText(fitOriginalText || fitSourceText),
      ])]
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
          related_node_id AS "relatedNodeId",
          related_node_name AS "relatedNodeName",
          related_node_ids AS "relatedNodeIds",
          related_node_names AS "relatedNodeNames"
        FROM ${supplierProfileTable}
        WHERE company_name = $1
        ORDER BY id ASC
        LIMIT 1
        `,
        [companyName],
      )
      const mergedNodeRefs = mergeSupplierNodeRefs(
        existing.rows[0]?.relatedNodeIds || [],
        existing.rows[0]?.relatedNodeNames || [],
        item.nodeId,
        toText(item.nodeName),
      )
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
          ],
        )
        updated += 1
      } else {
        const initialNodeRefs = mergeSupplierNodeRefs([], [], item.nodeId, toText(item.nodeName))
        await client.query(
          `
          INSERT INTO ${supplierProfileTable}
          (
            related_node_id, related_node_name, related_node_ids, related_node_names, company_name, legal_representative, org_code, registered_capital, established_date, employees_count, company_type,
            website, company_intro, fit_situation, export_situation, certificates, address, products,
            contacts, fit_oems, product_fit_details, export_countries, certificate_items, company_news, news_items, updated_at
          )
          VALUES
          ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24,$25::jsonb,NOW())
          `,
          [
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
          ],
        )
        inserted += 1
      }
    }
    await client.query('COMMIT')
    return { importedRows: records.length, inserted, updated }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
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

function hasSupplierDetailPayload(detail = {}) {
  if (!detail || typeof detail !== 'object') return false
  return Boolean(
    toText(detail.companyName)
    || toText(detail.mainProducts)
    || toText(detail.companyIntro)
    || toText(detail.legalRepresentative),
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
  return {
    nodeId: context.nodeId || null,
    nodeName: context.nodeName || '',
    model: context.model || '',
    skill: context.skill || '',
    sourceUrl: context.sourceUrl || sourceUrl || detailUrl || '',
    listPageUrl: sourceUrl || detailUrl || '',
    detailUrl: detailUrl || sourceUrl || '',
    companyName: toText(normalized.companyName),
    mainProducts: toText(normalized.mainProducts),
    fitSituation: cleanSupplierFieldText(toText(detail.fitSituation)),
    exportSituation: cleanSupplierFieldText(toText(detail.exportSituation)),
    fitExport: toText(normalized.fitExport),
    qualitySystem: toText(normalized.qualitySystem),
    region: toText(normalized.region),
    contactAction: toText(normalized.contactAction),
    website: cleanSupplierFieldText(toText(detail.website) || detailUrl || sourceUrl),
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
    status: toText(options.status) || 'success',
    errorMessage: toText(options.errorMessage),
  }
}

async function extractSupplierDetailDataByPlaywright(url, context = {}) {
  let browser
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true, args: buildPlaywrightLaunchArgs(url) })
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
    })
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
    return { detail, finalUrl, html: mergedHtml, plain: mergedPlain, source: 'playwright', context }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

async function crawlSupplierDetailByUrlVariants(url, context, task, nowText) {
  const candidateUrls = buildSupplierDetailUrlCandidates(url)
  task?.runLogs?.push(`${nowText()} | 详情模式：URL变体 ${candidateUrls.length} 个`)
  const preferPlaywright = /playwright/i.test(toText(context?.skill))
  task?.runLogs?.push(`${nowText()} | 详情抓取策略：${preferPlaywright ? '优先 Playwright（按所选技能）' : '优先 HTTP（失败再 Playwright）'}`)
  let lastError = ''
  const variantErrors = []
  for (let idx = 0; idx < candidateUrls.length; idx += 1) {
    const candidateUrl = candidateUrls[idx]
    task?.runLogs?.push(`${nowText()} | 尝试详情变体[${idx + 1}/${candidateUrls.length}]：${candidateUrl}`)
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
          const httpData = await fetchSupplierDetailAggregateByHttp(candidateUrl)
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
        const httpData = await fetchSupplierDetailAggregateByHttp(candidateUrl)
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
            const httpOnly = await fetchSupplierDetailAggregateByHttp(candidateUrl)
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
  const preferPlaywright = /playwright/i.test(toText(context?.skill))
  task?.runLogs?.push(`${nowText()} | 抓取策略：${preferPlaywright ? '优先 Playwright（按所选技能）' : '优先 HTTP（失败再 Playwright）'}`)
  let best = { rows: [], totalCount: 0, paginationUrls: [], candidateUrl: '', pagesVisited: 0 }

  for (let candidateIndex = 0; candidateIndex < candidateUrls.length; candidateIndex += 1) {
    const candidateUrl = candidateUrls[candidateIndex]
    const candidateStart = Date.now()
    task?.runLogs?.push(`${nowText()} | 尝试列表变体[${candidateIndex + 1}/${candidateUrls.length}]：${candidateUrl}`)
    const pendingPages = [candidateUrl]
    const seenPages = new Set()
    let collectedRows = []
    let expectedTotal = 0
    let totalByCandidate = 0

    while (pendingPages.length > 0 && seenPages.size < 80) {
      const pageUrl = pendingPages.shift()
      if (!pageUrl || seenPages.has(pageUrl)) continue
      seenPages.add(pageUrl)
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
        const d = pageData?.diagnostics || {}
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
        if (!seenPages.has(nextPageUrl)) pendingPages.push(nextPageUrl)
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
          if (!seenPages.has(nextPageUrl)) pendingPages.push(nextPageUrl)
        }
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
    best.rows = await enrichSupplierRowsByDetailPages(best.rows, task, nowText)
    task?.runLogs?.push(`${nowText()} | 详情补全阶段耗时 ${Date.now() - enrichStart}ms`)
  }
  return { ...best, candidateUrls }
}

async function runSupplierCrawlTask(task) {
  const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
  const taskStart = Date.now()
  task.status = 'running'
  task.startedAt = new Date().toISOString()
  task.progress = 1
  task.runLogs.push(`${nowText()} | 任务开始：节点 ${task.nodeName || task.nodeId}，URL ${task.totalUrls} 个`)
  task.runLogs.push(`${nowText()} | 抽取模式：Codex模型 + 规则补充（model=${task.model || 'gpt-5.4'}）`)
  const rows = []
  for (const url of task.urls) {
    if (task.cancelRequested) {
      task.status = 'cancelled'
      task.endedAt = new Date().toISOString()
      task.progress = Math.max(task.progress, 100)
      task.runLogs.push(`${nowText()} | 任务已取消，停止抓取`)
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
    }
    task.runLogs.push(`${nowText()} | 抓取上下文：nodeId=${crawlContext.nodeId || '-'}，nodeName=${crawlContext.nodeName || '-'}，skill=${crawlContext.skill || '-'}`)
    try {
      const detailMode = isSupplierDetailEntryUrl(url)
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
    'company_name',
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
        row.companyName || '',
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
    const taskId = createSupplierTaskId()
    const task = {
      taskId,
      nodeId,
      nodeName: toText(req.body?.nodeName) || toText(node.nodeTitle),
      sourceUrl: toText(node.sourceUrl || node.nodeUrl),
      model,
      skill,
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
    void runSupplierCrawlTask(task).catch((error) => {
      task.status = 'failed'
      task.errorMessage = error.message || '任务执行失败'
      task.progress = 100
      task.endedAt = new Date().toISOString()
      const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
      task.runLogs.push(`${nowText()} | 执行失败：${task.errorMessage}`)
    })
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
    const taskId = createSupplierTaskId()
    const task = {
      taskId,
      nodeId: null,
      nodeName: toText(req.body?.nodeName) || '',
      sourceUrl: '',
      urlNodeMetaMap,
      model,
      skill,
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
    void runSupplierCrawlTask(task).catch((error) => {
      task.status = 'failed'
      task.errorMessage = error.message || '任务执行失败'
      task.progress = 100
      task.endedAt = new Date().toISOString()
      const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false })
      task.runLogs.push(`${nowText()} | 执行失败：${task.errorMessage}`)
    })
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
    const baseSummary = await importSupplierBaseRows(validRecords, task.fileName || '')
    const profileSummary = includeProfile
      ? await importSupplierProfileRows(validRecords)
      : { inserted: 0, updated: 0, skipped: true }
    const importSummary = {
      ...baseSummary,
      profileInserted: profileSummary.inserted || 0,
      profileUpdated: profileSummary.updated || 0,
      profileSkipped: Boolean(profileSummary.skipped),
    }
    task.imported = true
    task.importSummary = importSummary
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
  const nodeId = Number(req.query.nodeId || 0)
  const filters = []
  const params = []
  if (keyword) {
    params.push(`%${keyword}%`)
    filters.push(`(
      company_name ILIKE $${params.length}
      OR node_name ILIKE $${params.length}
      OR main_products ILIKE $${params.length}
      OR quality_system ILIKE $${params.length}
      OR region ILIKE $${params.length}
      OR list_page_url ILIKE $${params.length}
      OR detail_url ILIKE $${params.length}
    )`)
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

app.get('/api/supplier-profiles/options', authMiddleware, async (_req, res) => {
  try {
    const [oemResult, countryResult, certResult, sourceResult, treeResult] = await Promise.all([
      pool.query(`SELECT id, name FROM ${supplierOemDictTable} ORDER BY sort_order ASC, id ASC LIMIT 1000`),
      pool.query(`SELECT id, name FROM ${supplierCountryDictTable} ORDER BY sort_order ASC, id ASC LIMIT 1000`),
      pool.query(`SELECT id, name FROM ${supplierCertDictTable} ORDER BY sort_order ASC, id ASC LIMIT 1000`),
      pool.query(`
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
        ORDER BY updated_at DESC, id DESC
        LIMIT 3000
      `),
      pool.query(`
        SELECT
          id,
          parent_id AS "parentId",
          node_level AS "nodeLevel",
          node_title AS "nodeTitle"
        FROM ${supplyChainNodeTable}
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
        oemOptions: oemResult.rows.map((item) => ({ id: item.id, name: item.name })),
        countryOptions: countryResult.rows.map((item) => ({ id: item.id, name: item.name })),
        certificationOptions: certResult.rows.map((item) => ({ id: item.id, name: item.name })),
        sourceOptions: sourceResult.rows.map((item) => ({
          id: item.id,
          nodeId: item.nodeId,
          nodeName: item.nodeName,
          companyName: item.companyName,
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
  const params = []
  let whereSql = ''
  if (keyword) {
    params.push(`%${keyword}%`)
    whereSql = `
      WHERE
        company_name ILIKE $1
        OR company_name_en ILIKE $1
        OR legal_representative ILIKE $1
        OR contact_person ILIKE $1
        OR phone ILIKE $1
        OR mobile ILIKE $1
        OR email ILIKE $1
        OR website ILIKE $1
    `
  }
  params.push(limit)
  const limitParam = `$${params.length}`
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        related_node_id AS "relatedNodeId",
        related_node_name AS "relatedNodeName",
        related_node_ids AS "relatedNodeIds",
        related_node_names AS "relatedNodeNames",
        company_name AS "companyName",
        company_name_en AS "companyNameEn",
        legal_representative AS "legalRepresentative",
        contact_person AS "contactPerson",
        phone,
        mobile,
        email,
        website,
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
      }
    })
    return res.json({ code: 200, message: 'success', data })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询供应商档案失败: ${error.message}`, data: null })
  }
})

app.get('/api/supplier-profiles/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const result = await pool.query(
      `
      SELECT
        id,
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
        news_items AS "newsItems",
        TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS "createdAt",
        TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS "updatedAt"
      FROM ${supplierProfileTable}
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    )
    if (result.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({
      code: 200,
      message: 'success',
      data: {
        ...result.rows[0],
        relatedNodeIds: parseBigintArrayLoose(result.rows[0]?.relatedNodeIds || []),
        relatedNodeNames: parseStringArray(result.rows[0]?.relatedNodeNames || []),
        contacts: parseSupplierProfileContacts(result.rows[0]?.contacts || []),
        products: parseSupplierProfileProducts(result.rows[0]?.products || []),
        fitOems: parseStringArray(result.rows[0]?.fitOems || []),
        productFitDetails: parseSupplierProductFitDetails(result.rows[0]?.productFitDetails || []),
        exportCountries: parseStringArray(result.rows[0]?.exportCountries || []),
        certificateItems: parseStringArray(result.rows[0]?.certificateItems || []),
        newsItems: parseSupplierNewsItems(result.rows[0]?.newsItems || []),
      },
    })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `查询供应商档案详情失败: ${error.message}`, data: null })
  }
})

app.post('/api/supplier-profiles', authMiddleware, async (req, res) => {
  const payload = req.body || {}
  const companyName = toText(payload.companyName)
  if (!companyName) {
    return res.status(400).json({ code: 400, message: '公司名称不能为空', data: null })
  }
  const contacts = parseSupplierProfileContacts(payload.contacts)
  const products = parseSupplierProfileProducts(payload.products)
  const fitOems = parseStringArray(payload.fitOems)
  const productFitDetails = parseSupplierProductFitDetails(payload.productFitDetails)
  const exportCountries = parseStringArray(payload.exportCountries)
  const certificateItems = parseStringArray(payload.certificateItems)
  const newsItems = parseSupplierNewsItems(payload.newsItems)
  const relatedNodeIds = parseBigintArrayLoose(payload.relatedNodeIds)
  const relatedNodeNames = parseStringArray(payload.relatedNodeNames)
  const singleNodeId = payload.relatedNodeId ? Number(payload.relatedNodeId) : null
  if (Number.isInteger(singleNodeId) && singleNodeId > 0 && !relatedNodeIds.includes(singleNodeId)) {
    relatedNodeIds.unshift(singleNodeId)
  }
  const singleNodeName = toText(payload.relatedNodeName)
  if (singleNodeName && !relatedNodeNames.includes(singleNodeName)) {
    relatedNodeNames.unshift(singleNodeName)
  }
  const primaryContact = contacts[0] || {}
  const fitSituation = toText(payload.fitSituation) || fitOems.join('，')
  const exportSituation = toText(payload.exportSituation) || exportCountries.join('，')
  const certificates = toText(payload.certificates) || certificateItems.join('，')
  const companyNews = toText(payload.companyNews) || newsItems.map((item) => item.title).filter(Boolean).join('；')
  try {
    await upsertSupplierDictItems(pool, supplierOemDictTable, fitOems)
    await upsertSupplierDictItems(pool, supplierCountryDictTable, exportCountries)
    await upsertSupplierDictItems(pool, supplierCertDictTable, certificateItems)
    const inserted = await pool.query(
      `
      INSERT INTO ${supplierProfileTable}
      (
        related_node_id, related_node_name, related_node_ids, related_node_names,
        company_name, company_name_en, legal_representative, org_code, registered_capital, established_date, employees_count,
        company_type, contact_person, contact_title, phone, mobile, email, website, postal_code, address,
        company_intro, fit_situation, export_situation, certificates, company_news, products,
        contacts, fit_oems, product_fit_details, export_countries, certificate_items, news_items, updated_at
      )
      VALUES
      ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb,$27::jsonb,$28::jsonb,$29::jsonb,$30::jsonb,$31::jsonb,$32::jsonb,NOW())
      RETURNING id
      `,
      [
        relatedNodeIds[0] || null,
        relatedNodeNames.join('，'),
        JSON.stringify(relatedNodeIds),
        JSON.stringify(relatedNodeNames),
        companyName,
        toText(payload.companyNameEn),
        toText(payload.legalRepresentative),
        toText(payload.orgCode),
        toText(payload.registeredCapital),
        toText(payload.establishedDate),
        toText(payload.employeesCount),
        toText(payload.companyType),
        toText(primaryContact.contactPerson),
        toText(primaryContact.contactTitle),
        toText(primaryContact.phone),
        toText(primaryContact.mobile),
        toText(primaryContact.email),
        toText(payload.website),
        toText(payload.postalCode),
        toText(payload.address),
        toText(payload.companyIntro),
        fitSituation,
        exportSituation,
        certificates,
        companyNews,
        JSON.stringify(products),
        JSON.stringify(contacts),
        JSON.stringify(fitOems),
        JSON.stringify(productFitDetails),
        JSON.stringify(exportCountries),
        JSON.stringify(certificateItems),
        JSON.stringify(newsItems),
      ],
    )
    return res.json({ code: 200, message: 'created', data: { id: String(inserted.rows[0].id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `新增供应商档案失败: ${error.message}`, data: null })
  }
})

app.put('/api/supplier-profiles/:id', authMiddleware, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  const payload = req.body || {}
  const setClauses = []
  const params = []
  const nextContacts = Object.prototype.hasOwnProperty.call(payload, 'contacts')
    ? parseSupplierProfileContacts(payload.contacts)
    : null
  const nextFitOems = Object.prototype.hasOwnProperty.call(payload, 'fitOems')
    ? parseStringArray(payload.fitOems)
    : null
  const nextProductFitDetails = Object.prototype.hasOwnProperty.call(payload, 'productFitDetails')
    ? parseSupplierProductFitDetails(payload.productFitDetails)
    : null
  const nextExportCountries = Object.prototype.hasOwnProperty.call(payload, 'exportCountries')
    ? parseStringArray(payload.exportCountries)
    : null
  const nextCertificateItems = Object.prototype.hasOwnProperty.call(payload, 'certificateItems')
    ? parseStringArray(payload.certificateItems)
    : null
  const nextNewsItems = Object.prototype.hasOwnProperty.call(payload, 'newsItems')
    ? parseSupplierNewsItems(payload.newsItems)
    : null
  const hasRelatedNodeId = Object.prototype.hasOwnProperty.call(payload, 'relatedNodeId')
  const hasRelatedNodeIds = Object.prototype.hasOwnProperty.call(payload, 'relatedNodeIds')
  const hasRelatedNodeName = Object.prototype.hasOwnProperty.call(payload, 'relatedNodeName')
  const hasRelatedNodeNames = Object.prototype.hasOwnProperty.call(payload, 'relatedNodeNames')

  let normalizedRelatedNodeIds = null
  if (hasRelatedNodeIds || hasRelatedNodeId) {
    normalizedRelatedNodeIds = parseBigintArrayLoose(payload.relatedNodeIds)
    if (hasRelatedNodeId) {
      const parsed = payload.relatedNodeId ? Number(payload.relatedNodeId) : null
      if (Number.isInteger(parsed) && parsed > 0 && !normalizedRelatedNodeIds.includes(parsed)) {
        normalizedRelatedNodeIds.unshift(parsed)
      }
    }
  }
  let normalizedRelatedNodeNames = null
  if (hasRelatedNodeNames || hasRelatedNodeName) {
    normalizedRelatedNodeNames = parseStringArray(payload.relatedNodeNames)
    const singleName = toText(payload.relatedNodeName)
    if (singleName && !normalizedRelatedNodeNames.includes(singleName)) {
      normalizedRelatedNodeNames.unshift(singleName)
    }
  }

  const textFieldMap = {
    companyName: 'company_name',
    companyNameEn: 'company_name_en',
    legalRepresentative: 'legal_representative',
    orgCode: 'org_code',
    registeredCapital: 'registered_capital',
    establishedDate: 'established_date',
    employeesCount: 'employees_count',
    companyType: 'company_type',
    contactPerson: 'contact_person',
    contactTitle: 'contact_title',
    phone: 'phone',
    mobile: 'mobile',
    email: 'email',
    website: 'website',
    postalCode: 'postal_code',
    address: 'address',
    companyIntro: 'company_intro',
    fitSituation: 'fit_situation',
    exportSituation: 'export_situation',
    certificates: 'certificates',
    companyNews: 'company_news',
  }
  if (normalizedRelatedNodeIds !== null) {
    params.push(normalizedRelatedNodeIds[0] || null)
    setClauses.push(`related_node_id = $${params.length}`)
    params.push(JSON.stringify(normalizedRelatedNodeIds))
    setClauses.push(`related_node_ids = $${params.length}::jsonb`)
  }
  if (normalizedRelatedNodeNames !== null) {
    params.push(normalizedRelatedNodeNames.join('，'))
    setClauses.push(`related_node_name = $${params.length}`)
    params.push(JSON.stringify(normalizedRelatedNodeNames))
    setClauses.push(`related_node_names = $${params.length}::jsonb`)
  }

  for (const [key, column] of Object.entries(textFieldMap)) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      params.push(toText(payload[key]))
      setClauses.push(`${column} = $${params.length}`)
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'products')) {
    const products = parseSupplierProfileProducts(payload.products)
    params.push(JSON.stringify(products))
    setClauses.push(`products = $${params.length}::jsonb`)
  }
  if (nextContacts !== null) {
    params.push(JSON.stringify(nextContacts))
    setClauses.push(`contacts = $${params.length}::jsonb`)
    const primaryContact = nextContacts[0] || {}
    params.push(toText(primaryContact.contactPerson))
    setClauses.push(`contact_person = $${params.length}`)
    params.push(toText(primaryContact.contactTitle))
    setClauses.push(`contact_title = $${params.length}`)
    params.push(toText(primaryContact.phone))
    setClauses.push(`phone = $${params.length}`)
    params.push(toText(primaryContact.mobile))
    setClauses.push(`mobile = $${params.length}`)
    params.push(toText(primaryContact.email))
    setClauses.push(`email = $${params.length}`)
  }
  if (nextFitOems !== null) {
    params.push(JSON.stringify(nextFitOems))
    setClauses.push(`fit_oems = $${params.length}::jsonb`)
    if (!Object.prototype.hasOwnProperty.call(payload, 'fitSituation')) {
      params.push(nextFitOems.join('，'))
      setClauses.push(`fit_situation = $${params.length}`)
    }
  }
  if (nextProductFitDetails !== null) {
    params.push(JSON.stringify(nextProductFitDetails))
    setClauses.push(`product_fit_details = $${params.length}::jsonb`)
  }
  if (nextExportCountries !== null) {
    params.push(JSON.stringify(nextExportCountries))
    setClauses.push(`export_countries = $${params.length}::jsonb`)
    if (!Object.prototype.hasOwnProperty.call(payload, 'exportSituation')) {
      params.push(nextExportCountries.join('，'))
      setClauses.push(`export_situation = $${params.length}`)
    }
  }
  if (nextCertificateItems !== null) {
    params.push(JSON.stringify(nextCertificateItems))
    setClauses.push(`certificate_items = $${params.length}::jsonb`)
    if (!Object.prototype.hasOwnProperty.call(payload, 'certificates')) {
      params.push(nextCertificateItems.join('，'))
      setClauses.push(`certificates = $${params.length}`)
    }
  }
  if (nextNewsItems !== null) {
    params.push(JSON.stringify(nextNewsItems))
    setClauses.push(`news_items = $${params.length}::jsonb`)
    if (!Object.prototype.hasOwnProperty.call(payload, 'companyNews')) {
      params.push(nextNewsItems.map((item) => item.title).filter(Boolean).join('；'))
      setClauses.push(`company_news = $${params.length}`)
    }
  }
  if (setClauses.length === 0) {
    return res.status(400).json({ code: 400, message: '没有可更新字段', data: null })
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'companyName') && !toText(payload.companyName)) {
    return res.status(400).json({ code: 400, message: '公司名称不能为空', data: null })
  }
  try {
    if (nextFitOems !== null) await upsertSupplierDictItems(pool, supplierOemDictTable, nextFitOems)
    if (nextExportCountries !== null) await upsertSupplierDictItems(pool, supplierCountryDictTable, nextExportCountries)
    if (nextCertificateItems !== null) await upsertSupplierDictItems(pool, supplierCertDictTable, nextCertificateItems)
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新供应商档案失败: ${error.message}`, data: null })
  }
  setClauses.push('updated_at = NOW()')
  params.push(id)
  try {
    const updated = await pool.query(
      `UPDATE ${supplierProfileTable} SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params,
    )
    if (updated.rowCount === 0) {
      return res.status(404).json({ code: 404, message: '记录不存在', data: null })
    }
    return res.json({ code: 200, message: 'updated', data: { id: String(id) } })
  } catch (error) {
    return res.status(500).json({ code: 500, message: `更新供应商档案失败: ${error.message}`, data: null })
  }
})

app.delete('/api/supplier-profiles/batch-delete', authMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map((item) => parsePositiveBigintId(item)).filter(Boolean)
    : []
  if (ids.length === 0) {
    return res.status(400).json({ code: 400, message: '请提供有效 ids', data: null })
  }
  try {
    const deleted = await pool.query(
      `DELETE FROM ${supplierProfileTable} WHERE id = ANY($1::bigint[]) RETURNING id`,
      [ids],
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

app.delete('/api/supplier-profiles/clear-all', authMiddleware, async (_req, res) => {
  try {
    const deleted = await pool.query(`DELETE FROM ${supplierProfileTable} RETURNING id`)
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
  if (!id) {
    return res.status(400).json({ code: 400, message: '无效记录ID', data: null })
  }
  try {
    const deleted = await pool.query(`DELETE FROM ${supplierProfileTable} WHERE id = $1::bigint RETURNING id`, [id])
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

app.use((error, _req, res, _next) => {
  res.status(500).json({ code: 500, message: error.message || 'unexpected server error', data: null })
})

async function bootstrap() {
  try {
    await initDatabase()
    dbReady = true
    dbInitErrorMessage = ''
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
