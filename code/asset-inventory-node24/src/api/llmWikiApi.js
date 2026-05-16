import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const directApiBaseRaw = String(import.meta.env.VITE_API_DIRECT_BASE || '').trim()
const directApiBase = directApiBaseRaw.replace(/\/+$/, '')
const MOCK_ENTRIES_KEY = 'llm-wiki-mock-entries'
const MOCK_SETTINGS_KEY = 'llm-wiki-mock-settings'

const defaultEntries = [
  {
    key: 'e1',
    title: '广东椿岛电控科技有限公司',
    category: '企业库',
    status: '已确认',
    updatedAt: '2026-05-13 09:25',
    sourceCount: 4,
    content: '主营：VVT/OCV阀、变速箱电磁阀；认证：IATF16949:2016；关联：电磁阀、比亚迪',
  },
  {
    key: 'e2',
    title: '电磁阀',
    category: '产品库',
    status: '待确认',
    updatedAt: '2026-05-12 20:18',
    sourceCount: 2,
    content: '产品分类词条，关联企业与认证信息，支持继续问答与来源回链。',
  },
  {
    key: 'e3',
    title: 'IATF16949',
    category: '认证库',
    status: '已确认',
    updatedAt: '2026-05-12 16:10',
    sourceCount: 3,
    content: '汽车行业质量管理体系认证词条，关联供应商资质信息。',
  },
]

const defaultSettings = {
  enabled: true,
  wikiFirst: true,
  autoWriteback: true,
  db: true,
  rag: true,
  web: false,
  onlyConfirmed: false,
}

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function shouldUseDirectFallback() {
  if (!directApiBase) return false
  try {
    const current = new URL(window.location.origin)
    const direct = new URL(directApiBase)
    return current.origin !== direct.origin
  } catch {
    return false
  }
}

async function requestWithFallback(path, init = {}) {
  const primary = async () => fetch(path, init)
  const fallback = async () => fetch(`${directApiBase}${path}`, init)
  const enableFallback = shouldUseDirectFallback()
  try {
    const response = await primary()
    if (enableFallback && response.status === 502) return await fallback()
    return response
  } catch {
    if (enableFallback) return await fallback()
    throw new Error('LLM-Wiki 请求失败：主服务不可达')
  }
}

async function parseJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearTokens()
    if (window.location.pathname !== '/login') window.location.replace('/login')
    throw new Error(payload.message || '登录已失效，请重新登录')
  }
  if (!response.ok) throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  return payload
}

function nowText() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export async function fetchLlmWikiEntries() {
  try {
    const response = await requestWithFallback('/api/llm-wiki/entries', {
      headers: buildAuthHeaders(),
    })
    const result = await parseJson(response)
    const rows = Array.isArray(result?.data) ? result.data : []
    return rows
  } catch {
    const rows = readLocalJson(MOCK_ENTRIES_KEY, null)
    if (Array.isArray(rows) && rows.length > 0) return rows
    writeLocalJson(MOCK_ENTRIES_KEY, defaultEntries)
    return defaultEntries
  }
}

export async function saveLlmWikiEntry(payload = {}) {
  const body = {
    ...payload,
    updatedAt: nowText(),
  }
  try {
    const response = await requestWithFallback('/api/llm-wiki/entries', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const result = await parseJson(response)
    return result?.data || body
  } catch {
    const rows = readLocalJson(MOCK_ENTRIES_KEY, defaultEntries)
    const key = String(body.key || '')
    let next = []
    if (key && rows.some((x) => String(x.key) === key)) {
      next = rows.map((x) => (String(x.key) === key ? { ...x, ...body } : x))
    } else {
      next = [{ ...body, key: `e${Date.now()}`, sourceCount: Number(body.sourceCount || 1) }, ...rows]
    }
    writeLocalJson(MOCK_ENTRIES_KEY, next)
    return next[0]
  }
}

export async function deleteLlmWikiEntry(key) {
  const id = String(key || '').trim()
  if (!id) return true
  try {
    const response = await requestWithFallback(`/api/llm-wiki/entries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(),
    })
    await parseJson(response)
    return true
  } catch {
    const rows = readLocalJson(MOCK_ENTRIES_KEY, defaultEntries)
    const next = rows.filter((x) => String(x.key) !== id)
    writeLocalJson(MOCK_ENTRIES_KEY, next)
    return true
  }
}

export async function fetchLlmWikiSettings() {
  try {
    const response = await requestWithFallback('/api/llm-wiki/settings', {
      headers: buildAuthHeaders(),
    })
    const result = await parseJson(response)
    return { ...defaultSettings, ...(result?.data || {}) }
  } catch {
    const cfg = readLocalJson(MOCK_SETTINGS_KEY, defaultSettings)
    return { ...defaultSettings, ...(cfg || {}) }
  }
}

export async function saveLlmWikiSettings(payload = {}) {
  try {
    const response = await requestWithFallback('/api/llm-wiki/settings', {
      method: 'PUT',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    })
    const result = await parseJson(response)
    return { ...defaultSettings, ...(result?.data || {}) }
  } catch {
    const next = { ...defaultSettings, ...(payload || {}) }
    writeLocalJson(MOCK_SETTINGS_KEY, next)
    return next
  }
}

