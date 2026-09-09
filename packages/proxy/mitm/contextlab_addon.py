"""contextlab capture addon for mitmproxy.

Some coding agents cannot be redirected with an environment variable — Codex is
a Rust binary that talks to chatgpt.com directly, Cline routes OAuth traffic
through its own host, OpenCode speaks to several providers at once. For those,
contextlab runs mitmproxy as a forward proxy and this addon does the capturing.

It writes the same capture shape as packages/proxy/src/capture.js and applies
the same redaction rules. Those two files must agree; if you change one, change
the other. The duplication is deliberate — it buys the ability to capture tools
that cannot be redirected, and the alternative is no support for three of the
seven tools.

Usage (the CLI does this for you):

    mitmdump -s contextlab_addon.py --listen-port 8080

Environment:
    CONTEXTLAB_INGEST_URL  where to POST captures  (default http://localhost:4041/api/ingest)
    CONTEXTLAB_HOME        fallback capture directory (default ~/.contextlab)
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from mitmproxy import http

# Keep in step with packages/proxy/src/constants.js
CAPTURE_SCHEMA_VERSION = 1
MAX_CAPTURE_BYTES = 24 * 1024 * 1024

INGEST_URL = os.environ.get(
    "CONTEXTLAB_INGEST_URL", "http://localhost:4041/api/ingest"
)
CONTEXTLAB_HOME = Path(
    os.environ.get("CONTEXTLAB_HOME", str(Path.home() / ".contextlab"))
)

SECRET_HEADERS = {
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "api-key",
    "x-goog-api-key",
    "x-goog-iam-authorization-token",
    "x-api-token",
    "x-auth-token",
    "x-session-token",
    "x-subscription-token",
    "cookie",
    "set-cookie",
    "openai-organization",
    "openai-project",
}
SECRET_HEADER_PATTERN = re.compile(r"(^|-)(key|token|secret|password|auth|cookie)(-|$)")

# Utility endpoints: real API calls, but not conversation turns.
IGNORED_PATH_MARKERS = (
    "/count_tokens",
    ":countTokens",
    ":loadCodeAssist",
    ":retrieveUserQuota",
    ":listExperiments",
    ":onboardUser",
    ":fetchAdminControls",
    ":recordCodeAssistMetrics",
)

# Hosts worth intercepting, plus a catch-all for OpenAI-compatible providers.
INTERESTING_HOSTS = (
    "chatgpt.com",
    "api.cline.bot",
    "api.githubcopilot.com",
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "cloudcode-pa.googleapis.com",
)
CATCH_ALL_PATHS = ("/v1/chat/completions", "/v1/messages", "/v1/responses")


def is_secret_header(name: str) -> bool:
    lower = name.lower()
    return lower in SECRET_HEADERS or bool(SECRET_HEADER_PATTERN.search(lower))


def redact_headers(headers) -> dict[str, str]:
    """Names survive, values do not. Mirrors headers.js:redactHeaders."""
    out: dict[str, str] = {}
    for name, value in headers.items():
        out[name.lower()] = "[redacted]" if is_secret_header(name) else value
    return out


def detect_provider(path: str, headers) -> tuple[str, str]:
    """Mirrors route.js:detectProvider. The order is load-bearing."""
    if re.match(r"^/(api|backend-api|codex)/", path):
        return "chatgpt", "chatgpt-backend"

    if "/v1/messages" in path or headers.get("anthropic-version"):
        return "anthropic", "anthropic-messages"

    if re.search(
        r"/v1[^/]*/projects/.+/locations/.+/publishers/google/models/", path
    ):
        return "vertex", "gemini"

    if (
        ":generateContent" in path
        or ":streamGenerateContent" in path
        or re.search(r"/v1(beta|alpha)/models/", path)
        or "/v1internal" in path
        or headers.get("x-goog-api-key")
    ):
        return "gemini", "gemini"

    if "/responses" in path:
        return "openai", "responses"
    if "/chat/completions" in path:
        return "openai", "chat-completions"
    if str(headers.get("authorization", "")).startswith("Bearer sk-"):
        return "openai", "unknown"

    return "unknown", "unknown"


def identify_tool(headers) -> str | None:
    """Mirrors core/src/tools.js:identifyTool, header half only."""
    agent = str(headers.get("user-agent", ""))
    if agent.startswith("claude-cli/"):
        return "claude"
    if re.search(r"aider", agent, re.I):
        return "aider"
    if agent.startswith("GeminiCLI/"):
        return "gemini"
    if re.search(r"kimi", agent, re.I):
        return "kimi"
    # Codex identifies itself only by where it is going.
    if "chatgpt.com" in str(headers.get("host", "")):
        return "codex"
    return None


def decode_body(raw: bytes, content_type: str, truncated: bool) -> dict:
    """Mirrors capture.js:decodeBody. mitmproxy has already decompressed."""
    if not raw:
        return {"body": None, "bodyEncoding": "empty", "bodyBytes": 0,
                "bodyTruncated": truncated}

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        import base64

        return {
            "body": base64.b64encode(raw).decode("ascii"),
            "bodyEncoding": "base64",
            "bodyBytes": len(raw),
            "bodyTruncated": truncated,
        }

    if not truncated and "json" in content_type:
        try:
            return {"body": json.loads(text), "bodyEncoding": "json",
                    "bodyBytes": len(raw), "bodyTruncated": truncated}
        except json.JSONDecodeError:
            pass

    return {"body": text, "bodyEncoding": "text", "bodyBytes": len(raw),
            "bodyTruncated": truncated}


def deliver(capture: dict) -> None:
    """POST to the server; fall back to the capture directory if it is down."""
    payload = json.dumps(capture).encode("utf-8")
    request = urllib.request.Request(
        INGEST_URL,
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(request, timeout=5).close()
        return
    except (urllib.error.URLError, OSError):
        pass

    directory = CONTEXTLAB_HOME / "captures"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = capture["capturedAt"].replace(":", "-").replace(".", "-")
    final = directory / f"{stamp}-{capture['id']}.json"
    temporary = final.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(capture, indent=2), encoding="utf-8")
    temporary.rename(final)


class ContextlabCapture:
    """Capture conversation turns without getting in their way."""

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        if not self._worth_capturing(flow):
            # Stream it and forget it: no reason to buffer traffic we discard.
            flow.response.stream = True
            return

        content_type = flow.response.headers.get("content-type", "")
        if "text/event-stream" not in content_type:
            return

        # Streamed responses must not be buffered by mitmproxy or the agent
        # stops rendering tokens as they arrive. Collect a copy on the way past.
        collected = bytearray()
        truncated = [False]

        def collect(data: bytes) -> bytes:
            if data:
                room = MAX_CAPTURE_BYTES - len(collected)
                if room > 0:
                    collected.extend(data[:room])
                else:
                    truncated[0] = True
            else:
                flow.metadata["contextlab_streamed"] = True
                self._emit(flow, bytes(collected), truncated[0])
            return data

        flow.response.stream = collect

    def response(self, flow: http.HTTPFlow) -> None:
        if flow.metadata.get("contextlab_streamed"):
            return
        if not self._worth_capturing(flow):
            return
        self._emit(flow, flow.response.content or b"", False)

    def _worth_capturing(self, flow: http.HTTPFlow) -> bool:
        if flow.request.method != "POST":
            return False

        path = flow.request.path
        if any(marker in path for marker in IGNORED_PATH_MARKERS):
            return False

        host = flow.request.pretty_host
        known_host = any(host.endswith(h) for h in INTERESTING_HOSTS)
        catch_all = any(path.startswith(p) for p in CATCH_ALL_PATHS)
        if not (known_host or catch_all):
            return False

        _, api_format = detect_provider(path, flow.request.headers)
        return api_format != "unknown"

    def _emit(self, flow: http.HTTPFlow, body: bytes, truncated: bool) -> None:
        try:
            capture = self._build(flow, body, truncated)
        except Exception:  # noqa: BLE001 — capturing must never break traffic
            return
        threading.Thread(target=deliver, args=(capture,), daemon=True).start()

    def _build(self, flow: http.HTTPFlow, body: bytes, truncated: bool) -> dict:
        request = flow.request
        response = flow.response
        provider, api_format = detect_provider(request.path, request.headers)
        started = flow.request.timestamp_start or time.time()

        request_body = request.content or b""
        request_truncated = len(request_body) > MAX_CAPTURE_BYTES

        return {
            "schemaVersion": CAPTURE_SCHEMA_VERSION,
            "id": secrets.token_hex(8),
            "capturedAt": datetime.fromtimestamp(started, timezone.utc).isoformat(),
            "transport": "mitmproxy",
            "tool": identify_tool(request.headers),
            "sessionTag": None,
            "provider": provider,
            "apiFormat": api_format,
            "request": {
                "method": request.method,
                "originalUrl": request.pretty_url,
                "url": request.pretty_url,
                "path": request.path,
                "headers": redact_headers(request.headers),
                **decode_body(
                    request_body[:MAX_CAPTURE_BYTES],
                    request.headers.get("content-type", ""),
                    request_truncated,
                ),
            },
            "response": {
                "status": response.status_code,
                "headers": redact_headers(response.headers),
                "streaming": "text/event-stream"
                in response.headers.get("content-type", ""),
                **decode_body(
                    body, response.headers.get("content-type", ""), truncated
                ),
            },
            "timing": {
                "startedAt": int(started * 1000),
                "firstByteMs": int(
                    ((response.timestamp_start or started) - started) * 1000
                ),
                "completedMs": int(
                    ((response.timestamp_end or time.time()) - started) * 1000
                ),
            },
        }


addons = [ContextlabCapture()]
