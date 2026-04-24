import { clearTokens, getAccessToken } from '../auth/token'

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

export async function fetchStockOverview(limit = 500) {
  const response = await fetch(`/api/stocks/overview?limit=${encodeURIComponent(String(limit))}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const payload = await parseJson(response)
  return payload.data ?? []
}

export async function fetchStockKline({ symbol, cycle, from, to }) {
  const params = new URLSearchParams({
    symbol: symbol || '',
    cycle: cycle || '1d',
  })
  if (from) params.set('from', from)
  if (to) params.set('to', to)

  const response = await fetch(`/api/stocks/kline?${params.toString()}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  })
  const payload = await parseJson(response)
  return payload.data
}
