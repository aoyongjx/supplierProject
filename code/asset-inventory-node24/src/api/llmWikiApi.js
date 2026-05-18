import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const directApiBaseRaw = String(import.meta.env.VITE_API_DIRECT_BASE || 'http://127.0.0.1:3000').trim()
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
    // Some deployments proxy /api differently and may return 404 at the primary origin.
    if (enableFallback && (response.status === 502 || response.status === 404)) return await fallback()
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

async function requestFirstSuccess(paths = [], init = {}) {
  let lastError = null
  for (const path of paths) {
    try {
      const response = await requestWithFallback(path, init)
      const payload = await parseJson(response)
      return payload
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('请求失败')
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

function normalizeSectionForDelete(category = '') {
  const token = String(category || '').toLowerCase()
  if (token.includes('raw') || token.includes('原始')) return 'raw'
  if (token.includes('企业') || token.includes('entities')) return 'entities'
  if (token.includes('产品') || token.includes('concepts') || token.includes('概念')) return 'concepts'
  if (token.includes('认证') || token.includes('sources') || token.includes('来源')) return 'sources'
  if (token.includes('专题') || token.includes('comparisons') || token.includes('对比')) return 'comparisons'
  if (token.includes('overview') || token.includes('总览')) return 'overview'
  if (token.includes('log') || token.includes('日志')) return 'logs'
  return 'inbox'
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

export async function clearLlmWikiEntriesBySection(section) {
  const sec = String(section || '').trim()
  if (!sec) throw new Error('缺少section')
  try {
    const response = await requestWithFallback(`/api/llm-wiki/entries?section=${encodeURIComponent(sec)}`, {
      method: 'DELETE',
      headers: buildAuthHeaders(),
    })
    const result = await parseJson(response)
    return result?.data || { section: sec, deletedCount: 0 }
  } catch (error) {
    // Some deployments miss this bulk-delete route; fallback to per-entry deletion.
    const messageText = String(error?.message || '')
    if (!messageText.includes('HTTP 404')) throw error
    const rows = await fetchLlmWikiEntries()
    const list = Array.isArray(rows) ? rows : []
    const targetIds = list
      .filter((item) => normalizeSectionForDelete(item?.category) === sec)
      .map((item) => String(item?.key || item?.id || '').trim())
      .filter(Boolean)
    let deletedCount = 0
    for (const id of targetIds) {
      await deleteLlmWikiEntry(id)
      deletedCount += 1
    }
    return { section: sec, deletedCount }
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

export async function triggerLlmWikiSync(sourceType = 'db', options = {}) {
  const source = String(sourceType || 'db').toLowerCase()
  const body = {
    ...options,
    limit: Math.max(1, Math.min(1000, Number(options.limit || 200) || 200)),
  }
  try {
    const response = await requestWithFallback(`/api/llm-wiki/sync/${encodeURIComponent(source)}`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const result = await parseJson(response)
    return result?.data || null
  } catch (error) {
    throw new Error(error?.message || '执行Wiki同步失败')
  }
}

export async function fetchLlmWikiSyncDbTables() {
  try {
    const response = await requestWithFallback('/api/llm-wiki/sync/db-tables', {
      headers: buildAuthHeaders(),
    })
    const result = await parseJson(response)
    return Array.isArray(result?.data) ? result.data : []
  } catch (error) {
    throw new Error(error?.message || '读取数据库表失败')
  }
}

export async function fetchLlmWikiSyncTasks(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20) || 20))
  try {
    const response = await requestWithFallback(`/api/llm-wiki/sync-tasks?limit=${safeLimit}`, {
      headers: buildAuthHeaders(),
    })
    const result = await parseJson(response)
    return Array.isArray(result?.data) ? result.data : []
  } catch (error) {
    throw new Error(error?.message || '读取Wiki同步任务失败')
  }
}

export async function deleteLlmWikiSyncTask(id = '') {
  const taskId = String(id || '').trim()
  if (!taskId) throw new Error('缺少任务ID')
  const response = await requestWithFallback(`/api/llm-wiki/sync-tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: {
      ...buildAuthHeaders(),
      'Content-Type': 'application/json',
    },
  })
  const result = await parseJson(response)
  return result?.data || { deletedCount: 0 }
}

export async function batchDeleteLlmWikiSyncTasks(ids = []) {
  const list = Array.isArray(ids) ? ids.map((x) => String(x || '').trim()).filter(Boolean) : []
  if (list.length === 0) throw new Error('请提供有效 ids')
  const response = await requestWithFallback('/api/llm-wiki/sync-tasks', {
    method: 'DELETE',
    headers: {
      ...buildAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ids: list }),
  })
  const result = await parseJson(response)
  return result?.data || { deletedCount: 0 }
}

export async function cancelLlmWikiSyncTask(id = '') {
  const taskId = String(id || '').trim()
  if (!taskId) throw new Error('缺少任务ID')
  const response = await requestWithFallback(`/api/llm-wiki/sync-tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(),
      'Content-Type': 'application/json',
    },
  })
  const result = await parseJson(response)
  return result?.data || null
}

export async function fetchLlmWikiSyncRagKbs() {
  try {
    const response = await requestWithFallback('/api/llm-wiki/sync/rag-kbs', {
      headers: buildAuthHeaders(),
    })
    const result = await parseJson(response)
    return Array.isArray(result?.data) ? result.data : []
  } catch (error) {
    throw new Error(error?.message || '读取RAG知识库列表失败')
  }
}

export async function fetchLlmWikiSectionCounts() {
  const response = await requestWithFallback('/api/llm-wiki/section-counts', {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result?.data || {
    raw: 0,
    inbox: 0,
    sources: 0,
    entities: 0,
    concepts: 0,
    comparisons: 0,
    overview: 0,
    logs: 0,
  }
}

export async function syncLlmWikiGraph() {
  const result = await requestFirstSuccess(
    [
      '/api/llm-wiki/graph/sync',
      '/api/llm-wiki/sync/graph',
      '/api/llm-wiki/graph-sync',
    ],
    {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
    },
  )
  return result?.data || { nodeCount: 0, edgeCount: 0 }
}

export async function fetchLlmWikiGraph(options = {}) {
  const query = new URLSearchParams()
  if (options.category) query.set('category', String(options.category))
  if (options.status) query.set('status', String(options.status))
  if (options.keyword) query.set('keyword', String(options.keyword))
  if (options.onlyConfirmed === true) query.set('onlyConfirmed', 'true')
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const result = await requestFirstSuccess(
    [
      `/api/llm-wiki/graph${suffix}`,
      `/api/llm-wiki/graphs${suffix}`,
      `/api/llm-wiki/graph-data${suffix}`,
    ],
    {
      headers: buildAuthHeaders(),
    },
  )
  return result?.data || { nodes: [], links: [] }
}

export async function importLlmWikiRawMaterials(payload = {}) {
  const result = await requestFirstSuccess(
    [
      '/api/llm-wiki/raw-import',
      '/api/llm-wiki/raw/import',
      '/api/llm-wiki/import/raw',
    ],
    {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    },
  )
  return result?.data || null
}

export async function fetchLlmWikiRawImportItems(bucket = 'papers', limit = 50) {
  const safeBucket = String(bucket || 'papers').trim().toLowerCase()
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50) || 50))
  const query = `?bucket=${encodeURIComponent(safeBucket)}&limit=${safeLimit}`
  const result = await requestFirstSuccess(
    [
      `/api/llm-wiki/raw-import/items${query}`,
      `/api/llm-wiki/raw/import/items${query}`,
      `/api/llm-wiki/import/raw/items${query}`,
    ],
    {
      headers: buildAuthHeaders(),
    },
  )
  return Array.isArray(result?.data) ? result.data : []
}

export async function previewLlmWikiRawImportItem(id) {
  const itemId = encodeURIComponent(String(id || '').trim())
  if (!itemId) throw new Error('缺少记录ID')
  const result = await requestFirstSuccess(
    [
      `/api/llm-wiki/raw-import/items/${itemId}/preview`,
      `/api/llm-wiki/raw/import/items/${itemId}/preview`,
    ],
    { headers: buildAuthHeaders() },
  )
  return result?.data || null
}

export async function deleteLlmWikiRawImportItem(id) {
  const itemId = encodeURIComponent(String(id || '').trim())
  if (!itemId) throw new Error('缺少记录ID')
  const result = await requestFirstSuccess(
    [
      `/api/llm-wiki/raw-import/items/${itemId}`,
      `/api/llm-wiki/raw/import/items/${itemId}`,
    ],
    {
      method: 'DELETE',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
    },
  )
  return result?.data || null
}

export async function resyncLlmWikiRawImportItem(id) {
  const itemId = encodeURIComponent(String(id || '').trim())
  if (!itemId) throw new Error('缺少记录ID')
  const result = await requestFirstSuccess(
    [
      `/api/llm-wiki/raw-import/items/${itemId}/resync`,
      `/api/llm-wiki/raw/import/items/${itemId}/resync`,
    ],
    {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
    },
  )
  return result?.data || null
}
