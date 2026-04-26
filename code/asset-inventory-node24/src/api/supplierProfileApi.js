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

function buildSupplierProfileQuery(params = {}) {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.keyword) query.set('keyword', String(params.keyword))
  if (params.view) query.set('view', String(params.view))
  const queryText = query.toString()
  return queryText ? `?${queryText}` : ''
}

export async function fetchSupplierProfiles(params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles${buildSupplierProfileQuery(params)}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchSupplierProfileOptions(params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles/options${buildSupplierProfileQuery(params)}`, {
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

export async function fetchSupplierProfileDetail(id, params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles/${encodeURIComponent(String(id))}${buildSupplierProfileQuery(params)}`, {
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function createSupplierProfile(payload, params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles${buildSupplierProfileQuery(params)}`, {
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

export async function updateSupplierProfile(id, payload, params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles/${encodeURIComponent(String(id))}${buildSupplierProfileQuery(params)}`, {
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

export async function deleteSupplierProfile(id, params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles/${encodeURIComponent(String(id))}${buildSupplierProfileQuery(params)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function batchDeleteSupplierProfiles(ids, params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles/batch-delete${buildSupplierProfileQuery(params)}`, {
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

export async function clearAllSupplierProfiles(params = {}) {
  const response = await requestWithFallback(`/api/supplier-profiles/clear-all${buildSupplierProfileQuery(params)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}
