import requests
import json
import time
import os
from datetime import datetime, timezone, timedelta
from urllib.parse import quote

# 保存先のファイル名
DATA_FILE = "timeline_data.jsonl"
# 最終取得日時を記録するファイル（フロントエンドの表示用）
LAST_UPDATED_FILE = "last_updated.json"
# 表示用に日本時間で記録する
JST = timezone(timedelta(hours=9))

def get_post_ids(from_date):
    # APIの仕様上 + がスペースに変換されないようにURLエンコードが必要な場合があります
    encoded_date = quote(from_date)
    url = f"https://minorisuzuki.api.app.c-rayon.com/api/public/tl_posts/ids?from={encoded_date}"
    response = requests.get(url)
    response.raise_for_status()
    return response.json().get("data", [])

def get_post_detail(post_id):
    url = f"https://minorisuzuki.api.app.c-rayon.com/api/public/tl_posts/{post_id}"
    response = requests.get(url)
    response.raise_for_status()
    return response.json()

def write_last_updated():
    # フロントエンド（index.html）が「最終取得更新日時」を表示するためのファイル
    payload = {"last_updated": datetime.now(JST).isoformat()}
    with open(LAST_UPDATED_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

def main():
    # 既に取得したIDを読み込み、重複取得を防ぐ
    fetched_ids = set()
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            for line in f:
                data = json.loads(line.strip())
                fetched_ids.add(data["id"])

    # 取得開始の基準日（最初は現在時刻から遡る）
    # 例: "2026-03-11T00:00:00.000+09:00"
    current_from = datetime.now(timezone.utc).astimezone().isoformat()
    
    print(f"データ取得を開始します。")

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
            
            # そのページ内で最も古い日付を記録（次のページのfromに使うため）
            if oldest_date is None or published_at < oldest_date:
                oldest_date = published_at
                
            if post_id in fetched_ids:
                continue # 既に保存済みの投稿はスキップ
            
            new_post_found_in_page = True
            print(f"投稿詳細を取得中: {post_id}")
            detail = get_post_detail(post_id)
            
            # 本文と画像URLの抽出
            post_data = detail.get("data", {})
            included = detail.get("included", [])
            
            text = post_data.get("attributes", {}).get("text", "")
            images = []
            
            for inc in included:
                if inc.get("type") == "photo":
                    img_url = inc.get("attributes", {}).get("urls", {}).get("original")
                    if img_url:
                        images.append(img_url)
                        
            # 保存用データの作成
            save_data = {
                "id": post_id,
                "publishedAt": published_at,
                "text": text,
                "images": images
            }
            
            # ファイルに追記保存
            with open(DATA_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(save_data, ensure_ascii=False) + "\n")
                
            fetched_ids.add(post_id)
            time.sleep(1) # APIサーバーに負荷をかけないよう1秒待機（重要）
            
        # このページの10件が全て「取得済み」だった場合、過去の分は全て取得できていると判断して終了
        if not new_post_found_in_page:
            print("新規投稿の取得が全て完了しました。")
            break
            
        # 最も古い投稿の日時を次の基準日としてセットし、次の10件（過去）へ
        current_from = oldest_date
        time.sleep(1)

    # ここまで例外なく到達できれば取得処理は正常終了。最終取得日時を記録する。
    write_last_updated()

if __name__ == "__main__":
    main()
