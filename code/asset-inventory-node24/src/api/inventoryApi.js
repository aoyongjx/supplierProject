import { clearTokens, getAccessToken } from '../auth/token'

const API_BASE = '/api'

function buildAuthHeaders() {
  const token = getAccessToken() || import.meta.env.VITE_AUTH_TOKEN || ''
  return token ? { Authorization: `Bearer ${token}` } : {}
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

export async function fetchInventories() {
  const response = await fetch(`${API_BASE}/inventories`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data ?? []
}

export async function fetchInventoryById(id) {
  const response = await fetch(`${API_BASE}/inventories/${encodeURIComponent(String(id))}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data
}

export async function submitInventory(payload) {
  const response = await fetch(`${API_BASE}/inventories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload),
  })
  const result = await parseJson(response)
  return result.data
}

export async function updateInventory(id, payload) {
  const response = await fetch(`${API_BASE}/inventories/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify(payload),
  })
  const result = await parseJson(response)
  return result.data
}

export async function deleteInventory(id) {
  const response = await fetch(`${API_BASE}/inventories/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const result = await parseJson(response)
  return result.data
}

export async function batchDeleteInventories(ids) {
  const response = await fetch(`${API_BASE}/inventories/batch`, {
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
