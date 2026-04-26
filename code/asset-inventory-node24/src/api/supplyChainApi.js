import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const directApiBase = (import.meta.env.VITE_API_DIRECT_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '')

async function requestWithFallback(path, init = {}) {
  const primary = async () => fetch(path, init)
  const fallback = async () => fetch(`${directApiBase}${path}`, init)
  try {
    const response = await primary()
    if (response.status === 502) {
      return await fallback()
    }
    return response
  } catch {
    return await fallback()
  }
}

async function requestTaskWithDual(path, init = {}) {
  const method = String(init?.method || 'GET').toUpperCase()
  const safeMethod = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
  if (!safeMethod) {
    try {
      const response = await fetch(path, init)
      if (response.status === 502) {
        return await fetch(`${directApiBase}${path}`, init)
      }
      return response
    } catch {
      return fetch(`${directApiBase}${path}`, init)
    }
  }
  const attempts = [
    async () => fetch(path, init),
    async () => fetch(`${directApiBase}${path}`, init),
  ]
  let lastNotFoundResponse = null
  for (const attempt of attempts) {
    try {
      const response = await attempt()
      if (response.ok) return response
      const payload = await response.clone().json().catch(() => ({}))
      const message = String(payload?.message || '')
      if (response.status === 404 && message.includes('任务不存在')) {
        lastNotFoundResponse = response
        continue
      }
      return response
    } catch {
      // try next endpoint
    }
  }
  if (lastNotFoundResponse) return lastNotFoundResponse
  return fetch(`${directApiBase}${path}`, init)
}

async function parseJson(response, options = {}) {
  const { redirectOn401 = true } = options
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearTokens()
    if (redirectOn401 && window.location.pathname !== '/login') {
      window.location.replace('/login')
    }
    throw new Error(payload.message || '登录已失效，请重新登录')
  }
  if (!response.ok) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  }
  return payload
}

export async function importSupplyChainCsv(payload) {
  const response = await requestWithFallback('/api/supply-chain/import-csv', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function clearAllSupplyChain() {
  const response = await requestWithFallback('/api/supply-chain/clear-all', {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchSupplyChainRecords(params = {}) {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.keyword) query.set('keyword', String(params.keyword))
  if (params.parentKeyword) query.set('parentKeyword', String(params.parentKeyword))
  const response = await requestWithFallback(`/api/supply-chain/records?${query.toString()}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchSupplyChainRecordDetail(id) {
  const response = await requestWithFallback(`/api/supply-chain/records/${encodeURIComponent(String(id))}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response, { redirectOn401: false })
  return result.data
}

export async function createSupplyChainRecord(payload) {
  const response = await requestWithFallback('/api/supply-chain/records', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function updateSupplyChainRecord(id, payload) {
  const response = await requestWithFallback(`/api/supply-chain/records/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function deleteSupplyChainRecord(id) {
  const response = await requestWithFallback(`/api/supply-chain/records/item/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function batchDeleteSupplyChainRecords(ids) {
  const response = await requestWithFallback('/api/supply-chain/records/batch-delete', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ ids }),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchSupplyChainTree(params = {}) {
  const query = new URLSearchParams()
  if (params.sourceUrl) query.set('sourceUrl', String(params.sourceUrl))
  const response = await requestWithFallback(`/api/supply-chain/tree?${query.toString()}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response, { redirectOn401: false })
  return result.data
}

export async function fetchCodexModels() {
  const response = await requestWithFallback('/api/codex/models', { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function fetchCrawlSkills() {
  const response = await requestWithFallback('/api/crawl/skills', { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function precheckCrawlEnvironment(options = {}) {
  const query = new URLSearchParams()
  if (options?.skill) query.set('skill', String(options.skill))
  const response = await requestWithFallback(`/api/crawl/precheck?${query.toString()}`, {
    headers: buildAuthHeaders(),
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 404) {
    return {
      ready: false,
      checks: [
        { name: 'precheck-endpoint', ready: false, message: '后端未提供 /api/crawl/precheck（通常是后端未重启到最新代码）' },
      ],
      steps: [
        '重启后端服务（Node）到最新版本。',
        '确认 web-access 服务已启动，并保持可连接。',
        '使用 Chrome 打开目标网页并完成加载后，点击“检测环境”。',
      ],
      hint: '检测接口不存在，当前无法自动判断环境。',
    }
  }
  if (response.status === 401) {
    clearTokens()
    if (window.location.pathname !== '/login') {
      window.location.replace('/login')
    }
    throw new Error(payload.message || '登录已失效，请重新登录')
  }
  if (!response.ok) {
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  }
  return payload.data || { ready: true, checks: [] }
}

export async function createSupplierCrawlTask(nodeId, payload) {
  const response = await requestTaskWithDual(`/api/supply-chain/nodes/${encodeURIComponent(String(nodeId))}/supplier-crawl-tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchSupplierCrawlTask(taskId) {
  const response = await requestTaskWithDual(`/api/supplier-crawl-tasks/${encodeURIComponent(String(taskId))}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function importSupplierCrawlTask(taskId, options = {}) {
  const includeProfile = options?.includeProfile === true
  const profileSource = typeof options?.profileSource === 'string' ? options.profileSource : ''
  const response = await requestTaskWithDual(`/api/supplier-crawl-tasks/${encodeURIComponent(String(taskId))}/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({
      includeProfile,
      profileSource,
    }),
  })
  const result = await parseJson(response)
  return result.data
}

export async function cancelSupplierCrawlTask(taskId) {
  const response = await requestTaskWithDual(`/api/supplier-crawl-tasks/${encodeURIComponent(String(taskId))}/cancel`, {
    method: 'POST',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}
