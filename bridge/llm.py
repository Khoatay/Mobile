"""
Gọi các nhà cung cấp AI ngoài Claude cho bản IB: ChatGPT, Gemini và các dịch vụ "tương thích OpenAI"
(DeepSeek, Grok, OpenRouter, Qwen, Groq). Chỉ dùng thư viện chuẩn của Python (urllib), không cần cài thêm.
Claude vẫn đi qua thư viện anthropic trong brain.py để giữ cache, dự phòng phía máy chủ và JSON có cấu trúc.
"""
import json
import re
import urllib.error
import urllib.request

PROVIDERS = [
    {"id": "anthropic", "label": "Claude (Anthropic)", "key_url": "console.anthropic.com", "hint": "Khoá bắt đầu bằng sk-ant-"},
    {"id": "openai", "label": "ChatGPT (OpenAI)", "base": "https://api.openai.com/v1", "key_url": "platform.openai.com/api-keys", "hint": "Khoá bắt đầu bằng sk-"},
    {"id": "gemini", "label": "Gemini (Google)", "key_url": "aistudio.google.com/apikey", "hint": "Khoá bắt đầu bằng AIza"},
    {"id": "deepseek", "label": "DeepSeek", "base": "https://api.deepseek.com/v1", "key_url": "platform.deepseek.com", "hint": ""},
    {"id": "xai", "label": "Grok (xAI)", "base": "https://api.x.ai/v1", "key_url": "console.x.ai", "hint": ""},
    {"id": "openrouter", "label": "OpenRouter (hàng trăm model)", "base": "https://openrouter.ai/api/v1", "key_url": "openrouter.ai/keys", "hint": "Một khoá dùng được model của nhiều hãng"},
    {"id": "qwen", "label": "Qwen (Alibaba)", "base": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "key_url": "dashscope.console.aliyun.com", "hint": ""},
    {"id": "groq", "label": "Groq", "base": "https://api.groq.com/openai/v1", "key_url": "console.groq.com/keys", "hint": ""},
    {"id": "custom", "label": "Địa chỉ khác (tương thích OpenAI)", "key_url": "", "hint": "Nhập địa chỉ API, ví dụ https://…/v1"},
]
BY_ID = {p["id"]: p for p in PROVIDERS}
SKIP = re.compile(r"embed|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe|search-preview|guard|rerank", re.I)


class LlmError(RuntimeError):
    pass


def _friendly(status, body):
    b = body.lower()
    if status in (401, 403) or "invalid api key" in b or "api key not valid" in b or "incorrect api key" in b:
        return LlmError("Khoá AI không đúng hoặc đã bị thu hồi")
    if status == 402 or any(w in b for w in ("insufficient", "quota", "credit", "balance")):
        return LlmError("Tài khoản AI hết tiền hoặc hết hạn mức. Nạp thêm ở trang của nhà cung cấp")
    if status == 429:
        return LlmError("AI đang quá tải hoặc vượt giới hạn tốc độ. Thử lại sau ít phút")
    if status == 404 or ("model" in b and ("not found" in b or "does not exist" in b)):
        return LlmError("Không có model này, hoặc khoá không được dùng model này")
    return LlmError(f"AI báo lỗi ({status}): {body[:200]}")


def _http(url, headers, body=None, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json", **headers}, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise _friendly(e.code, e.read().decode("utf-8", "replace"))
    except urllib.error.URLError as e:
        raise LlmError(f"Không gọi được AI: {e.reason}. Kiểm tra internet")


def base_of(provider, base=""):
    b = (base or BY_ID.get(provider, {}).get("base") or "").rstrip("/")
    if not b.startswith("https://"):
        raise LlmError("Địa chỉ API phải bắt đầu bằng https://")
    return b


def _text_of(content):
    """Khối nội dung kiểu Claude -> chữ thường. PDF chỉ Claude và Gemini đọc được."""
    if isinstance(content, str):
        return content
    out = []
    for b in content:
        if b.get("type") == "text":
            out.append(b["text"])
        elif b.get("type") == "document":
            raise LlmError("Tài liệu PDF chỉ dùng được với Claude hoặc Gemini. Đổi model mạnh sang Claude/Gemini, hoặc dán nội dung dạng văn bản")
    return "\n\n".join(out)


def _gemini_parts(content):
    if isinstance(content, str):
        return [{"text": content}]
    parts = []
    for b in content:
        if b.get("type") == "text":
            parts.append({"text": b["text"]})
        elif b.get("type") == "document":
            parts.append({"inline_data": {"mime_type": "application/pdf", "data": b["source"]["data"]}})
    return parts


def complete(provider, model, key, system, messages, max_tokens=4000, schema=None, base=""):
    """Một lần gọi. messages theo kiểu Claude (role user/assistant, content là chữ hoặc danh sách khối).
    schema: nếu có thì yêu cầu trả về JSON theo schema và trả về dict. Trả về (kết quả, usage)."""
    if not key:
        raise LlmError("Chưa có khoá AI cho nhà cung cấp này")
    if not model:
        raise LlmError("Chưa chọn model")
    sys_text = system if isinstance(system, str) else "\n\n".join(b.get("text", "") for b in system)
    if schema:
        sys_text += "\n\nChỉ trả lời bằng một đối tượng JSON đúng schema sau, không viết gì khác:\n" + json.dumps(schema, ensure_ascii=False)

    if provider == "gemini":
        cfg = {"maxOutputTokens": max_tokens}
        if schema:
            cfg["responseMimeType"] = "application/json"
        r = _http(f"https://generativelanguage.googleapis.com/v1beta/models/{model.removeprefix('models/')}:generateContent", {"x-goog-api-key": key}, {
            "systemInstruction": {"parts": [{"text": sys_text}]},
            "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": _gemini_parts(m["content"])} for m in messages],
            "generationConfig": cfg,
        })
        cand = (r.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", [])).strip()
        u = r.get("usageMetadata") or {}
        cached = u.get("cachedContentTokenCount", 0)
        usage = {"input": u.get("promptTokenCount", 0) - cached, "output": u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0), "cache_read": cached, "cache_write": 0, "model": model}
        refused = not cand or cand.get("finishReason") == "SAFETY"
    else:
        official = provider == "openai"
        body = {
            "model": model,
            "messages": [{"role": "developer" if official else "system", "content": sys_text}] + [{"role": m["role"], "content": _text_of(m["content"])} for m in messages],
            ("max_completion_tokens" if official else "max_tokens"): max_tokens,
        }
        if schema:
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "ket_qua", "schema": schema, "strict": True}} if official else {"type": "json_object"}
        r = _http(base_of(provider, base) + "/chat/completions", {"authorization": f"Bearer {key}"}, body)
        ch = (r.get("choices") or [{}])[0]
        text = str((ch.get("message") or {}).get("content") or "").strip()
        u = r.get("usage") or {}
        cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens") or u.get("prompt_cache_hit_tokens") or 0
        usage = {"input": u.get("prompt_tokens", 0) - cached, "output": u.get("completion_tokens", 0), "cache_read": cached, "cache_write": 0, "model": r.get("model") or model}
        refused = ch.get("finish_reason") == "content_filter" or bool((ch.get("message") or {}).get("refusal"))

    if refused:
        raise LlmError("AI từ chối yêu cầu này")
    if not schema:
        return text, usage
    try:
        return json.loads(text), usage
    except ValueError:
        # Một số model bọc JSON trong ```json … ```: lấy phần giữa dấu ngoặc.
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group(0)), usage
            except ValueError:
                pass
        raise LlmError("Model này trả về không đúng định dạng. Thử model mạnh hơn cho tính năng này")


def list_models(provider, key, base=""):
    if not key:
        raise LlmError("Chưa có khoá AI")
    if provider == "anthropic":
        r = _http("https://api.anthropic.com/v1/models?limit=100", {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=20)
        ids = [m["id"] for m in r.get("data", [])]
    elif provider == "gemini":
        r = _http("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {"x-goog-api-key": key}, timeout=20)
        ids = [m["name"].removeprefix("models/") for m in r.get("models", []) if "generateContent" in (m.get("supportedGenerationMethods") or [])]
    else:
        r = _http(base_of(provider, base) + "/models", {"authorization": f"Bearer {key}"}, timeout=20)
        ids = [m["id"] for m in r.get("data", [])]
    return sorted({i for i in ids if not SKIP.search(i)})
