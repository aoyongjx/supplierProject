import { clearTokens, getAccessToken } from '../auth/token'

function buildHeaders(extra = {}) {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    clearTokens()
    if (window.location.pathname !== '/login') window.location.replace('/login')
    throw new Error(payload?.message || '登录已失效，请重新登录')
  }
  if (!response.ok) throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`)
  return payload?.data
}

export async function fetchDataSources() {
  const response = await fetch('/api/data-sources', { headers: buildHeaders() })
  return await parseResponse(response)
}

export async function testDataSourceConnection(payload) {
  const response = await fetch('/api/data-sources/test', {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {}),
  })
  return await parseResponse(response)
}

export async function createDataSource(payload) {
  const response = await fetch('/api/data-sources', {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {}),
  })
  return await parseResponse(response)
}

export async function updateDataSource(id, payload) {
  const response = await fetch(`/api/data-sources/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload || {}),
  })
  return await parseResponse(response)
}

export async function deleteDataSource(id) {
  const response = await fetch(`/api/data-sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  })
  return await parseResponse(response)
}

export async function fetchDataSourceSchema(id) {
  const response = await fetch(`/api/data-sources/${encodeURIComponent(id)}/schema`, { headers: buildHeaders() })
  return await parseResponse(response)
}

export async function fetchDataSourceTablePreview(id, schema, table) {
  const query = new URLSearchParams({ schema: String(schema || ''), table: String(table || '') }).toString()
  const response = await fetch(`/api/data-sources/${encodeURIComponent(id)}/table-preview?${query}`, { headers: buildHeaders() })
  return await parseResponse(response)
}

export async function runDataSourceSql(id, sql) {
  const response = await fetch(`/api/data-sources/${encodeURIComponent(id)}/query`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ sql }),
  })
  return await parseResponse(response)
}
