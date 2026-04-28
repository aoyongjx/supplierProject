import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const directApiBase = (import.meta.env.VITE_API_DIRECT_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  for (let round = 0; round < 2; round += 1) {
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
        if (response.status === 502 && round === 0) {
          await sleep(300)
          continue
        }
        return response
      } catch {
        // try next endpoint
      }
    }
    if (round === 0) await sleep(300)
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

export async function fetchSuppliers(params = {}) {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.keyword) query.set('keyword', String(params.keyword))
  if (params.nodeId) query.set('nodeId', String(params.nodeId))
  const response = await requestWithFallback(`/api/suppliers?${query.toString()}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchSupplierDetail(id) {
  const response = await requestWithFallback(`/api/suppliers/${encodeURIComponent(String(id))}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function createSupplier(payload) {
  const response = await requestWithFallback('/api/suppliers', {
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

export async function updateSupplier(id, payload) {
  const response = await requestWithFallback(`/api/suppliers/${encodeURIComponent(String(id))}`, {
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

export async function deleteSupplier(id) {
  const response = await requestWithFallback(`/api/suppliers/item/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function batchDeleteSuppliers(ids) {
  const response = await requestWithFallback('/api/suppliers/batch-delete', {
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

export async function clearAllSuppliers() {
  const response = await requestWithFallback('/api/suppliers/clear-all', {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchCodexModels() {
  const response = await requestWithFallback('/api/codex/models', {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function fetchCrawlSkills() {
  const response = await requestWithFallback('/api/crawl/skills', {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function createSupplierSourceCrawlTask(payload) {
  const response = await requestTaskWithDual('/api/suppliers/source-crawl-tasks', {
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
  const includeProfile = options?.includeProfile !== false
  const profileSource = String(options?.profileSource || '').trim()
  const importTarget = String(options?.importTarget || '').trim()
  const response = await requestTaskWithDual(`/api/supplier-crawl-tasks/${encodeURIComponent(String(taskId))}/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({
      includeProfile,
      profileSource,
      importTarget,
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
