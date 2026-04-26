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

async function parseJson(response) {
  const payload = await response.json().catch(() => ({}))
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
  return payload
}

export async function fetchGasOems(params = {}) {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.keyword) query.set('keyword', String(params.keyword))
  const response = await requestWithFallback(`/api/gas-oems?${query.toString()}`, { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchGasOemDetail(id) {
  const response = await requestWithFallback(`/api/gas-oems/${encodeURIComponent(String(id))}`, { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return result.data
}

export async function createGasOem(payload) {
  const response = await requestWithFallback('/api/gas-oems', {
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

export async function updateGasOem(id, payload) {
  const response = await requestWithFallback(`/api/gas-oems/${encodeURIComponent(String(id))}`, {
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

export async function deleteGasOem(id) {
  const response = await requestWithFallback(`/api/gas-oems/item/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function batchDeleteGasOems(ids = []) {
  const response = await requestWithFallback('/api/gas-oems/batch-delete', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
  })
  const result = await parseJson(response)
  return result.data
}

export async function clearAllGasOems() {
  const response = await requestWithFallback('/api/gas-oems/clear-all', {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchCodexModels() {
  const response = await requestWithFallback('/api/codex/models', { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function createGasOemSyncTask(payload) {
  const body = payload || {}
  const response = await requestTaskWithDual('/api/suppliers/source-crawl-tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({
      nodeName: '整车厂',
      crawlMode: 'list',
      ...body,
    }),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchGasOemSyncTask(taskId) {
  const response = await requestTaskWithDual(`/api/supplier-crawl-tasks/${encodeURIComponent(String(taskId))}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function cancelGasOemSyncTask(taskId) {
  const response = await requestTaskWithDual(`/api/supplier-crawl-tasks/${encodeURIComponent(String(taskId))}/cancel`, {
    method: 'POST',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function importGasOemSyncTask(taskId) {
  const response = await requestTaskWithDual(`/api/gas-oems/sync-tasks/${encodeURIComponent(String(taskId))}/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({}),
  })
  const result = await parseJson(response)
  return result.data
}
