#!/usr/bin/env python3
"""Google Flow 中继（winetoken Flow 渠道专用）——协议转接层。

背景（2026-11-26）：flow2api（东京本机 Docker，127.0.0.1:8000）只提供
OpenAI chat-completions 形态的生成接口（图/视频都走流式对话补全），站里
的 New API 渠道对不上形。本中继做两件转接：

1. 图片：POST /v1/images/generations（OpenAI 形态）
   → flow2api /v1/chat/completions（model 按 size/quality 解析到
   gemini-3.1-flash-image-<比例>[-2k|-4k] 变体），收流拼出图片 URL，
   回 OpenAI 图片响应 {data:[{url}]}。
2. 视频：hailuo 任务插件的 legacy /v1 形态（与 MiniMax 渠道同插件）：
   POST /v1/video_generation → 本地建任务，后台线程打 flow2api 的
   omni-1.2-flash-<秒>s-<方向> 变体生成，完成后存下 flow-content 直链；
   GET /v1/query/video_generation?task_id= 报状态（成功带 file_id）；
   GET /v1/files/retrieve?file_id= 回 {file:{download_url}}（签名直链，
   宿主无凭据抓取，与 MiniMax v1 同路）。

鉴权：入站 bearer 必须等于渠道 key（/opt/flow-relay/key.txt）；
调 flow2api 用其网关 api_key（/opt/flow-relay/flow_api_key.txt）。
任务状态落盘 tasks.json，重启后未完成任务标记失败（上游流已断）。
"""

from __future__ import annotations

import hmac
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

UPSTREAM = os.environ.get("FLOW_UPSTREAM", "http://127.0.0.1:8000").rstrip("/")
KEY_FILE = os.environ.get("FLOW_RELAY_KEY_FILE", "/opt/flow-relay/key.txt")
API_KEY_FILE = os.environ.get("FLOW_RELAY_API_KEY_FILE", "/opt/flow-relay/flow_api_key.txt")
STATE_FILE = os.environ.get("FLOW_RELAY_STATE", "/opt/flow-relay/tasks.json")
PORT = int(os.environ.get("FLOW_RELAY_PORT", "8899"))
BIND = os.environ.get("FLOW_RELAY_BIND", "172.17.0.1")

IMAGE_MODEL_ALIASES = {"nano-banana-2.1", "gemini-3.1-flash-image"}
VIDEO_MODEL = "omni-1.2-flash"
VIDEO_MIN_SECONDS = 3
VIDEO_MAX_SECONDS = 15

ASPECTS = {
    "landscape": 16 / 9,
    "portrait": 9 / 16,
    "square": 1.0,
    "four-three": 4 / 3,
    "three-four": 3 / 4,
}
ASPECT_NAMES = {
    "16:9": "landscape",
    "9:16": "portrait",
    "1:1": "square",
    "4:3": "four-three",
    "3:4": "three-four",
}
URL_RE = re.compile(r"https?://[^\s\)\]\"'<>]+")
_lock = threading.Lock()
_tasks: dict = {}


def load_secret(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read().strip()


def save_tasks() -> None:
    try:
        tmp = STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_tasks, fh, ensure_ascii=False)
        os.replace(tmp, STATE_FILE)
    except OSError:
        pass


def load_tasks() -> None:
    global _tasks
    try:
        with open(STATE_FILE, encoding="utf-8") as fh:
            _tasks = json.load(fh)
        for task in _tasks.values():
            if task.get("status") == "Processing":
                task["status"] = "Fail"
                task["error"] = "relay restarted during generation"
    except (OSError, ValueError):
        _tasks = {}


def flow_chat(model: str, content, timeout: float) -> str:
    """打 flow2api 流式对话补全，返回拼接后的完整文本（媒体直链在其中）。"""
    body = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "stream": True,
    }
    req = urllib.request.Request(
        UPSTREAM + "/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + load_secret(API_KEY_FILE),
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    parts: list[str] = []
    raw: list[str] = []
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for line in resp:
            text = line.decode("utf-8", "replace").strip()
            if not text.startswith("data:"):
                continue
            payload = text[5:].strip()
            if payload == "[DONE]":
                break
            raw.append(payload)
            try:
                chunk = json.loads(payload)
            except ValueError:
                continue
            for choice in chunk.get("choices") or []:
                delta = choice.get("delta") or choice.get("message") or {}
                piece = delta.get("content")
                if isinstance(piece, str):
                    parts.append(piece)
    content_text = "".join(parts)
    if not content_text:
        content_text = "\n".join(raw)
    return content_text


def extract_media_url(text: str, video: bool = False) -> str:
    urls = URL_RE.findall(text or "")
    cleaned = [u.rstrip(".,") for u in urls]
    if video:
        for u in cleaned:
            if ".mp4" in u:
                return u
    for u in cleaned:
        if "flow-content" in u:
            return u
    for u in cleaned:
        if any(ext in u for ext in (".jpg", ".jpeg", ".png", ".webp", ".mp4")):
            return u
    return cleaned[0] if cleaned else ""


def resolve_aspect(body: dict) -> str:
    for key in ("aspect_ratio", "ratio", "size"):
        value = str(body.get(key) or "").strip()
        if not value:
            continue
        low = value.lower()
        if low in ASPECT_NAMES:
            return ASPECT_NAMES[low]
        if low in ASPECTS:
            return low
        m = re.match(r"^(\d{2,5})\s*[xX]\s*(\d{2,5})$", value)
        if m:
            width, height = int(m.group(1)), int(m.group(2))
            if (width, height) == (1344, 1008):
                return "four-three"
            if (width, height) == (1008, 1344):
                return "three-four"
            ratio = width / max(height, 1)
            return min(ASPECTS.items(), key=lambda kv: abs(kv[1] - ratio))[0]
    return "landscape"


def resolve_tier(body: dict) -> str:
    quality = str(body.get("quality") or "").strip().lower()
    if quality in ("high", "hd", "ultra"):
        return "4k"
    if quality == "medium":
        return "2k"
    for key in ("image_size", "resolution", "size"):
        value = str(body.get(key) or "").strip().lower()
        if "4k" in value:
            return "4k"
        if "2k" in value:
            return "2k"
    return ""


def message_content(prompt: str, images: list):
    if not images:
        return prompt
    parts = [{"type": "text", "text": prompt}]
    for img in images:
        parts.append({"type": "image_url", "image_url": {"url": img}})
    return parts


def collect_images(body: dict) -> list:
    out: list[str] = []
    for key in ("image", "input_reference", "first_frame_image"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            out.append(value.strip())
    for key in ("images", "input_references"):
        value = body.get(key)
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.strip():
                    out.append(item.strip())
                elif isinstance(item, dict) and item.get("url"):
                    out.append(str(item["url"]))
    return out


def run_video_task(task_id: str) -> None:
    with _lock:
        task = _tasks.get(task_id) or {}
    try:
        text = flow_chat(task["variant"], task["content"], timeout=1500.0)
        url = extract_media_url(text, video=True)
        with _lock:
            if not url:
                task["status"] = "Fail"
                task["error"] = "no video url in flow response"
            else:
                task["status"] = "Success"
                task["url"] = url
            save_tasks()
    except Exception as exc:  # 上游错误原文留档，查询时回给插件当失败原因
        with _lock:
            task["status"] = "Fail"
            task["error"] = str(exc)[:300]
            save_tasks()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # 静默访问日志
        pass

    def _send(self, code: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        try:
            key = load_secret(KEY_FILE)
        except OSError:
            return False
        given = (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        return hmac.compare_digest(given, key)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self._send(200, {"ok": True})
        if not self._authorized():
            return self._send(401, {"error": {"message": "unauthorized", "type": "auth"}})
        query = parse_qs(parsed.query)
        if parsed.path == "/v1/query/video_generation":
            task_id = (query.get("task_id") or [""])[0]
            with _lock:
                task = _tasks.get(task_id)
            if not task:
                return self._send(200, {
                    "base_resp": {"status_code": 1004, "status_msg": "task not found"},
                    "status": "Fail",
                })
            payload = {
                "base_resp": {"status_code": 0, "status_msg": "success"},
                "task_id": task_id,
                "status": task["status"],
            }
            if task["status"] == "Success":
                payload["file_id"] = task_id
            if task["status"] == "Fail" and task.get("error"):
                payload["base_resp"] = {"status_code": 1005, "status_msg": task["error"]}
            return self._send(200, payload)
        if parsed.path == "/v1/files/retrieve":
            file_id = (query.get("file_id") or [""])[0]
            with _lock:
                task = _tasks.get(file_id)
            if task and task["status"] == "Success" and task.get("url"):
                return self._send(200, {
                    "base_resp": {"status_code": 0, "status_msg": "success"},
                    "file": {"download_url": task["url"]},
                })
            return self._send(200, {
                "base_resp": {"status_code": 1004, "status_msg": "file not ready"},
            })
        return self._send(404, {"error": {"message": "not found", "type": "not_found"}})

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self._authorized():
            return self._send(401, {"error": {"message": "unauthorized", "type": "auth"}})
        body = self._read_body()
        if parsed.path == "/v1/images/generations":
            return self._images(body)
        if parsed.path == "/v1/video_generation":
            return self._video_create(body)
        return self._send(404, {"error": {"message": "not found", "type": "not_found"}})

    def _images(self, body: dict):
        model = str(body.get("model") or "")
        if model not in IMAGE_MODEL_ALIASES and not model.startswith("gemini-3.1-flash-image"):
            return self._send(400, {"error": {"message": f"unsupported image model: {model}", "type": "invalid_request"}})
        prompt = str(body.get("prompt") or "").strip()
        images = collect_images(body)
        if not prompt and not images:
            return self._send(400, {"error": {"message": "prompt is required", "type": "invalid_request"}})
        aspect = resolve_aspect(body)
        tier = resolve_tier(body)
        variant = f"gemini-3.1-flash-image-{aspect}" + (f"-{tier}" if tier else "")
        try:
            text = flow_chat(variant, message_content(prompt, images), timeout=600.0)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            return self._send(502, {"error": {"message": f"flow upstream {exc.code}: {detail}", "type": "upstream"}})
        except Exception as exc:
            return self._send(502, {"error": {"message": f"flow upstream error: {exc}", "type": "upstream"}})
        url = extract_media_url(text)
        if not url:
            return self._send(502, {"error": {"message": "no image url in flow response", "type": "upstream"}})
        return self._send(200, {"created": int(time.time()), "data": [{"url": url}]})

    def _video_create(self, body: dict):
        def fail(msg: str):
            return self._send(200, {"base_resp": {"status_code": 1001, "status_msg": msg}})

        model = str(body.get("model") or "")
        if model != VIDEO_MODEL:
            return fail(f"unsupported video model: {model}")
        raw_duration = body.get("duration")
        try:
            duration = int(float(raw_duration)) if raw_duration is not None else 6
        except (TypeError, ValueError):
            return fail("duration must be an integer")
        if duration < VIDEO_MIN_SECONDS or duration > VIDEO_MAX_SECONDS:
            return fail(f"duration must be an integer between {VIDEO_MIN_SECONDS} and {VIDEO_MAX_SECONDS}")
        prompt = str(body.get("prompt") or "").strip()
        refs: list[str] = []
        seen: set[str] = set()

        def add_ref(val) -> None:
            s = ""
            if isinstance(val, str):
                s = val.strip()
            elif isinstance(val, dict):
                img_raw = val.get("image_url")
                nested = (
                    img_raw.get("url")
                    if isinstance(img_raw, dict)
                    else (img_raw if isinstance(img_raw, str) else "")
                )
                raw_url = val.get("url")
                candidate = raw_url if isinstance(raw_url, str) and raw_url.strip() else nested
                if isinstance(candidate, str):
                    s = candidate.strip()
            if s and s not in seen:
                seen.add(s)
                refs.append(s)

        for key in ("first_frame_image", "last_frame_image"):
            add_ref(body.get(key))
        extra_refs = body.get("reference_images")
        if isinstance(extra_refs, list):
            for item in extra_refs:
                add_ref(item)

        refs = refs[:3]
        if not prompt and not refs:
            return fail("prompt is required")
        size = str(body.get("size") or "").lower()
        portrait_sizes = ("720x1280", "1080x1920", "1440x2560")
        orientation = "portrait" if (
            "portrait" in size or "9:16" in size or any(dim in size for dim in portrait_sizes)
        ) else "landscape"
        variant = f"omni-1.2-flash-{duration}s-{orientation}"
        task_id = "flow_" + uuid.uuid4().hex[:24]
        task = {
            "id": task_id,
            "status": "Processing",
            "created_at": int(time.time()),
            "variant": variant,
            "content": message_content(prompt, refs),
            "url": "",
            "error": "",
        }
        with _lock:
            _tasks[task_id] = task
            save_tasks()
        threading.Thread(target=run_video_task, args=(task_id,), daemon=True).start()
        return self._send(200, {
            "base_resp": {"status_code": 0, "status_msg": "success"},
            "task_id": task_id,
        })


def main() -> None:
    load_tasks()
    server = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"flow-relay listening on {BIND}:{PORT}, upstream {UPSTREAM}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
