#!/usr/bin/env python3
"""flow-relay 视频多图参考转接层本地离线验证脚本 (无真实网络/上游调用)."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RELAY_DIR = os.path.dirname(SCRIPT_DIR)
if RELAY_DIR not in sys.path:
    sys.path.insert(0, RELAY_DIR)

import relay  # noqa: E402


class FlowRelayVideoMultiRefTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.key_file = os.path.join(self.tmpdir.name, "key.txt")
        self.api_key_file = os.path.join(self.tmpdir.name, "flow_api_key.txt")
        self.state_file = os.path.join(self.tmpdir.name, "tasks.json")
        with open(self.key_file, "w", encoding="utf-8") as fh:
            fh.write("test-relay-key")
        with open(self.api_key_file, "w", encoding="utf-8") as fh:
            fh.write("test-flow-api-key")

        self._orig_key = relay.KEY_FILE
        self._orig_api_key = relay.API_KEY_FILE
        self._orig_state = relay.STATE_FILE
        self._orig_flow_chat = relay.flow_chat

        relay.KEY_FILE = self.key_file
        relay.API_KEY_FILE = self.api_key_file
        relay.STATE_FILE = self.state_file
        relay._tasks.clear()

        self.captured_calls = []
        self.call_event = threading.Event()

        def fake_flow_chat(model, content, timeout):
            self.captured_calls.append({"model": model, "content": content, "timeout": timeout})
            self.call_event.set()
            return "https://flow-content.example/video/out.mp4"

        relay.flow_chat = fake_flow_chat
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), relay.Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        relay.KEY_FILE = self._orig_key
        relay.API_KEY_FILE = self._orig_api_key
        relay.STATE_FILE = self._orig_state
        relay.flow_chat = self._orig_flow_chat
        relay._tasks.clear()
        self.tmpdir.cleanup()

    def _post_video(self, payload: dict) -> dict:
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/v1/video_generation",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": "Bearer test-relay-key",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_reference_images_preserve_order_and_cap_at_3(self):
        res = self._post_video({
            "model": "omni-1.2-flash",
            "prompt": "three subjects running",
            "duration": 5,
            "size": "1280x720",
            "reference_images": [
                "https://img.example/1.png",
                {"url": "https://img.example/2.png"},
                {"image_url": {"url": "https://img.example/3.png"}},
                "https://img.example/4.png",
            ],
        })
        self.assertEqual(res["base_resp"]["status_code"], 0)
        self.assertTrue(self.call_event.wait(timeout=3))
        content = self.captured_calls[-1]["content"]
        self.assertEqual(content[0], {"type": "text", "text": "three subjects running"})
        self.assertEqual(
            [item["image_url"]["url"] for item in content[1:]],
            [
                "https://img.example/1.png",
                "https://img.example/2.png",
                "https://img.example/3.png",
            ],
        )

    def test_merge_first_last_and_reference_images_dedup_order(self):
        res = self._post_video({
            "model": "omni-1.2-flash",
            "prompt": "",
            "duration": 6,
            "first_frame_image": "https://img.example/first.png",
            "last_frame_image": "https://img.example/last.png",
            "reference_images": [
                "https://img.example/first.png",
                "https://img.example/ref2.png",
                "https://img.example/ref3.png",
            ],
        })
        self.assertEqual(res["base_resp"]["status_code"], 0)
        self.assertTrue(self.call_event.wait(timeout=3))
        content = self.captured_calls[-1]["content"]
        self.assertEqual(
            [item["image_url"]["url"] for item in content[1:]],
            [
                "https://img.example/first.png",
                "https://img.example/last.png",
                "https://img.example/ref2.png",
            ],
        )

    def test_empty_prompt_and_empty_refs_rejected(self):
        res = self._post_video({
            "model": "omni-1.2-flash",
            "prompt": "   ",
            "reference_images": ["", "   ", None],
        })
        self.assertEqual(res["base_resp"]["status_code"], 1001)
        self.assertIn("prompt is required", res["base_resp"]["status_msg"])

    def test_1080x1920_selects_portrait_video_variant(self):
        res = self._post_video({
            "model": "omni-1.2-flash",
            "prompt": "portrait video",
            "duration": 5,
            "size": "1080x1920",
        })
        self.assertEqual(res["base_resp"]["status_code"], 0)
        self.assertTrue(self.call_event.wait(timeout=3))
        self.assertEqual(self.captured_calls[-1]["model"], "omni-1.2-flash-5s-portrait")

    def test_1344x1008_resolves_to_four_three(self):
        self.assertEqual(relay.resolve_aspect({"size": "1344x1008"}), "four-three")
        self.assertEqual(relay.resolve_aspect({"size": "1008x1344"}), "three-four")


if __name__ == "__main__":
    unittest.main(verbosity=2)
