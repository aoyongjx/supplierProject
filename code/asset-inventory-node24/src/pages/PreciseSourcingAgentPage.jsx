import { AppstoreOutlined, DeploymentUnitOutlined, FullscreenExitOutlined, FullscreenOutlined, InfoCircleOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons'
import { Avatar, Button, Card, Checkbox, Collapse, Empty, Input, Modal, Select, Slider, Space, Table, Tabs, Tag, Tooltip, Typography, Upload, message } from 'antd'
import { CanvasWidget, SelectionBoxLayerFactory } from '@projectstorm/react-canvas-core'
import { DefaultDiagramState, DiagramEngine, DiagramModel, LinkLayerFactory, NodeLayerFactory } from '@projectstorm/react-diagrams-core'
import { DefaultLinkFactory, DefaultLinkModel, DefaultNodeFactory, DefaultNodeModel, DefaultPortFactory } from '@projectstorm/react-diagrams-defaults'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatPreciseSourcingAgentStream } from '../api/agentApi'
import { fetchKnowledgeBases } from '../api/knowledgeBaseApi'
import { fetchLangchainSessionState, fetchLangchainTools, saveLangchainSessionState } from '../api/langchainShellApi'
import { fetchModelProviders } from '../api/modelManagementApi'
import { testModelProvider } from '../api/modelManagementApi'
import assistantAvatarSrc from '../assets/chatchat_icon_blue_square_v2.png'

const { Text } = Typography

const DB_OPTIONS = [
  { label: 'PostgreSQL(main/public) / suppliers', value: 'main.suppliers' },
  { label: 'PostgreSQL(main/public) / supplier_profiles', value: 'main.supplier_profiles' },
  { label: 'PostgreSQL(main/public) / supply_chain_node', value: 'main.supply_chain_node' },
  { label: 'PostgreSQL(main/public) / gas_supply_chain_node', value: 'main.gas_supply_chain_node' },
  { label: 'PostgreSQL(main/public) / gas_suppliers', value: 'main.gas_suppliers' },
  { label: 'PostgreSQL(main/public) / gas_supplier_profiles', value: 'main.gas_supplier_profiles' },
  { label: 'PostgreSQL(main/public) / gas_oems', value: 'main.gas_oems' },
  { label: 'PostgreSQL(main/public) / inventories', value: 'main.inventories' },
]

const TEMPLATE_TYPE_OPTIONS = [
  { label: '无', value: 'none' },
  { label: 'PPT 模板', value: 'ppt' },
  { label: 'Word 模板', value: 'word' },
  { label: 'Excel 模板', value: 'excel' },
]
const PRECISE_SOURCING_TOOL_KEYS = new Set(['db_chat', 'local_kb', 'web_search', 'image_gen', 'python_chart_generator', 'file_exporter'])
const REQUIRED_PRECISE_TOOL_OPTIONS = [
  { key: 'db_chat', label: '数据库检索' },
  { key: 'local_kb', label: '知识库检索' },
  { key: 'web_search', label: '互联网搜索' },
  { key: 'image_gen', label: '图片生成' },
  { key: 'python_chart_generator', label: '图表生成' },
  { key: 'file_exporter', label: '文件导出' },
]
const TOOL_LABEL_MAP = {
  db_chat: '数据库检索',
  local_kb: '知识库检索',
  web_search: '互联网搜索',
  image_gen: '图片生成',
  python_chart_generator: '图表生成',
  file_exporter: '文件导出',
}
const MODEL_STORAGE_KEY = 'precise_sourcing_selected_model_v1'
const FLOW_NODE_STYLE = {
  border: '1px solid #dbeafe',
  background: '#eff6ff',
  borderRadius: 8,
  padding: '8px 10px',
}
const DEFAULT_SYSTEM_PROMPT = `你是汽车供应链精准寻源助手。
目标：基于数据库/知识库/互联网证据，为用户输出可执行的候选供应商建议。
要求：
1) 优先给结论，再给证据与下一步。
2) 候选供应商输出TopN（由证据质量决定），并优先按rerank分数与证据强度排序。
3) 输出必须使用Markdown结构，且优先表格化，不要大段连写文本。
4) 至少包含两张表：
   - 候选供应商TopN表：排名｜供应商｜关联主机厂｜结论等级｜Rerank分｜证据强度｜主要依据｜风险/缺口｜建议动作
   - 证据摘要表：来源(DB/RAG/WEB)｜证据片段｜关联供应商｜匹配类型｜置信度｜可追溯链接
5) 另附“明确不足/待核验”和“下一步检索建议”两个小节，使用编号列表。
6) 不编造；无证据时明确说明并给补充检索建议。输出中文。`
const PROMPT_PRESETS = [
  {
    key: 'default',
    label: '默认平衡版',
    prompt: DEFAULT_SYSTEM_PROMPT,
  },
  {
    key: 'risk',
    label: '严格采购风控版',
    prompt: `你是汽车供应链采购风控助手。
目标：优先控制风险，再推荐候选供应商。
要求：
1) 先给风险结论（高/中/低）与原因，再给候选。
2) 输出必须使用Markdown表格，候选按风险优先级与rerank分排序。
3) 候选表字段：排名｜供应商｜风险等级｜Rerank分｜关键风险｜证据依据｜核验项。
4) 证据表字段：来源｜证据片段｜关联供应商｜置信度｜可追溯链接。
5) 证据不足时必须标注“待核验”，禁止主观推断。输出中文。`,
  },
  {
    key: 'fast',
    label: '快速线索筛选版',
    prompt: `你是汽车供应链线索筛选助手。
目标：快速给出可跟进的供应商线索清单。
要求：
1) 先直接回答，再给TopN候选。
2) 输出使用Markdown，候选列表必须为表格：排名｜供应商｜Rerank分｜一句话理由｜推荐动作。
3) 再补一张证据简表：来源｜证据片段｜关联供应商。
4) 控制篇幅，优先高相关结果；无命中就给替代关键词。中文输出。`,
  },
]

function normalizeLlmMarkdownForRender(text = '') {
  let s = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Some model outputs contain escaped newlines as literal "\n".
  s = s.replace(/\\n/g, '\n').trim()
  if (!s) return ''
  // Normalize bracketed section headers like 【RAG参考】 -> markdown headings.
  s = s.replace(/^\s*【\s*([^】\n]+)\s*】\s*$/gm, '## $1')
  s = s.replace(/([^\n])\s*【\s*([^】\n]+)\s*】/g, '$1\n\n## $2')
  // Convert full-width separators to ASCII pipes for table normalization.
  s = s.replace(/｜/g, '|')
  // Some model outputs collapse blocks into one line: "||" often indicates table row boundaries.
  s = s.replace(/\|\|/g, '|\n|')
  // Ensure section headings can start on new lines.
  s = s.replace(/---\s*##/g, '\n\n##')
  s = s.replace(/([^\n])\s*(##{1,6}\s*)/g, '$1\n\n$2')
  s = s.replace(/([^\n])\s*(#{1,6}\s*)/g, '$1\n\n$2')
  // Break glued tail after similarity score, e.g. "...| 相似度=0.4901歌恩电子..."
  s = s.replace(/(\|\s*相似度\s*=\s*\d+(?:\.\d+)?)(?=[\u4e00-\u9fa5A-Za-z#])/g, '$1\n')
  // Ensure horizontal separators are isolated.
  s = s.replace(/([^\n])---([^\n])/g, '$1\n---\n$2')
  // Only normalize pipe spacing for real markdown table rows.
  s = s
    .split('\n')
    .map((line) => {
      const t = String(line || '')
      if (!t.trim().startsWith('|')) return t
      return t.replace(/[ \t]*\|[ \t]*/g, ' | ')
    })
    .join('\n')
    .replace(/\n[ \t]+/g, '\n')
  // Force common table section titles onto their own lines.
  s = s.replace(/##\s*候选供应商TopN表\s*\|/g, '## 候选供应商TopN表\n|')
  s = s.replace(/##\s*证据摘要表\s*\|/g, '## 证据摘要表\n|')
  // Split chained rows that are glued by "||".
  s = s.replace(/\|\|\s*(\d+\s*\|)/g, '\n| $1')
  s = s.replace(/\|\|\s*(DB\s*\|)/gi, '\n| $1')
  s = s.replace(/\|\|\s*(RAG\s*\|)/gi, '\n| $1')
  s = s.replace(/\|\|\s*(WEB\s*\|)/gi, '\n| $1')
  // Remove malformed separator noise lines often produced by model collapse.
  s = s
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^\|?\s*:?\s*\|?\s*$/.test(t)) return false
      if (/^\|\s*---\s*\|\s*$/.test(t)) return false
      return true
    })
    .join('\n')
  // Ensure key tables have a valid markdown separator row.
  const ensureTableSeparator = (input, headerPrefix) => {
    const lines = input.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].includes(headerPrefix) && lines[i].includes('|')) {
        const next = lines[i + 1] || ''
        if (!/^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(next)) {
          const colCount = Math.max(2, lines[i].split('|').filter((x) => x.trim()).length)
          const sep = `| ${Array.from({ length: colCount }).map(() => '---').join(' | ')} |`
          lines.splice(i + 1, 0, sep)
        }
      }
    }
    return lines.join('\n')
  }
  s = ensureTableSeparator(s, '排名')
  s = ensureTableSeparator(s, '来源')
  const splitTableRowsByStarter = (input, sectionTitle, starters = []) => {
    const lines = input.split('\n')
    const sectionIdx = lines.findIndex((x) => x.includes(sectionTitle))
    if (sectionIdx < 0) return input
    const headerIdx = lines.findIndex((x, i) => i > sectionIdx && x.includes('|') && !x.trim().startsWith('| ---'))
    if (headerIdx < 0) return input
    const sepIdx = headerIdx + 1
    let bodyStart = sepIdx + 1
    if (bodyStart >= lines.length) return input
    let bodyEnd = lines.length
    for (let i = bodyStart; i < lines.length; i += 1) {
      if (/^##\s+/.test(lines[i].trim())) {
        bodyEnd = i
        break
      }
    }
    const bodyRaw = lines.slice(bodyStart, bodyEnd).join(' ').replace(/\s+/g, ' ').trim()
    if (!bodyRaw.includes('|')) return input
    let tmp = bodyRaw
    for (const st of starters) {
      if (st === '\\d+') {
        tmp = tmp.replace(/\|\s*(\d+)\s*\|/g, '\n| $1 |')
      } else {
        const re = new RegExp(`\\|\\s*(${st})\\s*\\|`, 'gi')
        tmp = tmp.replace(re, '\n| $1 |')
      }
    }
    const rows = tmp
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.startsWith('|') && x.includes('|'))
      .map((x) => x.replace(/\s+\|\s+/g, ' | ').replace(/[ \t]+/g, ' '))
    if (rows.length === 0) return input
    const merged = [
      ...lines.slice(0, bodyStart),
      ...rows,
      ...lines.slice(bodyEnd),
    ]
    return merged.join('\n')
  }
  s = splitTableRowsByStarter(s, '候选供应商TopN表', ['\\d+'])
  s = splitTableRowsByStarter(s, '证据摘要表', ['DB', 'RAG', 'WEB'])
  // Convert loose pipe-delimited lines into proper markdown tables.
  const convertLoosePipeBlocks = (input) => {
    const lines = input.split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      const line = String(lines[i] || '')
      const loose = !line.trim().startsWith('|') && (line.split('|').length - 1) >= 3
      if (!loose) {
        out.push(line)
        i += 1
        continue
      }
      const block = []
      while (i < lines.length) {
        const cur = String(lines[i] || '')
        const isLoose = !cur.trim().startsWith('|') && (cur.split('|').length - 1) >= 3
        if (!isLoose) break
        block.push(cur)
        i += 1
      }
      const rows = block
        .map((raw) => raw.split('|').map((x) => x.trim()).filter(Boolean))
        .filter((arr) => arr.length >= 3)
      if (rows.length === 0) continue
      const width = rows[0].length
      const normalizedRows = rows
        .map((r) => (r.length === width ? r : r.slice(0, width)))
        .filter((r) => r.length === width)
      if (normalizedRows.length === 0) continue
      const header = `| ${normalizedRows[0].join(' | ')} |`
      const sep = `| ${Array.from({ length: width }).map(() => '---').join(' | ')} |`
      out.push(header, sep)
      for (let k = 1; k < normalizedRows.length; k += 1) out.push(`| ${normalizedRows[k].join(' | ')} |`)
    }
    return out.join('\n')
  }
  s = convertLoosePipeBlocks(s)
  // Split concatenated recommendation rows:
  // e.g. "| 高 | 供应商A | ... || 中 | 供应商B | ..."
  s = s.replace(/\|\|\s*(高|中|低)\s*\|/g, '\n| $1 |')
  // If section has known header but body is a single long row, force row splitting by priority token.
  const splitPriorityRows = (input) => {
    const lines = input.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] || '')
      if (!/\|\s*优先级\s*\|\s*供应商\s*\|/.test(line)) continue
      const bodyIdx = i + 2
      if (bodyIdx >= lines.length) continue
      const body = String(lines[bodyIdx] || '')
      if (!body.startsWith('|')) continue
      if ((body.match(/\|\s*(高|中|低)\s*\|/g) || []).length <= 1) continue
      const chunks = body
        .replace(/^\|\s*/, '')
        .split(/\|\s*(?=高\s*\||中\s*\||低\s*\|)/g)
        .map((x) => x.trim())
        .filter(Boolean)
      if (chunks.length <= 1) continue
      const rebuilt = chunks.map((c) => `| ${c}`)
      lines.splice(bodyIdx, 1, ...rebuilt)
      i += rebuilt.length
    }
    return lines.join('\n')
  }
  s = splitPriorityRows(s)
  // Merge "header + one long concatenated body line" into one proper table:
  // ##建议优先跟进名单 | 优先级 | 供应商 | 推荐原因 | 建议切入点
  // | 高 | A | ... || 高 | B | ... || 中 | C | ...
  const normalizeInlineRecommendationTable = (input) => {
    const lines = input.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const headerLine = String(lines[i] || '').trim()
      if (!/^\s*##/.test(headerLine)) continue
      if (!headerLine.includes('|')) continue
      if (!/优先级/.test(headerLine) || !/供应商/.test(headerLine)) continue
      const parts = headerLine.split('|').map((x) => String(x || '').trim()).filter(Boolean)
      if (parts.length < 4) continue
      const title = parts[0]
      const cols = parts.slice(1)
      const colCount = cols.length
      let bodyIdx = i + 1
      while (bodyIdx < lines.length) {
        const probe = String(lines[bodyIdx] || '').trim()
        if (!probe || /^[-—_]{3,}$/.test(probe)) {
          bodyIdx += 1
          continue
        }
        break
      }
      if (bodyIdx >= lines.length) continue
      const bodyRaw = String(lines[bodyIdx] || '').trim()
      if (!bodyRaw.startsWith('|')) continue
      const body = bodyRaw
        .replace(/\|\|\s*(高|中|低)\s*\|/g, '\n| $1 |')
        .replace(/\|\|\s*/g, '\n| ')
      const chunks = body
        .split('\n')
        .map((x) => x.trim())
        .filter((x) => x.startsWith('|'))
      if (chunks.length === 0) continue
      const rows = []
      for (const rowRaw of chunks) {
        const tokens = rowRaw.split('|').map((x) => x.trim()).filter(Boolean)
        if (tokens.length < colCount) continue
        for (let k = 0; k + colCount <= tokens.length; k += colCount) {
          const g = tokens.slice(k, k + colCount)
          if (g.length !== colCount) continue
          if (!/^(高|中|低)$/.test(g[0])) continue
          rows.push(g)
        }
      }
      if (rows.length === 0) continue
      const tableLines = [
        `${title}`,
        `| ${cols.join(' | ')} |`,
        `| ${Array.from({ length: colCount }).map(() => '---').join(' | ')} |`,
        ...rows.map((r) => `| ${r.join(' | ')} |`),
      ]
      lines.splice(i, 2, ...tableLines)
      i += tableLines.length - 1
    }
    return lines.join('\n')
  }
  s = normalizeInlineRecommendationTable(s)
  // Strict fix: only normalize the "建议优先跟进名单" section into a real markdown table.
  const normalizeRecommendSectionTable = (input) => {
    const toAsciiPipe = (v = '') => String(v || '').replace(/[｜丨│﹨]/g, '|')
    let text = String(input || '')
    const lines = toAsciiPipe(text).split('\n')
    const headerIdx = lines.findIndex((x) => {
      const t = String(x || '').trim()
      if (/^(#{1,6})\s*建议优先跟进名单\b/.test(t)) return true
      if (/^\|/.test(t) && /建议优先跟进名单/.test(t) && /优先级/.test(t) && /供应商/.test(t)) return true
      return false
    })
    if (headerIdx < 0) return text
    let endIdx = lines.length
    for (let i = headerIdx + 1; i < lines.length; i += 1) {
      if (/^#{1,6}\s*/.test(String(lines[i] || '').trim())) {
        endIdx = i
        break
      }
    }
    const sectionLines = lines.slice(headerIdx, endIdx)
    const bodyJoined = sectionLines
      .slice(1)
      .map((x) => String(x || '').trim())
      .filter((x) => x && !/^[-—_]{2,}$/.test(x))
      .join(' ')
      .replace(/\s+/g, ' ')
    if (!bodyJoined) return text
    // Support both "||" and single "|" concatenated rows.
    const normalizedBody = bodyJoined
      .replace(/\|\|\s*(高|中|低)\s*\|/g, '\n| $1 |')
      .replace(/\|\|\s*/g, '\n| ')
      .replace(/(?<!\n)\|\s*(高|中|低)\s*\|/g, '\n| $1 |')
      .trim()
    const chunks = normalizedBody
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
    const rows = []
    for (const chunk of chunks) {
      const cells = toAsciiPipe(chunk).split('|').map((x) => x.trim()).filter(Boolean)
      if (cells.length < 4) continue
      let idx = 0
      while (idx + 3 < cells.length) {
        if (!/^(高|中|低)$/.test(cells[idx])) { idx += 1; continue }
        rows.push([
          cells[idx],
          cells[idx + 1] || '-',
          cells[idx + 2] || '-',
          cells[idx + 3] || '-',
        ])
        idx += 4
      }
    }
    if (rows.length === 0) return text
    const filteredRows = rows.filter((r, idx) => {
      if (idx !== rows.length - 1) return true
      const level = String(r?.[0] || '')
      const supplier = String(r?.[1] || '')
      const reason = String(r?.[2] || '')
      const action = String(r?.[3] || '')
      const isFallbackTail = /^(低)$/i.test(level) && /(其余候选|其他候选|剩余候选|其它候选)/.test(supplier)
      const weakTail = /(证据不足|待补充|不建议|暂不建议)/.test(`${reason} ${action}`)
      return !(isFallbackTail || weakTail)
    })
    const tableRows = filteredRows.length > 0 ? filteredRows : rows
    const tableBlock = [
      '## 建议优先跟进名单',
      '| 优先级 | 供应商 | 推荐原因 | 建议切入点 |',
      '| --- | --- | --- | --- |',
      ...tableRows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`),
    ]
    const merged = [
      ...lines.slice(0, headerIdx),
      ...tableBlock,
      '',
      ...lines.slice(endIdx),
    ]
    let out = merged.join('\n')
    // If optional chart notes were accidentally prefixed with pipe, force them out of the table block.
    out = out.replace(/\n\|\s*(#{1,6}\s*可选图表建议[^\n]*)/g, '\n\n$1')
    out = out.replace(/\n\|\s*(图\s*[1-9]\s*[:：][^\n]*)/g, '\n$1')
    return out
  }
  s = normalizeRecommendSectionTable(s)
  const normalizeNumberedSectionAsTable = (input, sectionTitle, headers = []) => {
    const lines = String(input || '').split('\n')
    const idx = lines.findIndex((x) => String(x || '').trim().replace(/^#{1,6}\s*/, '').startsWith(sectionTitle))
    if (idx < 0) return input
    let end = lines.length
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (/^#{1,6}\s*/.test(String(lines[i] || '').trim())) { end = i; break }
    }
    const body = lines.slice(idx + 1, end).join('\n')
      .replace(/([^\n])(\d+\.)/g, '$1\n$2')
    const rows = []
    const re = /(?:^|\n)\s*(\d+)\.\s*([^\n]+?)(?=(?:\n\s*\d+\.\s*)|\n?$)/g
    let m = null
    while ((m = re.exec(body)) !== null) rows.push([m[1], String(m[2] || '').trim()])
    if (rows.length === 0) return input
    const table = [
      `## ${sectionTitle}`,
      `| ${headers[0] || '序号'} | ${headers[1] || '内容'} |`,
      '| --- | --- |',
      ...rows.map((r) => `| ${r[0]} | ${r[1]} |`),
    ]
    return [...lines.slice(0, idx), ...table, ...lines.slice(end)].join('\n')
  }
  const normalizeRagRefAsTable = (input) => {
    const lines = String(input || '').split('\n')
    const idx = lines.findIndex((x) => String(x || '').trim().replace(/^#{1,6}\s*/, '').startsWith('RAG参考'))
    if (idx < 0) return input
    let end = lines.length
    for (let i = idx + 1; i < lines.length; i += 1) {
      if (/^#{1,6}\s*/.test(String(lines[i] || '').trim())) { end = i; break }
    }
    const rows = []
    for (const ln of lines.slice(idx + 1, end)) {
      const t = String(ln || '').trim()
      const m = t.match(/^(\d+)\.\s*(.+?)\s*\|\s*相似度\s*=\s*([\d.]+)/i)
      if (m) rows.push([m[1], m[2], m[3]])
    }
    if (rows.length === 0) return input
    const table = [
      '## RAG参考',
      '| 序号 | 来源 | 相似度 |',
      '| --- | --- | --- |',
      ...rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`),
    ]
    return [...lines.slice(0, idx), ...table, ...lines.slice(end)].join('\n')
  }
  s = normalizeRagRefAsTable(s)
  s = s.replace(/(##\s*明确不足\/待核验)\s*(\d+\.)/g, '$1\n$2')
  s = s.replace(/(##\s*下一步检索建议)\s*(\d+\.)/g, '$1\n$2')
  s = normalizeNumberedSectionAsTable(s, '明确不足/待核验', ['序号', '问题说明'])
  s = normalizeNumberedSectionAsTable(s, '下一步检索建议', ['序号', '建议'])
  // Convert dense "URL | 相似度=0.xxx" blocks into markdown table for readability.
  const normalizeSimilarityBlocks = (input) => {
    const lines = String(input || '').split('\n')
    const out = []
    let i = 0
    while (i < lines.length) {
      const line = String(lines[i] || '').trim()
      const isRow = /^\d+\.\s*https?:\/\/\S+\s*\|\s*相似度\s*=\s*[\d.]+/i.test(line)
      if (!isRow) {
        out.push(lines[i])
        i += 1
        continue
      }
      const rows = []
      while (i < lines.length) {
        const cur = String(lines[i] || '').trim()
        if (!/^\d+\.\s*https?:\/\/\S+\s*\|\s*相似度\s*=\s*[\d.]+/i.test(cur)) break
        const m = cur.match(/^\d+\.\s*(https?:\/\/\S+)\s*\|\s*相似度\s*=\s*([\d.]+)/i)
        if (m) rows.push([m[1], m[2]])
        i += 1
      }
      if (rows.length > 0) {
        out.push('| 来源链接 | 相似度 |')
        out.push('| --- | --- |')
        rows.forEach((r) => out.push(`| ${r[0]} | ${r[1]} |`))
      }
    }
    return out.join('\n')
  }
  s = normalizeSimilarityBlocks(s)
  // Pull "图1/图2/图3" into a dedicated readable block.
  s = s.replace(/(#{2,}\s*可选图表建议)\s*[-—–]?\s*(图\s*1\s*[:：])/g, '$1\n$2')
  s = s.replace(/(图\s*[1-9]\s*[:：][^#\n]{0,200})\s+(图\s*[1-9]\s*[:：])/g, '$1\n$2')
  const figMatches = [...s.matchAll(/图\s*([1-9])\s*[:：]\s*([^\n]+)/g)]
  if (figMatches.length > 0 && !/##\s*图表建议/.test(s) && !/##\s*可选图表建议/.test(s)) {
    const figLines = figMatches.map((m) => `- 图${m[1]}：${m[2]}`)
    s += `\n\n## 图表建议\n${figLines.join('\n')}`
  }
  // Keep blank lines tidy.
  s = s.replace(/\n{3,}/g, '\n\n')
  s = s.replace(/^\s*#\s*$/m, '')
  return s
}

function markdownChildrenToText(children) {
  if (children == null) return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map((x) => markdownChildrenToText(x)).join('')
  if (typeof children === 'object') return markdownChildrenToText(children?.props?.children)
  return ''
}

export default function PreciseSourcingAgentPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSidebar, setShowSidebar] = useState(true)
  const [sessionStateHydrated, setSessionStateHydrated] = useState(false)
  const [sessionStateLoadFailed, setSessionStateLoadFailed] = useState(false)

  const [tools, setTools] = useState([])
  const [selectedTools, setSelectedTools] = useState([])
  const [kbList, setKbList] = useState([])
  const [selectedKbIds, setSelectedKbIds] = useState([])
  const [selectedDbTables, setSelectedDbTables] = useState([])
  const [strictMode, setStrictMode] = useState(false)
  const [templateType, setTemplateType] = useState('none')
  const [templateFile, setTemplateFile] = useState(null)
  const [kbTopK, setKbTopK] = useState(3)
  const [dbTopK, setDbTopK] = useState(30)
  const [temperature, setTemperature] = useState(0.7)
  const [sourceQuotaDb, setSourceQuotaDb] = useState(3)
  const [sourceQuotaRag, setSourceQuotaRag] = useState(2)
  const [sourceQuotaWeb, setSourceQuotaWeb] = useState(2)
  const [selectedModelName, setSelectedModelName] = useState('gpt-5.4')
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT)
  const [systemPromptEnabled, setSystemPromptEnabled] = useState(true)
  const [systemPromptPresetKey, setSystemPromptPresetKey] = useState('default')
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [promptDialogOpen, setPromptDialogOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState('gpt-5.4')
  const [modelProviderDraft, setModelProviderDraft] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [promptEnabledDraft, setPromptEnabledDraft] = useState(true)
  const [promptPresetKeyDraft, setPromptPresetKeyDraft] = useState('default')
  const [modelProviders, setModelProviders] = useState([])
  const [modelTestLoading, setModelTestLoading] = useState(false)
  const [modelTestResult, setModelTestResult] = useState(null)
  const [flowDialogOpen, setFlowDialogOpen] = useState(false)
  const [flowTabKey, setFlowTabKey] = useState('logic')
  const [sequenceFullscreen, setSequenceFullscreen] = useState(false)
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false)
  const [artifactPreviewTitle, setArtifactPreviewTitle] = useState('')
  const [artifactPreviewUrl, setArtifactPreviewUrl] = useState('')
  const [rerankDetailOpen, setRerankDetailOpen] = useState(false)
  const [rerankDetailRecord, setRerankDetailRecord] = useState(null)

  const [sessions, setSessions] = useState([{ name: 'default', messages: [] }])
  const [currentSession, setCurrentSession] = useState('default')
  const viewportRef = useRef(null)
  const sequenceDiagramWrapRef = useRef(null)

  useEffect(() => {
    try {
      const savedModelRaw = String(window.localStorage.getItem(MODEL_STORAGE_KEY) || '').trim()
      const savedModel = savedModelRaw
      if (savedModel) {
        setSelectedModelName(savedModel)
        setModelDraft(savedModel)
      }
    } catch (error) {
      void error
    }

    fetchLangchainTools()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setTools(list)
      })
      .catch(() => setTools([]))

    fetchModelProviders()
      .then((rows) => setModelProviders(Array.isArray(rows) ? rows : []))
      .catch(() => setModelProviders([]))

    fetchKnowledgeBases()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : []
        setKbList(list)
      })
      .catch((error) => {
        message.error(error?.message || '读取知识库失败，请稍后重试')
      })

    fetchLangchainSessionState('precise_sourcing')
      .then((state) => {
        const rows = Array.isArray(state?.sessions) ? state.sessions : []
        if (rows.length > 0) {
          setSessions(rows)
          const current = String(state?.currentSession || rows[0].name)
          const exists = rows.some((item) => item.name === current)
          setCurrentSession(exists ? current : rows[0].name)
        }
        setSessionStateLoadFailed(false)
        setSessionStateHydrated(true)
      })
      .catch((error) => {
        setSessionStateLoadFailed(true)
        message.error(error.message || '加载历史会话失败')
      })
  }, [])

  useEffect(() => {
    try {
      if (selectedModelName) window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModelName)
    } catch (error) {
      void error
    }
  }, [selectedModelName])

  useEffect(() => {
    if (!sessionStateHydrated || sessionStateLoadFailed) return
    const timer = window.setTimeout(() => {
      void saveLangchainSessionState({ chatType: 'precise_sourcing', sessions, currentSession }).catch((error) => {
        message.error(error.message || '保存会话失败')
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [sessions, currentSession, sessionStateHydrated])

  const toolOptions = useMemo(
    () => {
      const base = (Array.isArray(tools)
        ? tools
          .filter((item) => item
            && item.available !== false
            && (
              (Array.isArray(item.scopes) && item.scopes.includes('precise_sourcing'))
              || PRECISE_SOURCING_TOOL_KEYS.has(String(item.key || ''))
            ))
          .map((item) => ({ label: item.label || item.key, value: item.key }))
        : [])
      const merged = new Map(base.map((item) => [item.value, item]))
      for (const req of REQUIRED_PRECISE_TOOL_OPTIONS) {
        if (!merged.has(req.key)) merged.set(req.key, { label: req.label, value: req.key })
      }
      return Array.from(merged.values())
    },
    [tools],
  )
  const kbOptions = useMemo(
    () => (Array.isArray(kbList) ? kbList.map((item) => ({ label: item.name, value: String(item.id) })) : []),
    [kbList],
  )
  const activeSession = useMemo(
    () => sessions.find((item) => item.name === currentSession) || sessions[0],
    [sessions, currentSession],
  )
  const activeMessages = activeSession?.messages || []
  const latestAssistantMessage = useMemo(
    () => [...activeMessages].reverse().find((item) => item?.role === 'assistant') || null,
    [activeMessages],
  )
  const promptPreviewText = systemPromptEnabled ? systemPrompt : ''
  const providerOptions = useMemo(
    () => (Array.isArray(modelProviders)
      ? modelProviders.map((item) => ({ label: item.providerName, value: item.providerName }))
      : []),
    [modelProviders],
  )
  const modelNameOptions = useMemo(() => {
    const provider = (Array.isArray(modelProviders) ? modelProviders : []).find((item) => item.providerName === modelProviderDraft)
    const rows = Array.isArray(provider?.fetchedModels) && provider.fetchedModels.length > 0
      ? provider.fetchedModels
      : (Array.isArray(provider?.models) ? provider.models : [])
    const names = rows.map((item) => String(item?.id || '').trim()).filter(Boolean)
    return [...new Set(names)].map((name) => ({ label: name, value: name }))
  }, [modelProviders, modelProviderDraft])
  const activeFlowBranches = useMemo(() => {
    const toolsSet = new Set(Array.isArray(selectedTools) ? selectedTools : [])
    const evidence = latestAssistantMessage?.evidence || {}
    const rounds = Array.isArray(latestAssistantMessage?.react?.rounds) ? latestAssistantMessage.react.rounds : []
    const qs = latestAssistantMessage?.queryStatements && typeof latestAssistantMessage.queryStatements === 'object'
      ? latestAssistantMessage.queryStatements
      : {}
    const usedWebByTrace = rounds.some((r) => {
      const actionText = `${String(r?.action?.title || '')} ${String(r?.action?.detail || '')}`.toLowerCase()
      return actionText.includes('web') || actionText.includes('互联网')
    })
    const usedWebByQuery = Boolean(String(qs?.web?.keyword || '').trim())
    return {
      db: (Array.isArray(evidence?.suppliers) && evidence.suppliers.length > 0) || (toolsSet.has('db_chat') && selectedDbTables.length > 0),
      kb: (Array.isArray(evidence?.kbHits) && evidence.kbHits.length > 0) || (toolsSet.has('local_kb') && selectedKbIds.length > 0),
      web: usedWebByTrace || usedWebByQuery || toolsSet.has('web_search'),
      image: toolsSet.has('image_gen'),
      chart: toolsSet.has('python_chart_generator'),
      export: toolsSet.has('file_exporter') || templateType !== 'none',
    }
  }, [selectedTools, selectedDbTables, selectedKbIds, templateType, latestAssistantMessage])
  const selectedToolLabels = useMemo(
    () => (Array.isArray(selectedTools) ? selectedTools.map((key) => TOOL_LABEL_MAP[key] || key).filter(Boolean) : []),
    [selectedTools],
  )
  const activeFusionTools = useMemo(() => {
    const set = new Set(Array.isArray(selectedTools) ? selectedTools : [])
    return [
      { key: 'db', label: 'DB', enabled: set.has('db_chat') },
      { key: 'kb', label: '知识库', enabled: set.has('local_kb') },
      { key: 'web', label: 'Web', enabled: set.has('web_search') },
    ].filter((x) => x.enabled)
  }, [selectedTools])
  const effectiveSourceQuota = useMemo(() => ({
    db: activeFusionTools.some((x) => x.key === 'db') ? Number(sourceQuotaDb) : 0,
    rag: activeFusionTools.some((x) => x.key === 'kb') ? Number(sourceQuotaRag) : 0,
    web: activeFusionTools.some((x) => x.key === 'web') ? Number(sourceQuotaWeb) : 0,
  }), [activeFusionTools, sourceQuotaDb, sourceQuotaRag, sourceQuotaWeb])
  const flowConfigSummary = useMemo(() => ({
    tools: selectedToolLabels.length > 0 ? selectedToolLabels.join('、') : '未选择',
    kb: selectedKbIds.length > 0 ? `${selectedKbIds.length} 个` : '未选择',
    db: selectedDbTables.length > 0 ? `${selectedDbTables.length} 张表` : '未选择',
    model: selectedModelName || '未设置',
    prompt: systemPromptEnabled ? '启用' : '未启用',
    template: templateType === 'none' ? '无' : templateType,
  }), [selectedToolLabels, selectedKbIds, selectedDbTables, selectedModelName, systemPromptEnabled, templateType])
  const flowLogicText = useMemo(() => [
    `1. 用户输入：接收查询内容与当前配置（工具=${flowConfigSummary.tools}；知识库=${flowConfigSummary.kb}；数据库=${flowConfigSummary.db}；模型=${flowConfigSummary.model}；提示词=${flowConfigSummary.prompt}）`,
    `2. LLM语义理解与任务规划：识别意图、主机厂/品类关键词、是否需要DB/RAG/WEB分支`,
    `3. 检索子任务分解：将请求拆成 DB任务 / RAG任务 / WEB任务（仅启用已选分支）`,
    `4. 发起标准化工具请求：构造统一请求体（query/template/provider/topK/sourceQuota）`,
    `5. 工具执行(DB/RAG/WEB)：并行执行检索并持续回传执行日志`,
    `6. 返回标准化结果：统一为 dbHits / ragHits / webHits（含候选与证据片段）`,
    `7. 证据整合与去重：构建全量候选池，做名称归一、同名去重、证据归因`,
    `8. 候选重排(Rerank)：按 query-candidate-evidence 打分，分源保底 + 总分竞争，得到 TopN + 边界样本`,
    `9. 系统提示词 + 召回上下文交给LLM生成：将 prompt + DB/RAG/WEB + rerank 一并送入模型 ${flowConfigSummary.model}`,
    `10. 返回最终结果：输出结构化候选、证据摘要与LLM原文（流式更新后定稿）`,
  ].join('\n'), [flowConfigSummary, activeFlowBranches])
  const flowSequenceText = useMemo(() => [
    `1) 用户 -> 前端：输入问题与配置`,
    `2) 前端 -> 后端：/api/agents/precise-sourcing/chat（message + tools + kb + db + model + prompt）`,
    `3) 后端 -> LangGraph：语义理解与任务规划（step2/3）`,
    `4) LangGraph -> 工具层：发起标准化请求（step4）`,
    `5) 工具层 -> 数据源(DB/RAG/WEB)：执行检索并返回命中（step5/6）`,
    `6) LangGraph：证据整合与去重（step7）`,
    `7) LangGraph -> Reranker：候选重排，返回TopN+边界（step8）`,
    `8) LangGraph -> LLM(${flowConfigSummary.model})：prompt + 召回上下文 + rerank（step9）`,
    `9) LLM -> LangGraph：返回最终文本与结构化片段`,
    `10) 后端 -> 前端：流式更新并最终展示（step10）`,
  ].join('\n'), [flowConfigSummary.model])
  const sequenceDiagramEngine = useMemo(() => {
    const engine = new DiagramEngine()
    engine.getLayerFactories().registerFactory(new NodeLayerFactory())
    engine.getLayerFactories().registerFactory(new LinkLayerFactory())
    engine.getLayerFactories().registerFactory(new SelectionBoxLayerFactory())
    engine.getNodeFactories().registerFactory(new DefaultNodeFactory())
    engine.getLinkFactories().registerFactory(new DefaultLinkFactory())
    engine.getPortFactories().registerFactory(new DefaultPortFactory())
    engine.getStateMachine().pushState(new DefaultDiagramState())
    const model = new DiagramModel()
    const mkNode = (name, color, x, y) => {
      const node = new DefaultNodeModel({ name, color })
      node.setPosition(x, y)
      return node
    }
    const mkLink = (source, target, color = '#111827') => {
      const link = new DefaultLinkModel({ color, width: 2 })
      link.setSourcePort(source)
      link.setTargetPort(target)
      return link
    }

    const readConfigNode = mkNode('1 用户输入', 'rgb(14, 165, 233)', 20, 160)
    const parseNode = mkNode('2 语义理解与规划', 'rgb(59, 130, 246)', 130, 160)
    const orchestrateNode = mkNode('3/4 子任务分解+标准化请求', 'rgb(37, 99, 235)', 260, 160)
    const retrievalResultNode = mkNode('5/6 工具执行与标准化结果', 'rgb(30, 64, 175)', 470, 160)
    const fusionNode = mkNode('7 证据整合与去重', 'rgb(126, 34, 206)', 660, 160)
    const rerankNode = mkNode('8 候选重排(Rerank)', 'rgb(168, 85, 247)', 820, 160)
    const llmNode = mkNode(`9 LLM生成 (${flowConfigSummary.model})`, 'rgb(101, 163, 13)', 980, 160)
    const returnNode = mkNode('10 返回最终结果', 'rgb(2, 132, 199)', 1120, 160)

    const readOut = readConfigNode.addOutPort('输出')
    const parseIn = parseNode.addInPort('输入')
    const parseOut = parseNode.addOutPort('输出')
    const orchIn = orchestrateNode.addInPort('输入')
    const orchOut = orchestrateNode.addOutPort('输出')
    const retrievalIn = retrievalResultNode.addInPort('输入')
    const retrievalOut = retrievalResultNode.addOutPort('输出')
    const fusionIn = fusionNode.addInPort('输入')
    const fusionOut = fusionNode.addOutPort('输出')
    const rerankIn = rerankNode.addInPort('输入')
    const rerankOut = rerankNode.addOutPort('输出')
    const llmIn = llmNode.addInPort('输入')
    const llmOut = llmNode.addOutPort('输出')
    const retIn = returnNode.addInPort('输入')

    const graphNodes = [readConfigNode, parseNode, orchestrateNode, retrievalResultNode, fusionNode, rerankNode, llmNode, returnNode]
    const graphLinks = [
      mkLink(readOut, parseIn),
      mkLink(parseOut, orchIn),
      mkLink(orchOut, retrievalIn),
      mkLink(retrievalOut, fusionIn),
      mkLink(fusionOut, rerankIn),
      mkLink(rerankOut, llmIn),
    ]

    const retrievalDefs = [
      { enabled: activeFlowBranches.db, name: '数据库检索', color: 'rgb(180, 83, 9)' },
      { enabled: activeFlowBranches.kb, name: '知识库检索', color: 'rgb(15, 118, 110)' },
      { enabled: activeFlowBranches.web, name: '互联网搜索', color: 'rgb(14, 165, 164)' },
    ].filter((item) => item.enabled)
    const retrievalStartY = 35
    retrievalDefs.forEach((item, idx) => {
      const node = mkNode(item.name, item.color, 390, retrievalStartY + idx * 120)
      const inPort = node.addInPort('输入')
      const outPort = node.addOutPort('输出')
      graphNodes.push(node)
      graphLinks.push(mkLink(orchOut, inPort))
      graphLinks.push(mkLink(outPort, retrievalIn))
    })

    const outputDefs = [
      { enabled: activeFlowBranches.image, name: '图片生成', color: 'rgb(217, 70, 239)' },
      { enabled: activeFlowBranches.chart, name: '图表生成', color: 'rgb(245, 158, 11)' },
      { enabled: activeFlowBranches.export, name: '文件导出', color: 'rgb(8, 145, 178)' },
    ].filter((item) => item.enabled)
    const outputStartY = 40
    if (outputDefs.length === 0) {
      graphLinks.push(mkLink(llmOut, retIn))
    } else {
      outputDefs.forEach((item, idx) => {
        const node = mkNode(item.name, item.color, 900, outputStartY + idx * 80)
        const inPort = node.addInPort('输入')
        const outPort = node.addOutPort('输出')
        graphNodes.push(node)
        graphLinks.push(mkLink(llmOut, inPort))
        graphLinks.push(mkLink(outPort, retIn))
      })
    }

    graphNodes.forEach((n) => n.setLocked(true))
    graphLinks.forEach((l) => l.setLocked(true))
    model.addAll(...graphNodes, ...graphLinks)
    // Keep nodes/links read-only, but allow canvas panning.
    model.setLocked(false)

    engine.setModel(model)
    return engine
  }, [activeFlowBranches, flowConfigSummary.model])
  const fitSequenceDiagramViewport = (fullscreen = false) => {
    try {
      const model = sequenceDiagramEngine.getModel()
      const nodes = Array.isArray(model?.getNodes?.()) ? model.getNodes() : []
      if (!nodes || nodes.length === 0) return
      const host = sequenceDiagramWrapRef.current
      const vw = Number(host?.clientWidth || 0)
      const vh = Number(host?.clientHeight || 0)
      if (vw <= 0 || vh <= 0) return
      const minX = Math.min(...nodes.map((n) => Number(n.getX?.() || 0)))
      const minY = Math.min(...nodes.map((n) => Number(n.getY?.() || 0)))
      const maxX = Math.max(...nodes.map((n) => Number(n.getX?.() || 0) + 220))
      const maxY = Math.max(...nodes.map((n) => Number(n.getY?.() || 0) + 90))
      const contentW = Math.max(1, maxX - minX)
      const contentH = Math.max(1, maxY - minY)
      const pad = fullscreen ? 120 : 60
      const zx = (vw - pad) / contentW
      const zy = (vh - pad) / contentH
      const zoomRaw = Math.min(zx, zy) * 100
      const zoom = fullscreen
        ? Math.max(90, Math.min(210, zoomRaw))
        : Math.max(70, Math.min(130, zoomRaw))
      model.setZoomLevel(zoom)
      const scaledW = contentW * (zoom / 100)
      const scaledH = contentH * (zoom / 100)
      const offsetX = Math.round((vw - scaledW) / 2 - minX * (zoom / 100))
      const offsetY = Math.round((vh - scaledH) / 2 - minY * (zoom / 100))
      model.setOffset(offsetX, offsetY)
      sequenceDiagramEngine.repaintCanvas()
    } catch (error) {
      void error
    }
  }
  useEffect(() => {
    if (!flowDialogOpen || flowTabKey !== 'sequence') return
    const timer = window.setTimeout(() => {
      try {
        sequenceDiagramEngine.repaintCanvas()
        fitSequenceDiagramViewport(false)
      } catch (error) {
        void error
      }
    }, 80)
    return () => window.clearTimeout(timer)
  }, [flowDialogOpen, flowTabKey, sequenceDiagramEngine])
  useEffect(() => {
    const onFsChange = () => {
      const current = document.fullscreenElement
      const inSequenceFs = Boolean(current && sequenceDiagramWrapRef.current && current === sequenceDiagramWrapRef.current)
      setSequenceFullscreen(inSequenceFs)
      try {
        const model = sequenceDiagramEngine.getModel()
        const nodes = Array.isArray(model?.getNodes?.()) ? model.getNodes() : []
        const links = Array.isArray(model?.getLinks?.()) ? Object.values(model.getLinks()) : []
        nodes.forEach((n) => n.setLocked(!inSequenceFs))
        links.forEach((l) => l.setLocked(true))
      } catch (error) {
        void error
      }
      if (inSequenceFs) {
        window.setTimeout(() => {
          try {
            sequenceDiagramEngine.repaintCanvas()
            fitSequenceDiagramViewport(true)
          } catch (error) {
            void error
          }
        }, 40)
      } else {
        window.setTimeout(() => fitSequenceDiagramViewport(false), 40)
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [sequenceDiagramEngine])

  useEffect(() => {
    if (!Array.isArray(modelProviders) || modelProviders.length === 0) return
    if (modelProviderDraft) return
    const firstProvider = modelProviders[0]
    const rows = Array.isArray(firstProvider?.fetchedModels) && firstProvider.fetchedModels.length > 0
      ? firstProvider.fetchedModels
      : (Array.isArray(firstProvider?.models) ? firstProvider.models : [])
    const firstModel = rows.map((item) => String(item?.id || '').trim()).filter(Boolean)[0] || selectedModelName
    setModelProviderDraft(firstProvider.providerName || '')
    if (!selectedModelName && firstModel) setSelectedModelName(firstModel)
    if (!modelDraft && firstModel) setModelDraft(firstModel)
  }, [modelProviders, modelProviderDraft, selectedModelName, modelDraft])

  useEffect(() => {
    if (!viewportRef.current) return
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight
  }, [activeMessages])
  useEffect(() => {
    const validValues = new Set(toolOptions.map((item) => String(item.value)))
    setSelectedTools((prev) => {
      const next = (Array.isArray(prev) ? prev : []).filter((item) => validValues.has(String(item)))
      return next.length === prev.length ? prev : next
    })
  }, [toolOptions])

  function patchActiveMessages(nextMessages) {
    setSessions((current) => current.map((item) => (item.name === currentSession ? { ...item, messages: nextMessages } : item)))
  }

  function patchLastAssistantMessage(mutator) {
    setSessions((current) => current.map((item) => {
      if (item.name !== currentSession) return item
      const messages = Array.isArray(item.messages) ? [...item.messages] : []
      const idx = messages.length - 1
      if (idx < 0 || messages[idx]?.role !== 'assistant') return item
      messages[idx] = mutator(messages[idx]) || messages[idx]
      return { ...item, messages }
    }))
  }

  function onCreateSession() {
    const base = '会话'
    let idx = sessions.length + 1
    let nextName = `${base}${idx}`
    while (sessions.some((s) => s.name === nextName)) {
      idx += 1
      nextName = `${base}${idx}`
    }
    setSessions((current) => [...current, { name: nextName, messages: [] }])
    setCurrentSession(nextName)
  }

  function onRenameSession() {
    Modal.confirm({
      title: '重命名会话',
      content: (
        <Input
          defaultValue={currentSession}
          id="rename-precise-session-input"
          onPressEnter={() => {
            const inputEl = document.getElementById('rename-precise-session-input')
            if (inputEl) inputEl.blur()
          }}
        />
      ),
      onOk: () => {
        const inputEl = document.getElementById('rename-precise-session-input')
        const nextName = String(inputEl?.value || '').trim()
        if (!nextName) return
        if (sessions.some((s) => s.name === nextName && s.name !== currentSession)) {
          message.error('会话名称已存在')
          return
        }
        setSessions((current) => current.map((s) => (s.name === currentSession ? { ...s, name: nextName } : s)))
        setCurrentSession(nextName)
      },
    })
  }

  function onDeleteSession() {
    if (sessions.length <= 1) {
      message.warning('这是最后一个会话，无法删除')
      return
    }
    const next = sessions.filter((s) => s.name !== currentSession)
    setSessions(next)
    setCurrentSession(next[0].name)
  }

  function onExportSession() {
    const payload = {
      session: currentSession,
      exportedAt: new Date().toISOString(),
      messages: activeMessages,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${currentSession}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function stepNumber(current, delta, min, max, setter) {
    const next = Math.min(max, Math.max(min, Number(current || 0) + delta))
    setter(next)
  }

  function onSelectAllDbTables() {
    setSelectedDbTables(DB_OPTIONS.map((item) => item.value))
  }

  function onClearDbTables() {
    setSelectedDbTables([])
  }

  function onTemplateUpload(info) {
    const rawFile = info?.file?.originFileObj || info?.file
    if (!rawFile) return
    setTemplateFile(rawFile)
  }

  async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('模板读取失败'))
      reader.readAsDataURL(file)
    })
  }

  function renderMessageContent(text = '') {
    const pretty = String(text || '')
      .replace(/(【[^】]+】)/g, '\n$1')
      .replace(/\s*-\s*/g, '\n- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0, maxWidth: '100%' }}>{pretty}</div>
  }

  function parseAnswerSections(text = '') {
    const raw = String(text || '')
    const normalized = raw.replace(/【候选供应商Top\d+】/g, '【候选供应商TopN】')
    const keys = ['【直接回答】', '【结论】', '【意图】', '【命中统计】', '【候选供应商TopN】']
    const result = {}
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      const start = normalized.indexOf(key)
      if (start < 0) continue
      const nextStarts = keys
        .filter((k) => k !== key)
        .map((k) => normalized.indexOf(k, start + key.length))
        .filter((idx) => idx > start)
      const end = nextStarts.length > 0 ? Math.min(...nextStarts) : normalized.length
      result[key] = normalized.slice(start + key.length, end).trim()
    }
    return result
  }

  function extractArtifactEntries(item) {
    const selected = Array.isArray(item?.selectedTools) ? item.selectedTools.map((x) => String(x || '')) : []
    const allowArtifactFallback = selected.includes('python_chart_generator') || selected.includes('file_exporter')
    const fromArtifacts = Array.isArray(item?.artifacts)
      ? item.artifacts
        .map((artifact, idx) => ({
          title: String(artifact?.title || artifact?.fileName || `文件${idx + 1}`),
          url: String(artifact?.downloadUrl || ''),
        }))
        .filter((row) => row.url)
      : []
    if (fromArtifacts.length > 0) return fromArtifacts
    if (!allowArtifactFallback) return []

    const raw = String(item?.rawAnswer || item?.content || '')
    const lines = raw.split(/\r?\n/)
    const rows = []
    let inBlock = false
    for (const line of lines) {
      const txt = String(line || '').trim()
      if (!txt) continue
      if (txt.includes('【产出文件】')) {
        inBlock = true
        continue
      }
      if (!inBlock) continue
      if (/^【.+】/.test(txt)) break
      const match = txt.match(/^\d+\.\s*(.+?)[:：]\s*(\/api\/\S+)$/)
      if (match) rows.push({ title: match[1].trim(), url: match[2].trim() })
    }
    return rows
  }

  function renderAssistantExtraText(item) {
    const runLogs = Array.isArray(item?.meta?.runLogs) ? item.meta.runLogs.map((x) => String(x || '').trim()).filter(Boolean) : []
    if (runLogs.length === 0) return null
    return (
      <div style={{ marginTop: 10, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 10 }}>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>过程数据</div>
        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {runLogs.join('\n')}
        </div>
      </div>
    )
  }

  function openArtifactPreview(title, url) {
    setArtifactPreviewTitle(String(title || '产出文件'))
    setArtifactPreviewUrl(String(url || ''))
    setArtifactPreviewOpen(true)
  }

  function renderAssistantResultCard(item) {
    return null
  }

  function renderArtifactCard(item) {
    const artifacts = extractArtifactEntries(item)
    if (artifacts.length === 0) return null
    return (
      <div style={{ marginTop: 10, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: 10 }}>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>产出文件</div>
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {artifacts.map((artifact, idx) => {
            const title = String(artifact?.title || `文件${idx + 1}`)
            const url = String(artifact?.url || '')
            return (
              <div key={`artifact-${idx}`} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', border: '1px solid #f1f5f9', borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{idx + 1}. {title}</div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#2563eb', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                    title={url}
                  >
                    {url}
                  </a>
                </div>
                <Space size={6}>
                  <Button size="small" onClick={() => openArtifactPreview(title, url)}>预览</Button>
                  <a href={url} target="_blank" rel="noreferrer">下载/打开</a>
                </Space>
              </div>
            )
          })}
        </Space>
      </div>
    )
  }

  function formatTime(value) {
    const ts = Number(value || 0)
    if (!ts) return ''
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }

  function renderExecutionProcess(item) {
    const hasFinalPayload = !!String(item?.rawAnswer || '').trim()
      || !!(item?.intentDecision && typeof item.intentDecision === 'object')
      || (Array.isArray(item?.planSteps) && item.planSteps.length > 0)
      || (Array.isArray(item?.traces) && item.traces.length > 0)
    if (!hasFinalPayload) return null
    const isDirectAnswer = String(item?.intent || '') === 'direct_answer'
      || item?.queryStatements?.route?.mode === 'direct_answer'
    if (isDirectAnswer) return null

    const traces = Array.isArray(item?.traces) ? item.traces : []
    const intentDecision = item?.intentDecision && typeof item.intentDecision === 'object' ? item.intentDecision : null
    const planStepsRaw = Array.isArray(item?.planSteps) ? item.planSteps : []
    const planTrace = traces.find((t) => String(t?.step || '').toLowerCase() === 'plan')
    const actPlanTrace = traces.find((t) => String(t?.step || '').toLowerCase() === 'act_plan')
    const planDetailText = String(planTrace?.detail || '')
    const intentFromTrace = (() => {
      const m = planDetailText.match(/意图[=：]([a-z_]+)/i)
      return m?.[1] ? String(m[1]).trim() : ''
    })()
    const planStepsFromTrace = (() => {
      const m = planDetailText.match(/计划分解=([^\n\r]+)/)
      if (!m?.[1]) return []
      return String(m[1])
        .split(/[；/]/)
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .map((x, idx) => ({ id: `trace-plan-${idx + 1}`, title: x }))
    })()
    const planSteps = planStepsRaw.length > 0 ? planStepsRaw : planStepsFromTrace
    const executionStages = Array.isArray(item?.executionProtocol?.stages) ? item.executionProtocol.stages : []
    const executionPlanFromTrace = actPlanTrace?.input?.executionPlan && typeof actPlanTrace.input.executionPlan === 'object'
      ? actPlanTrace.input.executionPlan
      : null
    const selectedToolsFromMessage = Array.isArray(item?.selectedTools) ? item.selectedTools : []
    const selectedToolsFromOrchestration = Array.isArray(item?.queryStatements?.orchestration?.selectedTools)
      ? item.queryStatements.orchestration.selectedTools
      : []
    const selectedToolSet = new Set([...selectedToolsFromMessage, ...selectedToolsFromOrchestration].map((x) => String(x || '')))

    const hasTraceStep = (prefix) => traces.some((t) => String(t?.step || '').toLowerCase().startsWith(String(prefix || '').toLowerCase()))
    const hasFastPlan = hasTraceStep('plan_fast')
    const doneOrSkipped = (done, skipped = false) => (done ? 'done' : (skipped ? 'skipped' : 'pending'))

    const activeToolTasks = [
      { key: 'db_chat', label: 'DB任务', enabled: selectedToolSet.has('db_chat') || intentDecision?.needDb === true, done: hasTraceStep('observe_db') || hasTraceStep('act_db') },
      { key: 'local_kb', label: 'RAG任务', enabled: selectedToolSet.has('local_kb') || intentDecision?.needRag === true, done: hasTraceStep('observe_rag') || hasTraceStep('act_rag') },
      { key: 'web_search', label: 'WEB任务', enabled: selectedToolSet.has('web_search') || intentDecision?.needWeb === true, done: hasTraceStep('observe_web') || hasTraceStep('act_web') },
      { key: 'python_chart_generator', label: '图表任务', enabled: selectedToolSet.has('python_chart_generator'), done: hasTraceStep('observe_tools') },
      { key: 'file_exporter', label: '导出任务', enabled: selectedToolSet.has('file_exporter'), done: hasTraceStep('observe_tools') },
      { key: 'image_gen', label: '图片任务', enabled: selectedToolSet.has('image_gen'), done: hasTraceStep('observe_tools') },
    ].filter((x) => x.enabled)
    if (activeToolTasks.length === 0) {
      if (Array.isArray(item?.evidence?.suppliers) && item.evidence.suppliers.length > 0) activeToolTasks.push({ key: 'db_chat', label: 'DB任务', enabled: true, done: true })
      if (Array.isArray(item?.evidence?.kbHits) && item.evidence.kbHits.length > 0) activeToolTasks.push({ key: 'local_kb', label: 'RAG任务', enabled: true, done: true })
      if (Array.isArray(item?.evidence?.webHits) && item.evidence.webHits.length > 0) activeToolTasks.push({ key: 'web_search', label: 'WEB任务', enabled: true, done: true })
    }
    const allActiveToolTasksDone = activeToolTasks.length > 0 && activeToolTasks.every((x) => x.done === true)

    const metricDbHits = Array.isArray(item?.evidence?.suppliers) ? item.evidence.suppliers.length : 0
    const metricRagHits = Array.isArray(item?.evidence?.kbHits) ? item.evidence.kbHits.length : 0
    const metricWebHits = Array.isArray(item?.evidence?.webHits) ? item.evidence.webHits.length : 0
    const dbCompanies = (Array.isArray(item?.evidence?.suppliers) ? item.evidence.suppliers : [])
      .map((x) => String(x?.companyName || x?.company_name || x?.name || '').trim())
      .filter(Boolean)
    const isLikelyCompanyName = (name = '') => {
      const n = String(name || '').trim()
      if (!n) return false
      if (n.length < 4 || n.length > 64) return false
      if (/[：:；;，,。.!！?？]/.test(n)) return false
      if (/\b(docx|pdf|pptx?|xlsx?|csv|md|txt)\b/i.test(n)) return false
      if (/^\d+\s*/.test(n) && /(家上市公司|家公司|家企业|个公司|个企业|一个公司|一个企业)/.test(n)) return false
      if (/(供应商是一个公司|一个公司|一个企业|这些公司|有这些公司|以下公司|上述公司)/.test(n)) return false
      if (/^(关于|有关|Rankings|ranking|排行|排名)/i.test(n)) return false
      if (/(我收藏的公司|收藏的公司|我的公司|示例公司|推荐公司|样例公司|这些公司|有这些公司|\d+家上市公司|等公司$|等企业$)/.test(n)) return false
      if (/(建议|用于|使用|基于|参考|例如|包含|包括|方面|相关|优先|自动|获取|样例|建筑材料)/.test(n)) return false
      if (/(完善公司|我的公司|上市公司|行业公司|企业名录|供应链企业|相关公司|头部公司|龙头公司|多家公司|若干公司|保证公司)/.test(n)) return false
      if (/(收藏|排名|榜单|图表|建议|示例|样例|模板|文档|报告|清单)$/.test(n)) return false
      const zhLegal = /(股份有限公司|有限责任公司|有限公司|集团有限公司|集团|公司)$/.test(n)
      const enLegal = /\b(inc|corp|corporation|co\.?,?\s*ltd|ltd\.?|limited|group|holdings?)\b/i.test(n)
      return zhLegal || enLegal
    }
    const extractLooseCompanies = (text = '') => {
      const src = String(text || '')
      const matches = src.match(/[\u4e00-\u9fa5A-Za-z0-9（）()·\s]{3,48}(?:股份有限公司|有限责任公司|有限公司|集团有限公司|集团|公司)/g) || []
      return matches.map((x) => String(x || '').trim()).filter((x) => isLikelyCompanyName(x))
    }
    const kbCompanies = Array.from(new Set((Array.isArray(item?.evidence?.kbHits) ? item.evidence.kbHits : [])
      .flatMap((x) => [
        ...(Array.isArray(x?.supplierCandidates) ? x.supplierCandidates : []),
        ...(Array.isArray(x?._supplierCandidates) ? x._supplierCandidates : []),
        ...extractLooseCompanies(`${String(x?.docName || '')} ${String(x?.snippetPreview || x?.chunkText || '')}`),
      ])
      .map((x) => String(x || '').trim())
      .filter((x) => x && isLikelyCompanyName(x))))
    const webCompaniesAll = Array.from(new Set((Array.isArray(item?.evidence?.webHits) ? item.evidence.webHits : [])
      .flatMap((x) => [
        ...(Array.isArray(x?.supplierCandidates) ? x.supplierCandidates : []),
        ...(Array.isArray(x?._supplierCandidates) ? x._supplierCandidates : []),
      ])
      .map((x) => String(x || '').trim())
      .filter(Boolean)))
    const webCompanies = webCompaniesAll.filter((x) => isLikelyCompanyName(x))
    const webDerivedCompanies = Array.from(new Set((Array.isArray(item?.evidence?.webDerivedSuppliers) ? item.evidence.webDerivedSuppliers : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .filter((x) => isLikelyCompanyName(x))))
    const mergedWebCompanies = Array.from(new Set([...webCompanies, ...webDerivedCompanies]))
    const kbSignals = (Array.isArray(item?.evidence?.kbHits) ? item.evidence.kbHits : [])
      .map((x) => ({
        docName: String(x?.docName || '').trim(),
        snippet: String(x?.snippetPreview || x?.chunkText || '').trim(),
      }))
      .filter((x) => x.docName || x.snippet)
    const kbSignalLines = kbSignals
      .slice(0, 8)
      .map((x) => x.docName ? `${x.docName}${x.snippet ? ` | ${x.snippet.slice(0, 80)}` : ''}` : x.snippet.slice(0, 120))
    const webSignals = (Array.isArray(item?.evidence?.webHits) ? item.evidence.webHits : [])
      .map((x) => ({
        title: String(x?.title || x?.name || '').trim(),
        url: String(x?.url || x?.href || x?.link || '').trim(),
      }))
      .filter((x) => x.title || x.url)
    const webSignalLines = webSignals
      .slice(0, 8)
      .map((x) => (x.url ? `${x.title || '(无标题)'} | ${x.url}` : (x.title || '(无标题)')))
    const webEnrichNote = String(item?.evidence?.webEnrichNote || '').trim()
    const fusedSuppliers = (Array.isArray(item?.evidence?.suppliers) ? item.evidence.suppliers : [])
      .map((row) => ({
        name: String(row?.companyName || row?.company_name || row?.name || '').trim(),
        dbScore: Number(row?._matchScore || 0),
        fusedScore: Number(row?._fusedScore || row?._matchScore || 0),
        kbSupport: Number(row?._kbSupportCount || 0),
        webSupport: Number(row?._webSupportCount || 0),
        rerankScore: Number(row?._rerankScore || 0),
        rerankReason: String(row?._rerankReason || '').trim(),
        rerankSource: String(row?._rerankSource || '').trim(),
        rerankIndex: Number(row?._rerankIndex || 0),
      }))
      .filter((x) => x.name)
      .sort((a, b) => b.fusedScore - a.fusedScore)
    const allSupplierPool = (() => {
      const map = new Map()
      const upsert = (name, patch = {}) => {
        const key = String(name || '').trim()
        if (!key) return
        const prev = map.get(key) || {
          name: key,
          dbScore: 0,
          fusedScore: 0,
          kbSupport: 0,
          webSupport: 0,
          rerankScore: 0,
        }
        map.set(key, {
          ...prev,
          ...patch,
          dbScore: Math.max(Number(prev.dbScore || 0), Number(patch.dbScore ?? prev.dbScore ?? 0)),
          fusedScore: Math.max(Number(prev.fusedScore || 0), Number(patch.fusedScore ?? prev.fusedScore ?? 0)),
          kbSupport: Math.max(Number(prev.kbSupport || 0), Number(patch.kbSupport ?? prev.kbSupport ?? 0)),
          webSupport: Math.max(Number(prev.webSupport || 0), Number(patch.webSupport ?? prev.webSupport ?? 0)),
          rerankScore: Math.max(Number(prev.rerankScore || 0), Number(patch.rerankScore ?? prev.rerankScore ?? 0)),
        })
      }
      fusedSuppliers.forEach((x) => upsert(x.name, x))
      dbCompanies.forEach((name) => upsert(name, { dbScore: 1, fusedScore: 1 }))
      kbCompanies.forEach((name) => upsert(name, { kbSupport: 1 }))
      mergedWebCompanies.forEach((name) => upsert(name, { webSupport: 1 }))
      return Array.from(map.values())
        .sort((a, b) => (Number(b.rerankScore || 0) - Number(a.rerankScore || 0))
          || (Number(b.fusedScore || 0) - Number(a.fusedScore || 0))
          || (Number(b.dbScore || 0) - Number(a.dbScore || 0))
          || String(a.name).localeCompare(String(b.name), 'zh-CN'))
    })()
    const rawPoolCount = dbCompanies.length + kbCompanies.length + mergedWebCompanies.length + fusedSuppliers.length
    const dedupPoolCount = allSupplierPool.length
    const reducedCount = Math.max(0, rawPoolCount - dedupPoolCount)
    const rerankedSuppliers = [...fusedSuppliers]
      .sort((a, b) => Number(b?.rerankScore || 0) - Number(a?.rerankScore || 0))
      .filter((x) => Number(x?.rerankScore || 0) > 0)
    const rerankMeta = item?.evidence?.rerankMeta && typeof item.evidence.rerankMeta === 'object' ? item.evidence.rerankMeta : null
    const rerankPoolTotal = Number(rerankMeta?.totalCandidates || 0)
    const rerankTopN = Number(rerankMeta?.topN || 0)
    const rerankReturned = rerankedSuppliers.length
    const rerankBoundary = Array.isArray(rerankMeta?.boundary) ? rerankMeta.boundary.map((x) => String(x || '').trim()).filter(Boolean) : []
    const answerSections = parseAnswerSections(item?.rawAnswer || item?.content || '')
    const llmRawOutput = String(item?.rawAnswer || item?.content || '').trim()
    const llmRenderOutput = normalizeLlmMarkdownForRender(llmRawOutput)
    const promptText = String(item?.systemPrompt || item?.queryStatements?.prompt || '').trim()
    const retrievalSummary = [
      `DB命中供应商: ${dbCompanies.length}`,
      `RAG命中供应商: ${kbCompanies.length}`,
      `WEB命中供应商: ${mergedWebCompanies.length}`,
      `WEB命中线索: ${webSignals.length}`,
      `融合去重后: ${fusedSuppliers.length}`,
    ].join('\n')
    const stageResult = (stepNo) => executionStages.find((x) => Number(x?.step) === Number(stepNo)) || null
    const stageDone = (stepNo) => String(stageResult(stepNo)?.status || '').toLowerCase() === 'done'

    const dbRequestText = String(item?.queryStatements?.db?.template || executionPlanFromTrace?.dbQuery || item?.userInput || '').trim()
    const ragRequestText = String(item?.queryStatements?.rag?.endpoint || executionPlanFromTrace?.ragQuery || item?.userInput || '').trim()
    const webProviderText = String(item?.queryStatements?.web?.provider || '').trim()
    const configuredSearchToolText = String(item?.queryStatements?.web?.configuredSearchTool || '').trim()
    const effectiveSearchToolText = String(item?.queryStatements?.web?.effectiveSearchTool || '').trim()
    const webQueryText = String(item?.queryStatements?.web?.keyword || executionPlanFromTrace?.webQuery || item?.userInput || '').trim()
    const actualWebProviders = Array.from(new Set(
      (Array.isArray(item?.evidence?.webHits) ? item.evidence.webHits : [])
        .map((x) => String(x?._provider || '').trim())
        .filter(Boolean),
    ))
    const actualWebProviderText = actualWebProviders.length > 0 ? actualWebProviders.join(' + ') : '-'
    const needDbTask = selectedToolSet.has('db_chat') || intentDecision?.needDb === true
    const needRagTask = selectedToolSet.has('local_kb') || intentDecision?.needRag === true
    const needWebTask = selectedToolSet.has('web_search') || intentDecision?.needWeb === true
    const selectedDb = selectedToolSet.has('db_chat')
    const selectedRag = selectedToolSet.has('local_kb')
    const selectedWeb = selectedToolSet.has('web_search')
    const normalizePlanLine = (line = '') => String(line || '')
      .replace(/^\s*\d+(?:[.\-、)]\d+)*(?:[.\-、)])?\s*/u, '')
      .replace(/^\s*\d+\s*/u, '')
      .trim()
    const dynamicPlanLines = (() => {
      const source = planSteps.length > 0
        ? planSteps.map((x) => String(x?.title || x?.name || x || '').trim()).filter(Boolean)
        : [
            needDbTask ? '数据库候选召回' : '',
            needRagTask ? '知识库证据补强' : '',
            '证据融合与排序',
            '结构化报告输出',
          ].filter(Boolean)
      const normalized = source
        .map((x) => normalizePlanLine(x))
        .filter(Boolean)
        .map((x) => x.replace('结构化报告输出', 'LLM结构化生成（基于Rerank结果）'))
        .filter((x) => !/^执行开关\(/.test(x))
      const deduped = Array.from(new Set(normalized))
      const numbered = deduped.map((x, idx) => `${idx + 1}. ${x}`)
      numbered.push(`${numbered.length + 1}. 执行开关(DB=${selectedDb ? '是' : '否'}, RAG=${selectedRag ? '是' : '否'}, WEB=${selectedWeb ? '是' : '否'})`)
      return numbered.join('\n')
    })()
    const hitStatMatch = llmRawOutput.match(/【命中统计】[\s\S]*?DB结构化命中：\s*(\d+)\s*条[\s\S]*?RAG片段命中：\s*(\d+)\s*条[\s\S]*?WEB线索命中：\s*(\d+)\s*条/i)
    const conclusionMatch = llmRawOutput.match(/#?\s*结论概览[:：]?\s*([^\n\r]+)/i)
    const llmSummaryRows = [
      { key: 'db', item: 'DB结构化命中', value: hitStatMatch ? `${hitStatMatch[1]}条` : '-' },
      { key: 'rag', item: 'RAG片段命中', value: hitStatMatch ? `${hitStatMatch[2]}条` : '-' },
      { key: 'web', item: 'WEB线索命中', value: hitStatMatch ? `${hitStatMatch[3]}条` : '-' },
      { key: 'conclusion', item: '结论概览', value: conclusionMatch ? conclusionMatch[1] : '-' },
    ]
    const requestReady = activeToolTasks.length > 0 && (
      (needDbTask && dbRequestText)
      || (needRagTask && ragRequestText)
      || (needWebTask && webQueryText)
      || hasTraceStep('act_plan')
    )
    const hasFinalAnswer = String(item?.rawAnswer || item?.content || '').trim() && String(item?.content || '').trim() !== '执行中，请稍候...'

    const hasAnyActRetrieval = hasTraceStep('act_db') || hasTraceStep('act_rag') || hasTraceStep('act_web')
    const hasAnyObserveRetrieval = hasTraceStep('observe_db') || hasTraceStep('observe_rag') || hasTraceStep('observe_web')
    const rawDone = {
      s1: true,
      s2: hasTraceStep('plan') || hasFastPlan || Boolean(intentDecision) || stageDone(2),
      s3: planSteps.length > 0 || hasFastPlan || stageDone(3),
      s4: hasAnyActRetrieval || hasTraceStep('act_plan') || stageDone(4),
      s5: allActiveToolTasksDone || (activeToolTasks.length === 0 && hasTraceStep('observe_tools')) || stageDone(5),
      s6: hasAnyObserveRetrieval || stageDone(6),
      s7: hasTraceStep('observe_fuse') || hasTraceStep('act_fuse') || stageDone(7),
      s8: hasTraceStep('observe_rerank') || hasTraceStep('act_rerank') || stageDone(8),
      s9: hasTraceStep('observe_llm') || Boolean(stageResult(9)) || stageDone(9),
      s10: item?.streamDone === true || hasFinalAnswer,
    }
    if (hasFinalAnswer) {
      rawDone.s5 = true
      rawDone.s6 = true
      rawDone.s7 = true
      rawDone.s8 = true
      rawDone.s9 = true
      rawDone.s10 = true
    }
    const keysOrdered = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']
    const gatedDone = {}
    for (let i = 0; i < keysOrdered.length; i += 1) {
      const k = keysOrdered[i]
      if (i === 0) gatedDone[k] = rawDone[k]
      else gatedDone[k] = Boolean(rawDone[k] && gatedDone[keysOrdered[i - 1]])
    }
    const firstPendingIdx = keysOrdered.findIndex((k) => !gatedDone[k])
    const stepStatus = {}
    for (let i = 0; i < keysOrdered.length; i += 1) {
      const k = keysOrdered[i]
      if (gatedDone[k]) stepStatus[k] = 'done'
      else if (firstPendingIdx >= 0 && i === firstPendingIdx) stepStatus[k] = 'pending'
      else stepStatus[k] = 'pending'
    }

    const processSteps = [
      { key: 's1', stepNo: 1, title: '用户输入', detail: String(item?.userInput || item?.queryStatements?.db?.keyword || '-').slice(0, 240), status: stepStatus.s1 },
      {
        key: 's2',
        stepNo: 2,
        title: 'LLM语义理解与任务规划',
        detail: '语义解析: 意图=' + String(intentDecision?.intent || item?.intent || intentFromTrace || '-') + '\n任务规划: ' + String(intentDecision?.routeReason || planDetailText || (activeToolTasks.length > 0 ? `按所选工具执行：${activeToolTasks.map((x) => x.label).join('、')}` : '-')),
        status: stepStatus.s2,
      },
      { key: 's3', stepNo: 3, title: '检索子任务分解', detail: dynamicPlanLines, status: stepStatus.s3 },
      {
        key: 's4',
        stepNo: 4,
        title: '发起标准化工具请求',
        detail: [
          activeToolTasks.length > 0 ? ('任务: ' + activeToolTasks.map((x) => x.label).join('、')) : '任务: 无',
          'DB请求: ' + (dbRequestText || '-'),
          'RAG请求: ' + (ragRequestText || '-'),
          'WEB请求: ' + (webProviderText || 'web.searchSupplierSignals') + ' | query=' + (webQueryText || '-'),
          'WEB实际提供方: ' + actualWebProviderText,
        ].join('\n'),
        status: stepStatus.s4,
      },
      { key: 's5', stepNo: 5, title: '工具执行(DB/RAG/WEB)', detail: '', status: stepStatus.s5 },
      { key: 's6', stepNo: 6, title: '返回标准化结果（含 dbHits/ragHits/webHits）', detail: 'dbHits=' + metricDbHits + ' | ragHits=' + metricRagHits + ' | webHits=' + metricWebHits, status: stepStatus.s6 },
      { key: 's7', stepNo: 7, title: '证据整合与去重', detail: '全量企业池=' + String(allSupplierPool.length), status: stepStatus.s7 },
      { key: 's8', stepNo: 8, title: '候选重排(Rerank)', detail: 'query-candidate-evidence 相关性打分，输出 TopN + 边界样本', status: stepStatus.s8 },
      { key: 's9', stepNo: 9, title: '系统提示词 + 召回上下文交给LLM生成（含 model）', detail: 'model=' + String(item?.model || stageResult(9)?.meta?.model || '-'), status: stepStatus.s9 },
      { key: 's10', stepNo: 10, title: '返回最终结果', detail: '已返回最终答复', status: stepStatus.s10 },
    ]
    const visibleProcessSteps = processSteps.filter((step) => {
      if (step.key === 's3') return Boolean(String(step.detail || '').trim())
      return true
    })
    const firstPendingKey = firstPendingIdx >= 0 ? keysOrdered[firstPendingIdx] : 's10'
    const autoExpandedKeys = visibleProcessSteps
      .filter((step) => gatedDone[step.key] || step.key === firstPendingKey)
      .map((step) => step.key)
    const traceStepToProcessKey = (traceStep = '') => {
      const s = String(traceStep || '').toLowerCase()
      if (!s) return ''
      if (s === 'plan' || s.startsWith('think_plan') || s.startsWith('observe_plan')) return 's2'
      if (s.startsWith('act_plan')) return 's4'
      if (s.startsWith('think_retrieval')) return 's3'
      if (s.startsWith('act_db') || s.startsWith('act_rag') || s.startsWith('act_web') || s.startsWith('observe_tools')) return 's5'
      if (s.startsWith('observe_db') || s.startsWith('observe_rag') || s.startsWith('observe_web')) return 's6'
      if (s.startsWith('act_fuse') || s.startsWith('observe_fuse')) return 's7'
      if (s.startsWith('act_rerank') || s.startsWith('observe_rerank') || s.startsWith('think_rerank')) return 's8'
      if (s.startsWith('think_llm') || s.startsWith('observe_llm') || s.startsWith('act_llm')) return 's9'
      if (s.startsWith('final') || s.startsWith('done')) return 's10'
      return ''
    }
    const traceLinesByStep = (() => {
      const map = {}
      for (const st of visibleProcessSteps) map[st.key] = []
      traces.forEach((t) => {
        const key = traceStepToProcessKey(t?.step)
        if (!key || !map[key]) return
        const detail = String(t?.detail || '').trim()
        const title = String(t?.title || '').trim()
        const tool = String(t?.tool || '').trim()
        const line = [String(t?.step || '-'), title, tool ? `tool=${tool}` : '', detail]
          .filter(Boolean)
          .join(' | ')
        if (line) map[key].push(line)
      })
      return map
    })()

    return (
      <div style={{ marginTop: 10 }}>
        <Collapse
          key={`proc-${firstPendingKey}-${visibleProcessSteps.length}`}
          size="small"
          defaultActiveKey={autoExpandedKeys}
          items={visibleProcessSteps.map((step, idx) => ({
            key: step.key,
            label: (
              <Space size={8}>
                <Tag color={step.status === 'done' ? 'green' : step.status === 'skipped' ? 'default' : 'blue'}>{step.status}</Tag>
                <span>{idx + 1}. {step.title}</span>
              </Space>
            ),
            children: (
              <div>
                {step.key === 's4' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#0f172a' }}>
                        任务: {activeToolTasks.length > 0 ? activeToolTasks.map((x) => x.label).join('、') : '无'}
                      </div>
                    </div>
                    {(selectedToolSet.has('db_chat') || intentDecision?.needDb === true) ? (
                      <div style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 8, background: '#f8fbff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <Tag color={dbRequestText ? 'green' : 'blue'}>{dbRequestText ? 'ready' : 'pending'}</Tag>
                          DB请求
                        </div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          template: {dbRequestText || '-'}
                        </div>
                      </div>
                    ) : null}
                    {(selectedToolSet.has('local_kb') || intentDecision?.needRag === true) ? (
                      <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, padding: 8, background: '#faf5ff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <Tag color={ragRequestText ? 'green' : 'blue'}>{ragRequestText ? 'ready' : 'pending'}</Tag>
                          RAG请求
                        </div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          query: {ragRequestText || '-'}
                        </div>
                      </div>
                    ) : null}
                    {(selectedToolSet.has('web_search') || intentDecision?.needWeb === true) ? (
                      <div style={{ border: '1px solid #bbf7d0', borderRadius: 8, padding: 8, background: '#f0fdf4' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <Tag color={webQueryText ? 'green' : 'blue'}>{webQueryText ? 'ready' : 'pending'}</Tag>
                          WEB请求
                        </div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          搜索配置工具: {configuredSearchToolText || webProviderText || '-'}{'\n'}
                          实际执行工具: {effectiveSearchToolText || '-'}{'\n'}
                          命中provider聚合: {actualWebProviderText !== '-' ? actualWebProviderText : (webProviderText || 'web.searchSupplierSignals')}{'\n'}
                          query: {webQueryText || '-'}
                        </div>
                      </div>
                    ) : null}
                  </Space>
                ) : step.key === 's5' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {activeToolTasks.length > 0 ? activeToolTasks.map((task, tIdx) => {
                      const taskStatus = doneOrSkipped(task.done, false)
                      return (
                        <div key={'tool-task-' + task.key} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                          <div style={{ fontSize: 12, color: '#0f172a' }}>
                            <Tag color={taskStatus === 'done' ? 'green' : taskStatus === 'skipped' ? 'default' : 'blue'}>{taskStatus}</Tag>
                            {tIdx + 1}. {task.label}
                          </div>
                        </div>
                      )
                    }) : <div style={{ fontSize: 12, color: '#64748b' }}>未选择工具任务</div>}
                    {selectedToolSet.has('db_chat') || intentDecision?.needDb === true ? (
                      <div style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 8, background: '#f8fbff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>DB命中企业（{dbCompanies.length}）</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {dbCompanies.length > 0 ? dbCompanies.map((name, i) => <Tag key={`db-company-${i}`} color="blue">{name}</Tag>) : <span style={{ fontSize: 12, color: '#64748b' }}>无</span>}
                        </div>
                      </div>
                    ) : null}
                    {selectedToolSet.has('local_kb') || intentDecision?.needRag === true ? (
                      <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, padding: 8, background: '#faf5ff' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          RAG候选企业（{kbCompanies.length}）
                          <span style={{ color: '#64748b' }}> | 命中片段 {metricRagHits}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {kbCompanies.length > 0 ? kbCompanies.map((name, i) => <Tag key={`kb-company-${i}`} color="purple">{name}</Tag>) : <span style={{ fontSize: 12, color: '#64748b' }}>无</span>}
                        </div>
                        {kbCompanies.length === 0 && kbSignalLines.length > 0 ? (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, marginBottom: 6 }}>RAG命中片段（{kbSignals.length}）</div>
                            <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {kbSignalLines.join('\n')}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {selectedToolSet.has('web_search') || intentDecision?.needWeb === true ? (
                      <div style={{ border: '1px solid #bbf7d0', borderRadius: 8, padding: 8, background: '#f0fdf4' }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          WEB候选企业（{mergedWebCompanies.length}）
                          <span style={{ color: '#64748b' }}> | 命中线索 {metricWebHits}</span>
                          <span style={{ color: '#64748b' }}> | 主流程候选 {webCompanies.length}，异步补全候选 {webDerivedCompanies.length}</span>
                        </div>
                        {webEnrichNote ? (
                          <div style={{ fontSize: 12, color: '#166534', marginBottom: 6, whiteSpace: 'pre-wrap' }}>
                            {webEnrichNote}
                          </div>
                        ) : null}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {mergedWebCompanies.length > 0 ? mergedWebCompanies.map((name, i) => <Tag key={`web-company-${i}`} color="green">{name}</Tag>) : <span style={{ fontSize: 12, color: '#64748b' }}>无</span>}
                        </div>
                        {mergedWebCompanies.length === 0 && webSignalLines.length > 0 ? (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, marginBottom: 6 }}>WEB命中线索（{webSignals.length}）</div>
                            <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {webSignalLines.join('\n')}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>调用顺序与结果</div>
                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {traces
                          .filter((t) => /^(act_|observe_)/i.test(String(t?.step || '')))
                          .map((t, i) => (
                            <div key={`trace-exec-${i}`} style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {i + 1}. {String(t?.step || '-')} | tool={String(t?.tool || '-')}
                              {t?.input ? `\ninput=${JSON.stringify(t.input)}` : ''}
                              {t?.detail ? `\nresult=${String(t.detail)}` : ''}
                            </div>
                          ))}
                      </Space>
                    </div>
                  </Space>
                ) : step.key === 's6' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ border: '1px solid #dbeafe', borderRadius: 8, padding: 8, background: '#f8fbff' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>DB供应商（{dbCompanies.length}）</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {fusedSuppliers.filter((x) => x.dbScore > 0).map((x, i) => <Tag key={`s6-db-${i}`} color="blue">{x.name} ({x.dbScore.toFixed(2)})</Tag>)}
                      </div>
                    </div>
                    <div style={{ border: '1px solid #e9d5ff', borderRadius: 8, padding: 8, background: '#faf5ff' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>RAG供应商（{kbCompanies.length}）</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {kbCompanies.map((name, i) => <Tag key={`s6-kb-${i}`} color="purple">{name}</Tag>)}
                      </div>
                    </div>
                    <div style={{ border: '1px solid #bbf7d0', borderRadius: 8, padding: 8, background: '#f0fdf4' }}>
                      <div style={{ fontSize: 12, marginBottom: 6 }}>WEB供应商（{mergedWebCompanies.length}）</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {mergedWebCompanies.map((name, i) => <Tag key={`s6-web-${i}`} color="green">{name}</Tag>)}
                      </div>
                      {mergedWebCompanies.length === 0 && webSignalLines.length > 0 ? (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                          {webSignalLines.join('\n')}
                        </div>
                      ) : null}
                    </div>
                  </Space>
                ) : step.key === 's7' ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#f8fafc' }}>
                      <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>
                        {`原始总数=${rawPoolCount}
去重后总数=${dedupPoolCount}
差值=${reducedCount}（主要来自同名去重与非企业名过滤）`}
                      </div>
                    </div>
                    {allSupplierPool.map((x, i) => (
                      <div key={`s7-fused-${i}`} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                        <div style={{ fontSize: 12, color: '#0f172a' }}>{i + 1}. {x.name}</div>
                        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Tag color="green">融合分 {x.fusedScore.toFixed(2)}</Tag>
                          <Tag color="blue">DB {x.dbScore.toFixed(2)}</Tag>
                          <Tag color="purple">KB {x.kbSupport}</Tag>
                          <Tag color="cyan">WEB {x.webSupport}</Tag>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : step.key === 's8' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Rerank结果（独立阶段）</div>
                      <div style={{ fontSize: 12, color: '#334155', marginBottom: 8 }}>
                        候选池总数={rerankPoolTotal || '-'}；目标TopN={rerankTopN || '-'}；实际返回={rerankReturned}
                        {rerankTopN > 0 && rerankReturned < rerankTopN ? `（未达TopN，因可用候选仅 ${rerankReturned} 条）` : ''}
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {(rerankedSuppliers.length > 0 ? rerankedSuppliers : fusedSuppliers).map((x, i) => (
                          <div key={`s8-r-${i}`} style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: 6 }}>
                            <div style={{ fontSize: 12 }}>{i + 1}. {x.name}</div>
                            <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <Tag color="gold">Rerank {Number(x?.rerankScore || 0).toFixed(2)}</Tag>
                              <Tag color="green">融合分 {x.fusedScore.toFixed(2)}</Tag>
                              <Button
                                size="small"
                                type="link"
                                style={{ padding: 0, height: 'auto' }}
                                onClick={() => {
                                  setRerankDetailRecord(x)
                                  setRerankDetailOpen(true)
                                }}
                              >
                                查看得分详情
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ border: '1px solid #f1f5f9', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>边界样本（不计入TopN）</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {rerankBoundary.length > 0
                          ? rerankBoundary.map((name, i) => <Tag key={`s8-b-${i}`}>{name}</Tag>)
                          : <span style={{ fontSize: 12, color: '#94a3b8' }}>无</span>}
                      </div>
                    </div>
                  </Space>
                ) : step.key === 's9' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>提示词</div>
                      <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{promptText || '未显式传入（使用后端默认提示词）'}</div>
                    </div>
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>召回上下文摘要</div>
                      <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{retrievalSummary}</div>
                    </div>
                  </Space>
                ) : step.key === 's10' ? (
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    {step.status !== 'done' ? (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                        <div style={{ fontSize: 12, color: '#64748b' }}>LLM正在生成最终结果，当前为流式草稿，完成后自动刷新。</div>
                      </div>
                    ) : null}
                    {answerSections['【结论】'] ? (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>结论</div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{answerSections['【结论】']}</div>
                      </div>
                    ) : null}
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff', display: step.status === 'done' ? 'block' : 'none' }}>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>供应商列表</div>
                      <Table
                        size="small"
                        pagination={false}
                        rowKey={(r) => `${r.name}-${r.rerankIndex || 0}`}
                        dataSource={fusedSuppliers.map((x, i) => ({ ...x, rank: i + 1 }))}
                        columns={[
                          { title: '排名', dataIndex: 'rank', key: 'rank', width: 64 },
                          { title: '企业', dataIndex: 'name', key: 'name' },
                          { title: '融合分', dataIndex: 'fusedScore', key: 'fusedScore', width: 90, render: (v) => Number(v || 0).toFixed(2) },
                          { title: 'DB', dataIndex: 'dbScore', key: 'dbScore', width: 70, render: (v) => Number(v || 0).toFixed(2) },
                          { title: 'RAG', dataIndex: 'kbSupport', key: 'kbSupport', width: 70 },
                          { title: 'WEB', dataIndex: 'webSupport', key: 'webSupport', width: 70 },
                        ]}
                      />
                    </div>
                    <div style={{ border: '1px solid #dbeafe', borderRadius: 10, padding: 10, background: 'linear-gradient(180deg,#f8fbff 0%,#ffffff 100%)', display: step.status === 'done' ? 'block' : 'none' }}>
                      <div style={{ fontSize: 13, color: '#1e3a8a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <MessageOutlined />
                        <span>LLM大模型输出（原文）</span>
                      </div>
                      <Table
                        size="small"
                        pagination={false}
                        dataSource={llmSummaryRows}
                        columns={[
                          { title: '项目', dataIndex: 'item', key: 'item', width: 180 },
                          { title: '值', dataIndex: 'value', key: 'value' },
                        ]}
                        style={{ marginBottom: 10 }}
                      />
                      {llmRawOutput ? (
                        <div style={{ fontSize: 12, color: '#334155', overflowX: 'auto', lineHeight: 1.7 }}>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({ children }) => (
                                <table
                                  style={{
                                    width: '100%',
                                    minWidth: 980,
                                    borderCollapse: 'separate',
                                    borderSpacing: 0,
                                    margin: '10px 0',
                                    background: '#fff',
                                    border: '1px solid #dbeafe',
                                    borderRadius: 10,
                                    overflow: 'hidden',
                                    tableLayout: 'auto',
                                  }}
                                >
                                  {children}
                                </table>
                              ),
                              thead: ({ children }) => <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>{children}</thead>,
                              tr: ({ children }) => <tr style={{ borderBottom: '1px solid #eef2ff' }}>{children}</tr>,
                              th: ({ children }) => {
                                const text = markdownChildrenToText(children)
                                const isTraceCol = /可追溯链接/.test(text)
                                return (
                                  <th
                                    style={{
                                      borderBottom: '1px solid #cfe1ff',
                                      padding: '10px 10px',
                                      background: '#eaf2ff',
                                      color: '#0f172a',
                                      textAlign: 'left',
                                      whiteSpace: 'normal',
                                      wordBreak: 'keep-all',
                                      overflowWrap: 'anywhere',
                                      lineHeight: 1.5,
                                      fontWeight: 600,
                                      width: isTraceCol ? 150 : undefined,
                                      maxWidth: isTraceCol ? 150 : undefined,
                                    }}
                                  >
                                    {children}
                                  </th>
                                )
                              },
                              td: ({ children }) => {
                                const text = markdownChildrenToText(children)
                                const likelyUrlCell = /https?:\/\//i.test(text) || /^www\./i.test(text)
                                return (
                                  <td
                                    style={{
                                      borderBottom: '1px solid #eef2f7',
                                      padding: '9px 10px',
                                      verticalAlign: 'top',
                                      background: '#ffffff',
                                      whiteSpace: 'normal',
                                      wordBreak: likelyUrlCell ? 'break-all' : 'break-word',
                                      overflowWrap: 'anywhere',
                                      lineHeight: 1.6,
                                      width: likelyUrlCell ? 150 : undefined,
                                      maxWidth: likelyUrlCell ? 150 : undefined,
                                    }}
                                  >
                                    {children}
                                  </td>
                                )
                              },
                              h1: ({ children }) => <h4 style={{ margin: '10px 0 6px', color: '#0f172a' }}>{children}</h4>,
                              h2: ({ children }) => <h4 style={{ margin: '10px 0 6px', color: '#0f172a' }}>{children}</h4>,
                              h3: ({ children }) => <h5 style={{ margin: '8px 0 6px', color: '#1e293b' }}>{children}</h5>,
                              p: ({ children }) => <p style={{ margin: '6px 0' }}>{children}</p>,
                              ul: ({ children }) => <ul style={{ margin: '6px 0 6px 18px' }}>{children}</ul>,
                              ol: ({ children }) => <ol style={{ margin: '6px 0 6px 18px' }}>{children}</ol>,
                              li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
                              code: ({ children }) => <code style={{ background: '#eef2ff', color: '#1e3a8a', padding: '1px 5px', borderRadius: 4 }}>{children}</code>,
                              blockquote: ({ children }) => <blockquote style={{ margin: '8px 0', padding: '6px 10px', borderLeft: '3px solid #93c5fd', background: '#f8fafc' }}>{children}</blockquote>,
                            }}
                          >
                            {llmRenderOutput}
                          </ReactMarkdown>
                        </div>
                      ) : <div style={{ fontSize: 12, color: '#64748b' }}>暂无模型输出</div>}
                    </div>
                    {answerSections['【候选供应商TopN】'] ? (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>建议</div>
                        <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{answerSections['【候选供应商TopN】']}</div>
                      </div>
                    ) : null}
                  </Space>
                ) : (
                  <div>
                    {step.detail ? (
                      <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{step.detail}</div>
                    ) : null}
                    {stageResult(step.stepNo)?.meta && typeof stageResult(step.stepNo).meta === 'object' ? (
                      <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', whiteSpace: 'pre-wrap' }}>
                        {Object.entries(stageResult(step.stepNo).meta).map(([k, v]) => String(k) + ': ' + String(v)).join(' | ')}
                      </div>
                    ) : null}
                    {Array.isArray(traceLinesByStep[step.key]) && traceLinesByStep[step.key].length > 0 ? (
                      <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f8fafc', padding: 8 }}>
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>流式日志</div>
                        <div style={{ display: 'grid', gap: 4 }}>
                          {traceLinesByStep[step.key].map((line, i) => (
                            <div key={`trace-line-${step.key}-${i}`} style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                              {i + 1}. {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ),
          }))}
        />

      </div>
    )
  }

  async function onSend() {
    const question = String(input || '').trim()
    if (!question || loading) return

    const nextHistory = [...activeMessages, { role: 'user', content: question, ts: Date.now() }]
    patchActiveMessages(nextHistory)
    setInput('')
    setLoading(true)

    try {
      const reportTemplate = templateType !== 'none' && templateFile
        ? {
          type: templateType,
          fileName: String(templateFile.name || ''),
          dataUrl: await fileToDataUrl(templateFile),
        }
        : null

      const pendingAssistant = {
        role: 'assistant',
        content: '执行中，请稍候...',
        rawAnswer: '',
        userInput: question,
        streamDone: false,
        evidence: { suppliers: [], kbHits: [], webHits: [] },
        artifacts: [],
        queryStatements: {},
        traces: [],
        react: { rounds: [] },
        intentDecision: null,
        planSteps: [],
        intent: '',
        traceVersion: '',
        systemPrompt: systemPromptEnabled ? systemPrompt : '',
        systemPromptPresetKey: systemPromptEnabled ? systemPromptPresetKey : '',
        selectedTools: Array.isArray(selectedTools) ? [...selectedTools] : [],
        ts: Date.now(),
      }
      patchActiveMessages([...nextHistory, pendingAssistant])

      await chatPreciseSourcingAgentStream({
        message: question,
        model: selectedModelName,
        executionMode: 'fast',
        finalTopN: 10,
        systemPrompt: systemPromptEnabled ? systemPrompt : '',
        systemPromptPresetKey: systemPromptEnabled ? systemPromptPresetKey : '',
        kbId: selectedKbIds[0] || '',
        kbIds: selectedKbIds,
        topK: kbTopK,
        dbTopK,
        selectedTools,
        selectedSkills: selectedTools,
        selectedDbTables,
        strictMode,
        temperature,
        sourceQuota: effectiveSourceQuota,
        reportTemplate,
        history: nextHistory.slice(-12),
      }, {
        onTrace: (evt) => {
          const trace = evt?.trace
          if (!trace) return
          patchLastAssistantMessage((last) => {
            const traces = [...(Array.isArray(last?.traces) ? last.traces : []), trace]
            const detail = String(trace?.detail || '')
            let nextIntent = last?.intentDecision && typeof last.intentDecision === 'object' ? { ...last.intentDecision } : null
            let nextPlanSteps = Array.isArray(last?.planSteps) ? [...last.planSteps] : []
            if (String(trace?.step || '').toLowerCase().startsWith('plan')) {
              const intentMatch = detail.match(/意图[=：]([a-z_]+)/i)
              const dbMatch = detail.match(/DB[=：](是|否)/)
              const ragMatch = detail.match(/RAG[=：](是|否)/)
              const webMatch = detail.match(/WEB[=：](是|否)/)
              const planMatch = detail.match(/计划分解=([^\n\r]+)/)
              if (!nextIntent) nextIntent = {}
              if (intentMatch) nextIntent.intent = String(intentMatch[1] || '').trim()
              if (dbMatch) nextIntent.needDb = dbMatch[1] === '是'
              if (ragMatch) nextIntent.needRag = ragMatch[1] === '是'
              if (webMatch) nextIntent.needWeb = webMatch[1] === '是'
              nextIntent.routeReason = detail || nextIntent.routeReason || ''
              if (planMatch?.[1]) {
                const parts = String(planMatch[1])
                  .split(/[；/]/)
                  .map((x) => String(x || '').trim())
                  .filter(Boolean)
                if (parts.length > 0) nextPlanSteps = parts.map((p, idx) => ({ id: `trace-plan-${idx + 1}`, title: p }))
              }
            }
            return {
              ...last,
              traces,
              react: { rounds: [] },
              intentDecision: nextIntent,
              planSteps: nextPlanSteps,
            }
          })
        },
        onHeartbeat: (evt) => {
          patchLastAssistantMessage((last) => ({
            ...last,
            lastHeartbeat: String(evt?.message || '正在执行中，请稍候...'),
          }))
        },
        onDelta: (evt) => {
          const delta = String(evt?.text || '')
          if (!delta) return
          patchLastAssistantMessage((last) => {
            const prev = String(last?.rawAnswer || '')
            const next = `${prev}${delta}`
            return {
              ...last,
              rawAnswer: next,
              content: next,
            }
          })
        },
        onFinal: (data) => {
          const evidence = data?.evidence || {}
          const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : []
          const qs = data?.queryStatements && typeof data.queryStatements === 'object' ? data.queryStatements : {}
          patchLastAssistantMessage((last) => ({
            ...last,
            userInput: question,
            streamDone: true,
            content: String(data?.answer || '未返回内容'),
            rawAnswer: String(data?.answer || ''),
            evidence,
            artifacts,
            queryStatements: qs,
            traces: (() => {
              const finalTraces = Array.isArray(data?.traces) ? data.traces : null
              const fallbackTraces = Array.isArray(last?.traces) ? last.traces : []
              return finalTraces && finalTraces.length > 0 ? finalTraces : fallbackTraces
            })(),
            systemPrompt: String(last?.systemPrompt || ''),
            systemPromptPresetKey: String(last?.systemPromptPresetKey || ''),
            react: data?.react || { rounds: [] },
            intentDecision: data?.intentDecision && typeof data.intentDecision === 'object'
              ? data.intentDecision
              : (last?.intentDecision && typeof last.intentDecision === 'object' ? last.intentDecision : null),
            planSteps: Array.isArray(data?.planSteps) && data.planSteps.length > 0
              ? data.planSteps
              : (Array.isArray(last?.planSteps) ? last.planSteps : []),
            intent: String(data?.intent || ''),
            traceVersion: String(data?.traceVersion || ''),
            ts: Date.now(),
          }))
        },
        onEnrich: (data) => {
          const extraWebHits = Array.isArray(data?.webHits) ? data.webHits : []
          const extraSuppliers = Array.isArray(data?.webDerivedSuppliers) ? data.webDerivedSuppliers : []
          const enrichNote = String(data?.note || '').trim()
          patchLastAssistantMessage((last) => {
            const prevEvidence = last?.evidence && typeof last.evidence === 'object' ? last.evidence : { suppliers: [], kbHits: [], webHits: [] }
            const mergedWebHits = [...(Array.isArray(prevEvidence.webHits) ? prevEvidence.webHits : []), ...extraWebHits]
            const dedupWebHits = Array.from(new Map(mergedWebHits.map((x, i) => [String(x?.url || x?.link || x?.title || `row-${i}`), x])).values())
            const mergedDerived = [...(Array.isArray(prevEvidence.webDerivedSuppliers) ? prevEvidence.webDerivedSuppliers : []), ...extraSuppliers]
            const dedupDerived = Array.from(new Set(mergedDerived.map((x) => String(x || '').trim()).filter(Boolean)))
            return {
              ...last,
              content: String(last?.content || ''),
              rawAnswer: String(last?.rawAnswer || ''),
              evidence: {
                ...prevEvidence,
                webHits: dedupWebHits,
                webDerivedSuppliers: dedupDerived,
                webEnrichNote: enrichNote || String(prevEvidence?.webEnrichNote || ''),
              },
              ts: Date.now(),
            }
          })
        },
        onDone: () => {
          patchLastAssistantMessage((last) => ({ ...last, streamDone: true }))
        },
        onError: (evt) => {
          const errText = String(evt?.message || '执行失败').trim()
          patchLastAssistantMessage((last) => ({
            ...last,
            streamDone: true,
            content: errText || '执行失败',
            rawAnswer: String(last?.rawAnswer || errText || '执行失败'),
          }))
          message.error(errText || '执行失败')
        },
      })
    } catch (error) {
      patchActiveMessages(activeMessages)
      message.error(error.message || '执行失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: showSidebar ? '320px 1fr' : '44px 1fr', gap: 12, height: 'calc(100vh - 130px)', minHeight: 0, overflow: 'hidden' }}>
      {showSidebar ? (
        <Card className="app-elevated-card" style={{ height: '100%', minHeight: 0 }} bodyStyle={{ padding: 12, height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setShowSidebar(false)} />
            </div>

            <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space align="center" size={8}>
                  <MessageOutlined style={{ color: '#2563eb' }} />
                  <Text strong style={{ color: '#1d4ed8' }}>精准寻源智能体</Text>
                </Space>
                <Button
                  type="text"
                  size="small"
                  icon={<DeploymentUnitOutlined />}
                  title="查看智能体流程图"
                  onClick={() => setFlowDialogOpen(true)}
                />
              </div>
              <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>当前会话：{currentSession}</div>
            </div>

            <Tabs
              size="small"
              items={[
                {
                  key: 'tool',
                  label: '工具设置',
                  children: (
                    <Space direction="vertical" size={14} style={{ width: '100%' }}>
                      <div>
                        <Text>选择工具:</Text>
                        <Select
                          mode="multiple"
                          value={selectedTools}
                          onChange={setSelectedTools}
                          options={toolOptions}
                          style={{ width: '100%', marginTop: 8 }}
                          placeholder="请选择工具"
                          allowClear
                          maxTagCount="responsive"
                        />
                      </div>
                      <div>
                        <Text>模型设置:</Text>
                        <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 8 }}>
                          <Tag color="blue">{selectedModelName || '未设置'}</Tag>
                          <Button
                            size="small"
                            onClick={() => {
                              const providerWithModel = modelProviders.find((p) => {
                                const rows = Array.isArray(p?.fetchedModels) && p.fetchedModels.length > 0 ? p.fetchedModels : (Array.isArray(p?.models) ? p.models : [])
                                return rows.some((m) => String(m?.id || '').trim() === String(selectedModelName || '').trim())
                              })
                              setModelProviderDraft(providerWithModel?.providerName || modelProviders[0]?.providerName || '')
                              setModelDraft(selectedModelName || '')
                              setModelDialogOpen(true)
                            }}
                          >
                            选择模型
                          </Button>
                        </Space>
                      </div>
                      <div>
                        <Text>提示词设置:</Text>
                        <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 8 }}>
                          <Text type="secondary" style={{ maxWidth: 180 }} ellipsis>
                            {promptPreviewText || '未设置'}
                          </Text>
                          <Button
                            size="small"
                            onClick={() => {
                              setPromptDraft(systemPrompt || '')
                              setPromptEnabledDraft(systemPromptEnabled)
                              setPromptPresetKeyDraft(systemPromptPresetKey || 'default')
                              setPromptDialogOpen(true)
                            }}
                          >
                            编辑提示词
                          </Button>
                        </Space>
                      </div>
                      <div>
                        <Text>请选择知识库:</Text>
                        <Select
                          mode="multiple"
                          value={selectedKbIds}
                          onChange={setSelectedKbIds}
                          options={kbOptions}
                          style={{ width: '100%', marginTop: 8 }}
                          placeholder="请选择知识库"
                          allowClear
                          maxTagCount="responsive"
                        />
                      </div>
                      <div>
                        <Text>请选择数据库（实例与表）:</Text>
                        <div style={{ marginTop: 6, marginBottom: 6, color: '#64748b', fontSize: 12 }}>
                          当前实例：`PostgreSQL(main/public)`
                        </div>
                        <Select
                          mode="multiple"
                          value={selectedDbTables}
                          onChange={setSelectedDbTables}
                          options={DB_OPTIONS}
                          style={{ width: '100%', marginTop: 8 }}
                          placeholder="可多选数据库表"
                          allowClear
                          maxTagCount="responsive"
                        />
                        <Space size={8} style={{ marginTop: 8 }}>
                          <Button size="small" onClick={onSelectAllDbTables}>全选</Button>
                          <Button size="small" onClick={onClearDbTables}>清空</Button>
                        </Space>
                      </div>
                      <Checkbox checked={strictMode} onChange={(e) => setStrictMode(e.target.checked)}>
                        严格模式（仅保留关键字段命中）
                      </Checkbox>
                      <div>
                        <Space size={6} align="center">
                          <Text>分源保底配额:</Text>
                          <Tooltip
                            placement="top"
                            title={(
                              <div style={{ whiteSpace: 'pre-wrap', maxWidth: 520 }}>
                                {`对齐标准成分为4层并可回溯：

1、实体抽取规则
从哪段文本抽到的名字（原文片段）
抽取方式（规则/LLM）
置信度分数
2、实体规范化规则
名称如何清洗（去前后缀、括号、噪声词）
别名如何映射到标准名（alias map）
为什么 A 映射到 B（显示映射依据）
3、匹配规则
精确匹配/模糊匹配阈值是多少
是否允许简称、英文名、子公司名匹配
命中时给出匹配类型和相似度
4、归因规则
为什么这条证据算到该企业（证据片段 + 匹配路径）
为什么没算（失败原因：未抽取/低置信/冲突/低相似度）`}
                              </div>
                            )}
                          >
                            <InfoCircleOutlined style={{ color: '#64748b', cursor: 'pointer' }} />
                          </Tooltip>
                        </Space>
                        {activeFusionTools.length === 0 ? (
                          <div style={{ marginTop: 8, color: '#64748b', fontSize: 12 }}>
                            请先勾选“数据库检索 / 知识库检索 / 互联网搜索”中的至少一项。
                          </div>
                        ) : (
                          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: activeFusionTools.length === 2 ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
                            {activeFusionTools.some((x) => x.key === 'db') ? (
                              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px' }}>
                                <div style={{ fontSize: 12, color: '#475569' }}>DB {sourceQuotaDb}</div>
                                <Slider min={0} max={10} step={1} value={sourceQuotaDb} onChange={(v) => setSourceQuotaDb(Number(v || 0))} tooltip={{ open: false }} />
                              </div>
                            ) : null}
                            {activeFusionTools.some((x) => x.key === 'kb') ? (
                              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px' }}>
                                <div style={{ fontSize: 12, color: '#475569' }}>RAG {sourceQuotaRag}</div>
                                <Slider min={0} max={10} step={1} value={sourceQuotaRag} onChange={(v) => setSourceQuotaRag(Number(v || 0))} tooltip={{ open: false }} />
                              </div>
                            ) : null}
                            {activeFusionTools.some((x) => x.key === 'web') ? (
                              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px' }}>
                                <div style={{ fontSize: 12, color: '#475569' }}>WEB {sourceQuotaWeb}</div>
                                <Slider min={0} max={10} step={1} value={sourceQuotaWeb} onChange={(v) => setSourceQuotaWeb(Number(v || 0))} tooltip={{ open: false }} />
                              </div>
                            ) : null}
                          </div>
                        )}
                        <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>
                          先按 DB/RAG/WEB 保底配额入选，再按总分竞争补齐剩余名额。
                        </div>
                      </div>
                      <div style={{ borderTop: '1px solid #d9d9d9', paddingTop: 12 }}>
                        <Text>报告模板类型:</Text>
                        <Select value={templateType} onChange={setTemplateType} options={TEMPLATE_TYPE_OPTIONS} style={{ width: '100%', marginTop: 8 }} />
                        <Upload
                          style={{ marginTop: 8 }}
                          beforeUpload={() => false}
                          maxCount={1}
                          showUploadList
                          onChange={onTemplateUpload}
                          disabled={templateType === 'none'}
                          accept={templateType === 'ppt' ? '.ppt,.pptx' : templateType === 'word' ? '.doc,.docx' : '.xls,.xlsx,.csv'}
                        >
                          <Button style={{ marginTop: 8 }} disabled={templateType === 'none'}>
                            上传报告模板
                          </Button>
                        </Upload>
                      </div>
                      <div>
                        <Text>匹配知识条数:</Text>
                        <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 10, height: 40, background: '#fff', display: 'grid', gridTemplateColumns: '1fr 36px 36px', alignItems: 'center' }}>
                          <div style={{ paddingLeft: 12, fontSize: 15 }}>{kbTopK}</div>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(kbTopK, -1, 1, 20, setKbTopK)}>-</Button>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(kbTopK, 1, 1, 20, setKbTopK)}>+</Button>
                        </div>
                      </div>
                      <div>
                        <Text>匹配数据库条数:</Text>
                        <div style={{ marginTop: 8, border: '1px solid #e5e7eb', borderRadius: 10, height: 40, background: '#fff', display: 'grid', gridTemplateColumns: '1fr 36px 36px', alignItems: 'center' }}>
                          <div style={{ paddingLeft: 12, fontSize: 15 }}>{dbTopK}</div>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(dbTopK, -1, 1, 50, setDbTopK)}>-</Button>
                          <Button type="text" style={{ borderRadius: 0, height: 38, fontSize: 16 }} onClick={() => stepNumber(dbTopK, 1, 1, 50, setDbTopK)}>+</Button>
                        </div>
                      </div>
                      <div>
                        <Text>Temperature:</Text>
                        <div style={{ marginTop: 4, textAlign: 'right', color: '#1d4ed8', fontSize: 16 }}>{Number(temperature).toFixed(2)}</div>
                        <Slider
                          min={0}
                          max={1}
                          step={0.01}
                          value={temperature}
                          onChange={(v) => setTemperature(Number(v || 0))}
                          tooltip={{ open: false }}
                          styles={{ track: { backgroundColor: '#1d4ed8' }, rail: { backgroundColor: '#bfdbfe' }, handle: { borderColor: '#2563eb' } }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                          <span>0.00</span>
                          <span>1.00</span>
                        </div>
                        <div style={{ marginTop: 4, color: '#64748b', fontSize: 12 }}>
                          Temperature 越低越稳定一致，越高越发散有创意；报告场景建议 0.2~0.7。
                        </div>
                      </div>
                    </Space>
                  ),
                },
                {
                  key: 'session',
                  label: '会话设置',
                  children: (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div>
                        <Text type="secondary">历史会话</Text>
                        <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 6, background: '#fff' }}>
                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            {sessions.map((s, idx) => (
                              <Button key={`${s.name}-${idx}`} type={s.name === currentSession ? 'primary' : 'default'} onClick={() => setCurrentSession(s.name)} style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}>
                                {s.name}
                              </Button>
                            ))}
                          </Space>
                        </div>
                      </div>
                      <Space>
                        <Button onClick={onCreateSession}>新建</Button>
                        <Button onClick={onRenameSession}>重命名</Button>
                        <Button onClick={onDeleteSession}>删除</Button>
                      </Space>
                      <div>
                        <Text>当前会话：</Text>
                        <div style={{ marginTop: 8 }}>
                          <Button type="primary" style={{ borderRadius: 10 }}>{currentSession}</Button>
                        </div>
                      </div>
                      <Space>
                        <Button onClick={onExportSession}>导出记录</Button>
                        <Button onClick={() => patchActiveMessages([])}>清空对话</Button>
                      </Space>
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        </Card>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 8 }}>
          <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setShowSidebar(true)} />
        </div>
      )}

      <Card className="app-elevated-card" style={{ height: '100%', minHeight: 0, minWidth: 0, maxWidth: '100%' }} bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0, maxWidth: '100%', padding: 12, overflow: 'hidden' }}>
        <div ref={viewportRef} style={{ flex: 1, minHeight: 0, minWidth: 0, maxWidth: '100%', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', padding: 10, overflowY: 'auto', overflowX: 'hidden' }}>
          {activeMessages.length === 0 ? (
            <Empty description="请输入对话内容开始交流" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {activeMessages.map((item, idx) => (
                <Card key={`${item.role}-${idx}`} size="small" style={{ background: item.role === 'user' ? '#eff6ff' : '#f8fafc', minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: 10, alignItems: 'start', minWidth: 0, maxWidth: '100%' }}>
                    {item.role === 'user' ? (
                      <Avatar size={32} icon={<UserOutlined />} style={{ backgroundColor: '#ff6b6b' }} />
                    ) : (
                      <Avatar size={32} src={assistantAvatarSrc} />
                    )}
                    <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <Text strong>{item.role === 'user' ? '我' : '精准寻源智能体'}：</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{formatTime(item?.ts)}</Text>
                      </div>
                      {item.role === 'assistant' ? renderExecutionProcess(item) : null}
                      {item.role === 'assistant' ? renderAssistantResultCard(item) : null}
                      {item.role === 'assistant' ? renderArtifactCard(item) : null}
                      {item.role === 'assistant' ? renderAssistantExtraText(item) : renderMessageContent(item.content)}
                      {item.role === 'assistant' ? (() => {
                        const hasStructuredPayload = !!String(item?.rawAnswer || '').trim()
                          || !!(item?.intentDecision && typeof item.intentDecision === 'object')
                          || (Array.isArray(item?.planSteps) && item.planSteps.length > 0)
                          || (Array.isArray(item?.traces) && item.traces.length > 0)
                          || (Array.isArray(item?.artifacts) && item.artifacts.length > 0)
                        if (hasStructuredPayload) return null
                        return renderMessageContent(item?.content || '')
                      })() : null}
                    </div>
                  </div>
                </Card>
              ))}
            </Space>
          )}
        </div>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'end', flexShrink: 0, minWidth: 0, maxWidth: '100%', background: '#fff' }}>
          <Input.TextArea
            rows={3}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="请输入对话内容，换行请使用Shift+Enter。"
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault()
                void onSend()
              }
            }}
            style={{ minWidth: 0, maxWidth: '100%' }}
          />
          <Button type="primary" icon={<AppstoreOutlined />} loading={loading} onClick={onSend}>发送</Button>
        </div>
      </Card>

      <Modal
        title="选择模型"
        open={modelDialogOpen}
        onCancel={() => {
          setModelDialogOpen(false)
          setModelTestResult(null)
        }}
        onOk={() => {
          const next = String(modelDraft || '').trim()
          if (!next) {
            message.warning('请选择模型')
            return
          }
          setSelectedModelName(next)
          setModelDialogOpen(false)
          message.success(`已选择模型：${next}`)
        }}
        okText="确定"
        cancelText="取消"
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button
              loading={modelTestLoading}
              onClick={async () => {
                const providerName = String(modelProviderDraft || '').trim()
                const modelName = String(modelDraft || '').trim()
                if (!providerName) {
                  message.warning('请先选择模型供应商')
                  return
                }
                if (!modelName) {
                  message.warning('请先选择模型名称')
                  return
                }
                setModelTestLoading(true)
                setModelTestResult(null)
                try {
                  const result = await testModelProvider(providerName, { model: modelName })
                  const ok = Boolean(result?.ok ?? true)
                  const detail = String(result?.message || result?.detail || result?.status || '')
                  setModelTestResult({ ok, detail: detail || (ok ? '连接正常' : '连接失败') })
                  if (ok) message.success('测试连接成功')
                  else message.error(`测试连接失败：${detail || '未知原因'}`)
                } catch (error) {
                  const detail = String(error?.message || '请求失败')
                  setModelTestResult({ ok: false, detail })
                  message.error(`测试连接失败：${detail}`)
                } finally {
                  setModelTestLoading(false)
                }
              }}
            >
              测试连接
            </Button>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Text>模型供应商</Text>
            <Select
              showSearch
              value={modelProviderDraft || undefined}
              onChange={(v) => {
                const nextProvider = String(v || '')
                setModelProviderDraft(nextProvider)
                const provider = modelProviders.find((item) => item.providerName === nextProvider)
                const rows = Array.isArray(provider?.fetchedModels) && provider.fetchedModels.length > 0
                  ? provider.fetchedModels
                  : (Array.isArray(provider?.models) ? provider.models : [])
                const firstModel = rows.map((item) => String(item?.id || '').trim()).filter(Boolean)[0] || ''
                setModelDraft(firstModel)
              }}
              options={providerOptions}
              style={{ width: '100%', marginTop: 6 }}
              placeholder="请选择模型供应商"
              optionFilterProp="label"
            />
          </div>
          <div>
            <Text>模型名称</Text>
            <Select
              showSearch
              value={modelDraft || undefined}
              onChange={(v) => setModelDraft(String(v || ''))}
              options={modelNameOptions}
              style={{ width: '100%', marginTop: 6 }}
              placeholder="请选择模型名称"
              optionFilterProp="label"
            />
          </div>
          {modelTestResult ? (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', background: '#f8fafc' }}>
              <Space size={8} wrap>
                <Tag color={modelTestResult.ok ? 'green' : 'red'}>
                  {modelTestResult.ok ? '连接成功' : '连接失败'}
                </Tag>
                <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{String(modelTestResult.detail || '')}</Text>
              </Space>
            </div>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title="编辑提示词"
        open={promptDialogOpen}
        onCancel={() => setPromptDialogOpen(false)}
        onOk={() => {
          setSystemPrompt(String(promptDraft || '').trim())
          setSystemPromptEnabled(promptEnabledDraft)
          setSystemPromptPresetKey(String(promptPresetKeyDraft || 'default'))
          setPromptDialogOpen(false)
          message.success(`提示词已更新（${promptEnabledDraft ? '启用' : '未启用'}）`)
        }}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Text>模板</Text>
            <Space wrap style={{ marginTop: 8 }}>
              {PROMPT_PRESETS.map((item) => (
                <Button
                  key={item.key}
                  size="small"
                  type={promptPresetKeyDraft === item.key ? 'primary' : 'default'}
                  onClick={() => {
                    setPromptPresetKeyDraft(item.key)
                    setPromptDraft(item.prompt)
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </Space>
          </div>
          <div>
            <Text>启用提示词</Text>
            <div style={{ marginTop: 8 }}>
              <Checkbox checked={promptEnabledDraft} onChange={(e) => setPromptEnabledDraft(e.target.checked)}>
                启用
              </Checkbox>
            </div>
          </div>
          <Input.TextArea
            rows={8}
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder="输入系统提示词（多行）"
          />
        </Space>
      </Modal>

      <Modal
        title="智能体流程图"
        open={flowDialogOpen}
        onCancel={() => {
          if (document.fullscreenElement && sequenceDiagramWrapRef.current && document.fullscreenElement === sequenceDiagramWrapRef.current) {
            void document.exitFullscreen().catch(() => {})
          }
          setFlowDialogOpen(false)
          setFlowTabKey('logic')
        }}
        footer={null}
        width={760}
      >
        <Tabs
          activeKey={flowTabKey}
          onChange={setFlowTabKey}
          items={[
            {
              key: 'logic',
              label: '逻辑流程图',
              children: (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 10, fontSize: 12, color: '#9a3412' }}>
                    技术栈：React 19 + Ant Design 6（前端）｜Node.js + Express（后端）｜LangGraph（流程编排）｜LangChain（工具/模型调用）｜OpenAI兼容ChatCompletions（LLM）｜PostgreSQL（业务数据）｜本地RAG检索 + Web检索 + Reranker
                  </div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, fontSize: 12, color: '#475569' }}>
                    实时配置：工具 {flowConfigSummary.tools}；知识库 {flowConfigSummary.kb}；数据库 {flowConfigSummary.db}；模型 {flowConfigSummary.model}；提示词 {flowConfigSummary.prompt}；模板 {flowConfigSummary.template}
                  </div>
                  <div style={{ ...FLOW_NODE_STYLE, borderColor: '#bfdbfe', background: '#f8fafc' }}>1. 用户输入</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>2. LLM语义理解与任务规划</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>3. 检索子任务分解</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>4. 发起标准化工具请求</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>5. 工具执行(DB/RAG/WEB)</div>
                  <Space wrap size={8}>
                    <Tag color={activeFlowBranches.db ? 'blue' : 'default'}>数据库检索 {activeFlowBranches.db ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.kb ? 'blue' : 'default'}>知识库检索 {activeFlowBranches.kb ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.web ? 'blue' : 'default'}>互联网搜索 {activeFlowBranches.web ? '启用' : '未启用'}</Tag>
                  </Space>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>6. 返回标准化结果（dbHits/ragHits/webHits）</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>7. 证据整合与去重</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>8. 候选重排(Rerank)</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>9. 系统提示词 + 召回上下文交给LLM生成（LangGraph → LLM）</div>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>↓</div>
                  <div style={FLOW_NODE_STYLE}>10. 返回最终结果（流式更新后定稿）</div>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                    {flowLogicText}
                  </pre>
                </Space>
              ),
            },
            {
              key: 'sequence',
              label: '时序图',
              children: (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div style={{ border: '1px solid #dbeafe', background: '#eff6ff', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#1e40af' }}>编排层：LangGraph</div>
                    <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#166534' }}>能力层：DB / RAG / WEB / Reranker</div>
                    <div style={{ border: '1px solid #ddd6fe', background: '#f5f3ff', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#5b21b6' }}>模型层：LLM(${flowConfigSummary.model})</div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      size="small"
                      icon={sequenceFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                      onClick={async () => {
                        try {
                          if (!sequenceDiagramWrapRef.current) return
                          if (document.fullscreenElement) {
                            await document.exitFullscreen()
                            return
                          }
                          await sequenceDiagramWrapRef.current.requestFullscreen()
                        } catch (error) {
                          message.error('切换全屏失败')
                        }
                      }}
                    >
                      {sequenceFullscreen ? '退出全屏' : '图表全屏'}
                    </Button>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>全屏后可直接拖动小方块节点调整视图；退出全屏后自动恢复锁定。</div>
                  <div
                    ref={sequenceDiagramWrapRef}
                    className="precise-sequence-diagram"
                    style={{
                      height: sequenceFullscreen ? '100vh' : 340,
                      borderRadius: 12,
                      border: '1px solid #1f2937',
                      overflow: 'hidden',
                      background: '#2f3136',
                    }}
                  >
                    <CanvasWidget engine={sequenceDiagramEngine} className="precise-sequence-canvas" />
                  </div>
                  <Space wrap size={8}>
                    <Tag color={activeFlowBranches.db ? 'blue' : 'default'}>DB {activeFlowBranches.db ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.kb ? 'blue' : 'default'}>KB {activeFlowBranches.kb ? '启用' : '未启用'}</Tag>
                    <Tag color={activeFlowBranches.web ? 'blue' : 'default'}>WEB {activeFlowBranches.web ? '启用' : '未启用'}</Tag>
                    <Tag color="geekblue">LangGraph 编排</Tag>
                    <Tag color="purple">LangChain 调用层</Tag>
                  </Space>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                    {flowSequenceText}
                  </pre>
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="Rerank得分详情"
        open={rerankDetailOpen}
        onCancel={() => setRerankDetailOpen(false)}
        footer={[
          <Button key="close" onClick={() => setRerankDetailOpen(false)}>关闭</Button>,
        ]}
        width={760}
      >
        {rerankDetailRecord ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 13, color: '#0f172a' }}>
              企业名：<b>{rerankDetailRecord.name || '-'}</b>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Tag color="gold">Rerank {Number(rerankDetailRecord.rerankScore || 0).toFixed(2)}</Tag>
              <Tag color="green">融合分 {Number(rerankDetailRecord.fusedScore || 0).toFixed(2)}</Tag>
              <Tag color="blue">DB {Number(rerankDetailRecord.dbScore || 0).toFixed(2)}</Tag>
              <Tag color="purple">KB {Number(rerankDetailRecord.kbSupport || 0)}</Tag>
              <Tag color="cyan">WEB {Number(rerankDetailRecord.webSupport || 0)}</Tag>
            </div>
            <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>
              {`Rerank序号: ${Number(rerankDetailRecord.rerankIndex || 0) > 0 ? Number(rerankDetailRecord.rerankIndex) : '-'}
Rerank来源: ${rerankDetailRecord.rerankSource || '-'}
打分依据: ${rerankDetailRecord.rerankReason || '暂无（未返回详细解释）'}`}
            </div>
          </Space>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可展示的Rerank详情" />
        )}
      </Modal>

      <Modal
        title={`文件预览：${artifactPreviewTitle}`}
        open={artifactPreviewOpen}
        onCancel={() => setArtifactPreviewOpen(false)}
        footer={null}
        width={920}
      >
        {artifactPreviewUrl && /\.html?(\?|$)/i.test(artifactPreviewUrl) ? (
          <iframe
            src={artifactPreviewUrl}
            title={artifactPreviewTitle || 'preview'}
            style={{ width: '100%', height: 520, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
          />
        ) : (
          <Space direction="vertical" size={10}>
            <div>当前文件类型暂不支持内嵌预览，请点击下方链接打开。</div>
            <a href={artifactPreviewUrl} target="_blank" rel="noreferrer">{artifactPreviewUrl}</a>
          </Space>
        )}
      </Modal>
    </div>
  )
}
