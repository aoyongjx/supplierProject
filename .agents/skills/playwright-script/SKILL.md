---
name: playwright-script
description: Use Playwright to open a webpage and return structured JSON directly. Trigger this skill when a user gives a URL and wants extracted fields, rendered page content, or browser-backed data from dynamic, login-gated, or anti-bot-sensitive sites that simple HTTP scraping cannot handle.
---

# Playwright Script

## Overview

Use this skill when the user gives a webpage and wants a JSON result back in the conversation. It is the right default for dynamic pages, sites behind WAF or login, and flows that need a real browser session before extraction works.

Default to direct extraction first. Only generate a reusable script when the user explicitly asks for one, or when repeated runs, persistent login reuse, or handoff to another workflow make a script clearly useful.

When browser-backed extraction is needed, prefer the available `Playwright（浏览器自动化）` capability in the Codex app before falling back to generic HTTP scraping.

## When To Use

- Dynamic pages where `requests`, `curl`, or `Invoke-WebRequest` miss the real content
- Sites that require login, captcha completion, or manual verification before reuse of the session
- Browser workflows such as clicking tabs, waiting for rendered data, pagination, downloads, or screenshots
- One-off extraction tasks where the user mainly wants a JSON payload, not source code

Do not default to this skill for plain static HTML fetches that can be handled with simpler HTTP tools.

## Workflow

1. Define the goal and output.
   Verify: list the URL, the target fields, and the JSON shape to return.
2. Check whether simple HTTP scraping is enough.
   Verify: if the site serves the needed content without a browser, do not use Playwright.
3. First extract the current page summary.
   Verify: capture all fields already visible on the current page before following any detail links.
4. Then follow detail links one by one to enrich the result.
   Verify: merge detail-page fields back into the same JSON object without losing summary data.
5. Escalate session handling only when detail pages are blocked.
   Verify: if detail pages hit auth or WAF, switch to user-assisted verification plus session reuse with `storageState` or `launchPersistentContext`.
6. Add only site-specific hardening that proved necessary.
   Verify: only after failure should you add manual wait steps, custom headers, non-headless mode, or profile reuse.
7. Generate a script only if needed.
   Verify: produce code only when the user asked for automation or repeated execution.

## Defaults

- Runtime: prefer the installed runtime first; in mixed environments, Python is often easier because `playwright` may be available without a local Node package
- Tool preference: prefer `Playwright（浏览器自动化）` when the app exposes it, especially for dynamic pages, anti-bot-sensitive sites, login flows, or click-through detail pages
- Output: prefer JSON directly in the conversation first, then file output or scripts if the user asks
- Navigation: use `wait_until: "domcontentloaded"` plus explicit selector waits instead of long blind sleeps
- Crawl order: current page visible summary first, linked detail pages second, session escalation last
- Debugging: add screenshots or saved HTML only when the page is unstable or blocked

## Crawl Strategy

Use this default extraction order unless the user asks for something else:

1. Grab all visible summary data from the current page.
2. Visit relevant detail links individually and merge additional fields.
3. If those detail pages are blocked, stop blind retries and switch to manual verification plus reused session state.

This keeps extraction cheap and stable while still allowing deeper coverage when the site permits it.

## Session Patterns

### 1. Plain browser context

Use for public dynamic pages.

### 2. Saved `storageState`

Use when the user can manually log in once and the script should reuse cookies later.

### 3. Persistent browser profile

Use when the site is sensitive to fresh contexts or the user already has a working Chrome/Edge profile. Be careful not to hardcode personal paths unless the user asked for that exact machine setup.

## Anti-Bot Guidance

- Treat anti-bot pages as a signal to slow down and switch to browser-backed access, not as a reason to keep piling on fake headers.
- Prefer user-assisted verification plus session reuse over brittle stealth tricks.
- Keep request rate low and scope narrow.
- Only extract what the user asked for.

## Output Contract

When extracting data with this skill, aim for this shape unless the task needs something else:

```json
{
  "url": "https://example.com/item",
  "fetchedAt": "2026-04-24T14:00:00.000Z",
  "title": "Example",
  "fields": {
    "companyName": "Example Co."
  }
}
```

## Resources

- Script templates: read [scripts/playwright_extract_template.py](scripts/playwright_extract_template.py) first, and use [scripts/playwright_extract_template.mjs](scripts/playwright_extract_template.mjs) only when the user asks for reusable code or the repo already has a Node Playwright dependency
- Reference notes: read [references/patterns.md](references/patterns.md) when the task needs session reuse, `storageState`, or persistent profile decisions
