const API_BASE = '/api'

export async function getInventories() {
  const response = await fetch(`${API_BASE}/inventories`)
  if (!response.ok) {
    throw new Error('获取盘点列表失败')
  }
  const result = await response.json()
  return result.data ?? []
}

export async function createInventory(payload) {
  const response = await fetch(`${API_BASE}/inventories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || '提交失败')
  }

  const result = await response.json()
  return result.data
}
