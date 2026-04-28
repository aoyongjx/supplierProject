(() => {
  const toAbs = (h) => { try { return new URL(h, location.href).toString() } catch { return '' } }
  const links = Array.from(document.querySelectorAll('a[href]')).map((a) => ({
    text: (a.textContent || '').replace(/\s+/g, ' ').trim(),
    href: a.getAttribute('href') || '',
    abs: toAbs(a.getAttribute('href') || ''),
    cls: a.className || '',
    id: a.id || '',
  }))
  const candidates = links.filter((x) => {
    const t = x.text
    const h = x.href
    return /^(\d{1,3}|上一页|下一页|首页|尾页|上页|下页|<<|>>|<|>)$/.test(t)
      || /index-\d+\.html/i.test(h)
      || /(?:^|[?&])(page|p|pg|pn)=\d+/i.test(h)
      || /pager|page|next|prev/i.test(x.cls)
  })
  const html = document.documentElement?.outerHTML || ''
  const scriptHits = []
  const pats = [/index-\d+\.html/gi, /goPage\(\d+\)/gi, /page\s*=\s*\d+/gi, /c-\d+\.html\?page=\d+/gi]
  for (const p of pats) {
    const m = html.match(p)
    if (m?.length) scriptHits.push({ pattern: String(p), sample: m.slice(0, 12), count: m.length })
  }
  return JSON.stringify({
    url: location.href,
    title: document.title,
    candidates: candidates.slice(0, 200),
    candidateCount: candidates.length,
    scriptHits,
  })
})()
