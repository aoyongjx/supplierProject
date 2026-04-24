# Playwright Patterns

## Choose The Smallest Viable Mode

- Static page works with HTTP: do not use Playwright
- Public JS-rendered page: plain Playwright context
- Login once, reuse later: `storageState`
- Existing browser session is the only stable route: `launchPersistentContext`
- If the Codex app exposes `Playwright（浏览器自动化）`, prefer that browser automation path over ad hoc shell scraping for interactive sites

## Runtime Choice

- Use Python when `python -c "import playwright"` succeeds and the repo does not already depend on Node Playwright
- Use JavaScript when the project already has `playwright` in `package.json` or the user wants Node output integration
- Keep the extraction shape and selector strategy the same across runtimes

## Waiting Strategy

- Prefer `page.goto(..., { waitUntil: "domcontentloaded" })`
- Then wait for a target locator with `locator.waitFor()`
- Avoid large unconditional sleeps unless the page challenge has no stable DOM signal

## Extraction Strategy

- Extract the final rendered text with locators, not raw page HTML alone
- Normalize whitespace before saving text fields
- Return JSON in the conversation by default; only save files when the user asks
- Return a flat JSON object first; add nested objects only when the user needs them
- Prefer a two-phase crawl: current page summary first, detail pages second
- Merge detail fields into the existing result instead of replacing summary fields

## Debugging

- Save screenshot when selectors fail
- Save page HTML when the page shows a block or challenge
- Print a short preview of extracted text for fast sanity checking

## Session Reuse

- `storageState` is best when the user can manually complete login once
- Persistent context is best when the site ties trust to a real profile
- Do not commit cookies or personal profile paths into shared repositories unless the user explicitly wants machine-local config

## Escalation Order

1. Try the visible current page first
2. Follow detail links individually
3. If detail pages are blocked, pause aggressive automation
4. Switch to manual verification plus reused session state

Do not jump straight to persistent profile reuse when summary extraction already works.

## Default Delivery

- If the user gives one page and asks for content, return JSON directly instead of code
- If extraction fails because of auth or WAF, explain the blocker and suggest session reuse
- Only generate a reusable Playwright script when the user explicitly asks for a script or repeatable automation
