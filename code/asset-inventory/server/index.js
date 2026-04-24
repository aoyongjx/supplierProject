import cors from 'cors'
import express from 'express'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

const inventories = [
  {
    id: 1,
    assetCode: 'LTP-2026-0001',
    assetName: 'ThinkPad T14',
    department: '研发中心',
    owner: '张三',
    status: '已确认',
    checkDate: '2026-04-17',
    remark: '',
    updateTime: '2026-04-17 16:20',
  },
  {
    id: 2,
    assetCode: 'MON-2026-0118',
    assetName: 'Dell U2723QE',
    department: '财务部',
    owner: '李四',
    status: '待确认',
    checkDate: '2026-04-17',
    remark: '',
    updateTime: '2026-04-17 15:06',
  },
]

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'asset-inventory-api' })
})

app.get('/api/inventories', (_req, res) => {
  res.json({ data: inventories })
})

app.post('/api/inventories', (req, res) => {
  const { assetCode, assetName, department, owner, status, checkDate, remark = '' } = req.body

  if (!assetCode || !assetName || !department || !owner || !status || !checkDate) {
    return res.status(400).json({ message: '缺少必填字段' })
  }

  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const updateTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

  const newItem = {
    id: Date.now(),
    assetCode,
    assetName,
    department,
    owner,
    status,
    checkDate,
    remark,
    updateTime,
  }
  inventories.unshift(newItem)

  return res.status(201).json({ data: newItem })
})

app.listen(port, () => {
  console.log(`Asset inventory API is running on http://localhost:${port}`)
})
