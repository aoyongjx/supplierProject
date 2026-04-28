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
    if (response.status === 502) return await fallback()
    return response
  } catch {
    return await fallback()
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

function buildQuery(params = {}) {
  const query = new URLSearchParams()
  query.set('view', 'gas')
  if (params.limit) query.set('limit', String(params.limit))
  if (params.keyword) query.set('keyword', String(params.keyword))
  const text = query.toString()
  return text ? `?${text}` : ''
}

export async function fetchGasSupplierProfiles(params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles${buildQuery(params)}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchGasSupplierProfileOptions() {
  const response = await requestWithFallback('/api/supplier-profiles/options?view=gas', {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data ?? {
    oemOptions: [],
    countryOptions: [],
    certificationOptions: [],
    sourceOptions: [],
    supplyChainTree: [],
  }
}

export async function fetchGasSupplierProfileDetail(id) {
  const response = await requestWithFallback(`/api/supplier-profiles/${encodeURIComponent(String(id))}?view=gas`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function createGasSupplierProfile(payload) {
  const response = await requestWithFallback('/api/supplier-profiles?view=gas', {
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

export async function updateGasSupplierProfile(id, payload) {
  const response = await requestWithFallback(`/api/supplier-profiles/${encodeURIComponent(String(id))}?view=gas`, {
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

export async function deleteGasSupplierProfile(id) {
  const response = await requestWithFallback(`/api/supplier-profiles/${encodeURIComponent(String(id))}?view=gas`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function batchDeleteGasSupplierProfiles(ids = []) {
  const response = await requestWithFallback('/api/supplier-profiles/batch-delete?view=gas', {
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

export async function clearAllGasSupplierProfiles() {
  const response = await requestWithFallback('/api/supplier-profiles/clear-all?view=gas', {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function fetchGasSupplierPortraitSettings() {
  const response = await requestWithFallback('/api/gas-supplier-portrait-settings', {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data ?? {}
}

export async function saveGasSupplierPortraitSettings(payload) {
  const response = await requestWithFallback('/api/gas-supplier-portrait-settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data ?? {}
}
