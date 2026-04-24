import { BarChartOutlined, DollarOutlined, FundOutlined, StockOutlined } from '@ant-design/icons'
import { Alert, Card, Col, Empty, Row, Segmented, Select, Space, Spin, Statistic, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { CandlestickSeries, HistogramSeries, LineSeries, createChart } from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchStockKline, fetchStockOverview } from '../api/stocksApi'

const { Title, Text } = Typography

const cycleOptions = [
  { label: '日线', value: '1d' },
  { label: '周线', value: '1w' },
  { label: '30日线', value: '30d' },
]

const rangeOptions = [
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: '3Y', value: '3y' },
  { label: '5Y', value: '5y' },
  { label: 'MAX', value: 'max' },
]

function calcFromDate(range, anchorInput) {
  const anchor = dayjs(anchorInput || dayjs())
  if (range === '6m') return anchor.subtract(6, 'month').format('YYYY-MM-DD')
  if (range === '1y') return anchor.subtract(1, 'year').format('YYYY-MM-DD')
  if (range === '3y') return anchor.subtract(3, 'year').format('YYYY-MM-DD')
  if (range === '5y') return anchor.subtract(5, 'year').format('YYYY-MM-DD')
  return ''
}

function buildMa(bars, period) {
  const result = []
  for (let i = 0; i < bars.length; i += 1) {
    if (i < period - 1) continue
    let sum = 0
    for (let j = i - period + 1; j <= i; j += 1) sum += Number(bars[j].close)
    result.push({ time: Number(bars[i].time), value: Number((sum / period).toFixed(4)) })
  }
  return result
}

function StockKlinePage() {
  const chartRef = useRef(null)
  const chartApiRef = useRef(null)
  const [overview, setOverview] = useState([])
  const [symbol, setSymbol] = useState('')
  const [cycle, setCycle] = useState('1d')
  const [range, setRange] = useState('1y')
  const [bars, setBars] = useState([])
  const [loading, setLoading] = useState(false)
  const [chartError, setChartError] = useState('')

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const list = await fetchStockOverview(800)
        setOverview(list)
        if (!symbol && list.length > 0) setSymbol(list[0].symbol)
      } catch (error) {
        message.error(error.message || '股票概览加载失败')
      }
    }
    loadOverview()
  }, [symbol])

  useEffect(() => {
    if (!symbol) return
    const loadKline = async () => {
      try {
        setLoading(true)
        const selected = overview.find((item) => item.symbol === symbol)
        const anchorDate = selected?.lastTradeDate || dayjs().format('YYYY-MM-DD')
        const from = calcFromDate(range, anchorDate)
        const data = await fetchStockKline({
          symbol,
          cycle,
          from,
          to: anchorDate,
        })
        setBars(data?.bars || [])
      } catch (error) {
        message.error(error.message || 'K线数据加载失败')
        setBars([])
      } finally {
        setLoading(false)
      }
    }
    loadKline()
  }, [symbol, cycle, range, overview])

  useEffect(() => {
    if (chartApiRef.current) {
      try {
        chartApiRef.current.remove()
      } catch (_error) {
        // ignore already-disposed chart instances
      }
      chartApiRef.current = null
    }
    if (!chartRef.current || bars.length === 0) return

    let chart
    let onResize
    try {
      setChartError('')
      chart = createChart(chartRef.current, {
        layout: {
          background: { color: '#ffffff' },
          textColor: '#3b4860',
        },
        grid: {
          vertLines: { color: '#edf2ff' },
          horzLines: { color: '#edf2ff' },
        },
        width: chartRef.current.clientWidth,
        height: 460,
        rightPriceScale: { borderColor: '#d9e1f2' },
        timeScale: { borderColor: '#d9e1f2', timeVisible: true, secondsVisible: false },
        crosshair: { mode: 0 },
      })

      const candle =
        typeof chart.addSeries === 'function'
          ? chart.addSeries(CandlestickSeries, {
              upColor: '#16a34a',
              downColor: '#dc2626',
              borderVisible: false,
              wickUpColor: '#16a34a',
              wickDownColor: '#dc2626',
            })
          : chart.addCandlestickSeries({
              upColor: '#16a34a',
              downColor: '#dc2626',
              borderVisible: false,
              wickUpColor: '#16a34a',
              wickDownColor: '#dc2626',
            })

      candle.setData(
        bars.map((item) => ({
          time: Number(item.time),
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
        })),
      )

      const volumeSeries =
        typeof chart.addSeries === 'function'
          ? chart.addSeries(HistogramSeries, {
              color: '#93c5fd',
              priceScaleId: '',
              priceFormat: { type: 'volume' },
            })
          : chart.addHistogramSeries({
              color: '#93c5fd',
              priceScaleId: '',
              priceFormat: { type: 'volume' },
            })

      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.75, bottom: 0 },
      })
      volumeSeries.setData(
        bars.map((item) => ({
          time: Number(item.time),
          value: Number(item.volume),
          color: Number(item.close) >= Number(item.open) ? '#93c5fd' : '#fca5a5',
        })),
      )

      const ma5 =
        typeof chart.addSeries === 'function'
          ? chart.addSeries(LineSeries, { color: '#2563eb', lineWidth: 2, priceLineVisible: false })
          : chart.addLineSeries({ color: '#2563eb', lineWidth: 2, priceLineVisible: false })
      const ma10 =
        typeof chart.addSeries === 'function'
          ? chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2, priceLineVisible: false })
          : chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, priceLineVisible: false })
      const ma20 =
        typeof chart.addSeries === 'function'
          ? chart.addSeries(LineSeries, { color: '#7c3aed', lineWidth: 2, priceLineVisible: false })
          : chart.addLineSeries({ color: '#7c3aed', lineWidth: 2, priceLineVisible: false })

      ma5.setData(buildMa(bars, 5))
      ma10.setData(buildMa(bars, 10))
      ma20.setData(buildMa(bars, 20))

      chart.timeScale().fitContent()
      onResize = () => chart.applyOptions({ width: chartRef.current?.clientWidth || 900 })
      window.addEventListener('resize', onResize)
      chartApiRef.current = chart

      return () => {
        if (onResize) window.removeEventListener('resize', onResize)
        if (chartApiRef.current === chart) chartApiRef.current = null
        try {
          chart.remove()
        } catch (_error) {
          // ignore already-disposed chart instances
        }
      }
    } catch (error) {
      setChartError(error.message || '图表渲染失败')
      if (chart) chart.remove()
    }
  }, [bars])

  const symbolOptions = useMemo(
    () =>
      overview.map((item) => ({
        label: `${item.symbol} · ${item.latestClose ?? '-'}`,
        value: item.symbol,
      })),
    [overview],
  )

  const currentOverview = useMemo(() => overview.find((item) => item.symbol === symbol), [overview, symbol])

  return (
    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
      <Card className="stock-hero-card app-elevated-card">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={12}>
            <Space>
              <span className="title-icon stock">
                <FundOutlined />
              </span>
              <Title level={3} style={{ margin: 0 }}>
                股票 K 线导航
              </Title>
            </Space>
            <Text type="secondary">基于 SeaboxTS/TimescaleDB 聚合函数生成日线、周线与30日线。</Text>
          </Col>
          <Col xs={24} md={12}>
            <Space wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Select
                showSearch
                style={{ minWidth: 220 }}
                placeholder="选择股票"
                options={symbolOptions}
                value={symbol || undefined}
                onChange={setSymbol}
                notFoundContent="暂无股票，请检查后端连接"
              />
              <Segmented options={cycleOptions} value={cycle} onChange={setCycle} />
              <Segmented options={rangeOptions} value={range} onChange={setRange} />
            </Space>
          </Col>
        </Row>
      </Card>

      {!loading && overview.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="未加载到股票概览"
          description="请确认后端服务已启动，且当前登录态具备访问 /api/stocks/overview 权限。"
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card className="kpi-card app-elevated-card">
            <Statistic title="当前股票" value={symbol || '-'} prefix={<StockOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="kpi-card app-elevated-card">
            <Statistic title="最新收盘价" value={currentOverview?.latestClose || 0} precision={4} prefix={<DollarOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="kpi-card app-elevated-card">
            <Statistic title="样本条数" value={currentOverview?.totalBars || 0} prefix={<BarChartOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card bodyStyle={{ padding: 12 }}>
        {chartError ? (
          <Alert type="error" showIcon message="图表渲染失败" description={chartError} />
        ) : null}
        {loading ? (
          <div style={{ minHeight: 460, display: 'grid', placeItems: 'center' }}>
            <Spin />
          </div>
        ) : bars.length === 0 ? (
          <Empty description="当前条件下无K线数据" />
        ) : (
          <div ref={chartRef} style={{ width: '100%', minHeight: 460 }} />
        )}
      </Card>
    </Space>
  )
}

export default StockKlinePage
