from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


def clean_text(value: str) -> str:
    return " ".join(value.split())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--wait-for", dest="wait_for", default="body")
    parser.add_argument("--output")
    parser.add_argument("--screenshot")
    parser.add_argument("--storage-state", dest="storage_state")
    parser.add_argument("--user-data-dir", dest="user_data_dir")
    parser.add_argument("--headed", action="store_true")
    return parser.parse_args()


def write_json(output_path: str | None, payload: dict) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if not output_path:
        print(text)
        return

    path = Path(output_path)
    path.write_text(f"{text}\n", encoding="utf-8")
    print(f"saved {path}")


def main() -> None:
    args = parse_args()

    with sync_playwright() as playwright:
        if args.user_data_dir:
            context = playwright.chromium.launch_persistent_context(
                args.user_data_dir,
                channel="msedge",
                headless=not args.headed,
                viewport={"width": 1440, "height": 900},
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
            )
        else:
            browser = playwright.chromium.launch(
                channel="msedge",
                headless=not args.headed,
            )
            context = browser.new_context(
                storage_state=args.storage_state,
                viewport={"width": 1440, "height": 900},
                locale="zh-CN",
                timezone_id="Asia/Shanghai",
            )

        page = context.pages[0] if context.pages else context.new_page()

        try:
            page.goto(args.url, wait_until="domcontentloaded", timeout=90000)
            page.locator(args.wait_for).wait_for(timeout=30000)

            body_text = clean_text(page.locator("body").inner_text())
            result = {
                "url": page.url,
                "fetchedAt": datetime.now(timezone.utc).isoformat(),
                "title": page.title(),
                "fields": {
                    "bodyPreview": body_text[:1000],
                },
            }

            if args.screenshot:
                page.screenshot(path=args.screenshot, full_page=True)

            write_json(args.output, result)
        finally:
            context.close()


if __name__ == "__main__":
    main()
