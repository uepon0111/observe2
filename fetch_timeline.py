import requests
import json
import time
import os
from datetime import datetime, timezone
from urllib.parse import quote

DATA_FILE = "timeline_data.jsonl"
META_FILE = "timeline_meta.json"
BASE_URL = "https://minorisuzuki.api.app.c-rayon.com/api/public"
REQUEST_TIMEOUT = 30

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (timeline-fetcher)"
})

def get_post_ids(from_date):
    encoded_date = quote(from_date)
    url = f"{BASE_URL}/tl_posts/ids?from={encoded_date}"
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json().get("data", [])

def get_post_detail(post_id):
    url = f"{BASE_URL}/tl_posts/{post_id}"
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json()

def write_metadata(last_updated_at, post_count):
    payload = {
        "lastUpdatedAt": last_updated_at,
        "postCount": post_count,
    }
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def main():
    fetched_ids = set()
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                fetched_ids.add(data["id"])

    current_from = datetime.now(timezone.utc).astimezone().isoformat()

    print("データ取得を開始します。")

    while True:
        print(f"ID一覧を取得中 (from: {current_from})")
        post_ids_data = get_post_ids(current_from)

        if not post_ids_data:
            print("これ以上古い投稿はありません。")
            break

        oldest_date = None
        new_post_found_in_page = False

        for item in post_ids_data:
            post_id = item["id"]
            published_at = item["attributes"]["publishedAt"]

            if oldest_date is None or published_at < oldest_date:
                oldest_date = published_at

            if post_id in fetched_ids:
                continue

            new_post_found_in_page = True
            print(f"投稿詳細を取得中: {post_id}")
            detail = get_post_detail(post_id)

            post_data = detail.get("data", {})
            included = detail.get("included", [])

            text = post_data.get("attributes", {}).get("text", "")
            images = []

            for inc in included:
                if inc.get("type") == "photo":
                    img_url = inc.get("attributes", {}).get("urls", {}).get("original")
                    if img_url:
                        images.append(img_url)

            save_data = {
                "id": post_id,
                "publishedAt": published_at,
                "text": text,
                "images": images
            }

            with open(DATA_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(save_data, ensure_ascii=False) + "\n")

            fetched_ids.add(post_id)
            time.sleep(1)

        if not new_post_found_in_page:
            print("新規投稿の取得が全て完了しました。")
            break

        current_from = oldest_date
        time.sleep(1)

    write_metadata(datetime.now(timezone.utc).astimezone().isoformat(), len(fetched_ids))

if __name__ == "__main__":
    main()
