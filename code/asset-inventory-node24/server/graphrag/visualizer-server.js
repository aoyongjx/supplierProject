import express from 'express'

const app = express()
const port = Number(process.env.GRAPHRAG_PORT || 3190)

app.use(express.static('public/graphrag'))

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'graphrag-visualizer', port })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`[graphrag] visualizer listening at http://localhost:${port}`)
})
