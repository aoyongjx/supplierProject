import { clearTokens, getAccessToken } from '../auth/token'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const directApiBase = (import.meta.env.VITE_API_DIRECT_BASE || 'http://localhost:3000').replace(/\/+$/, '')

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

export async function fetchMcpServices() {
  const response = await requestWithFallback('/api/mcp-services', { headers: buildAuthHeaders() })
  const result = await parseJson(response)
  return Array.isArray(result.data) ? result.data : []
}

export async function installMcpService(payload) {
  const response = await requestWithFallback('/api/mcp-services/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function updateMcpService(name, payload) {
  const response = await requestWithFallback(`/api/mcp-services/${encodeURIComponent(String(name))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify(payload || {}),
  })
  const result = await parseJson(response)
  return result.data
}

export async function toggleMcpService(name, enabled, description = '') {
  const response = await requestWithFallback(`/api/mcp-services/${encodeURIComponent(String(name))}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...buildAuthHeaders() },
    body: JSON.stringify({ enabled, description }),
  })
  const result = await parseJson(response)
  return result.data
}

export async function uninstallMcpService(name) {
  const response = await requestWithFallback(`/api/mcp-services/${encodeURIComponent(String(name))}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  })
  const result = await parseJson(response)
  return result.data
}
