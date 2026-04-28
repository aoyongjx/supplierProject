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

export async function fetchGasSuppliers(params = {}) {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.keyword) query.set('keyword', String(params.keyword))
  if (params.nodeId) query.set('nodeId', String(params.nodeId))
  const response = await requestWithFallback(`/api/gas-suppliers?${query.toString()}`, { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchGasSupplierDetail(id) {
  const response = await requestWithFallback(`/api/gas-suppliers/${encodeURIComponent(String(id))}`, { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return result.data
}

export async function createGasSupplier(payload) {
  const response = await requestWithFallback('/api/gas-suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function updateGasSupplier(id, payload) {
  const response = await requestWithFallback(`/api/gas-suppliers/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function deleteGasSupplier(id) {
  const response = await requestWithFallback(`/api/gas-suppliers/item/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}

export async function batchDeleteGasSuppliers(ids) {
  const response = await requestWithFallback('/api/gas-suppliers/batch-delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify({ ids }),
  })
  const result = await parseJson(response)
  return result.data
}

export async function clearAllGasSuppliers() {
  const response = await requestWithFallback('/api/gas-suppliers/clear-all', {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}
