"""
Lớp gọi mô hình AI cho bridge, dùng được nhiều nhà cung cấp.

Cấu hình trong config.json:
    "ai_provider": "anthropic" | "openai" | "deepseek" | "gemini" | "openrouter" | "ollama" | "custom"
    "ai_api_key":  khoá API của nhà cung cấp đó (Ollama chạy trên máy thì không cần)
    "ai_model":    tên model (Claude và DeepSeek có sẵn mặc định, các nơi khác phải ghi rõ)
    "ai_base_url": chỉ cần cho "custom", hoặc khi muốn đổi địa chỉ máy chủ
    "ai_json_mode": "schema" | "object" | "none" (không bắt buộc, mỗi nhà cung cấp đã có sẵn mặc định)
    "ai_max_tokens": trần số token trả về (không bắt buộc)

Vẫn đọc "anthropic_api_key" như trước, nên config cũ chạy y nguyên.

Claude dùng thư viện anthropic. Các nhà cung cấp còn lại đều có API kiểu OpenAI (/chat/completions),
nên dùng chung một đường gọi bằng thư viện chuẩn của Python, không cần cài thêm gì.
"""
import json
import os
import re
import urllib.error
import urllib.request

DEFAULT_PROVIDER = "anthropic"

# json: cách ép trả về JSON. "schema" là JSON Schema chặt, "object" là chỉ bảo đảm JSON hợp lệ
# (schema được viết vào lời nhắn), "none" là chỉ dặn trong lời nhắn.
PRESETS = {
    "anthropic": {"name": "Claude (Anthropic)", "model": "claude-opus-5-5", "env": "ANTHROPIC_API_KEY", "site": "console.anthropic.com"},
    "openai": {"name": "OpenAI (ChatGPT)", "base_url": "https://api.openai.com/v1", "env": "OPENAI_API_KEY",
               "json": "schema", "max_field": "max_completion_tokens", "site": "platform.openai.com"},
    "deepseek": {"name": "DeepSeek", "base_url": "https://api.deepseek.com", "model": "deepseek-chat", "env": "DEEPSEEK_API_KEY",
                 "json": "object", "max_tokens": 8000, "site": "platform.deepseek.com"},
    "gemini": {"name": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "env": "GEMINI_API_KEY",
               "json": "object", "site": "aistudio.google.com"},
    "openrouter": {"name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "env": "OPENROUTER_API_KEY",
                   "json": "object", "site": "openrouter.ai"},
    "ollama": {"name": "Ollama (chạy trên máy)", "base_url": "http://localhost:11434/v1", "json": "object", "no_key": True, "site": "ollama.com"},
    "custom": {"name": "Máy chủ kiểu OpenAI", "json": "object"},
}


class LLM:
    def __init__(self, cfg):
        cfg = cfg or {}
        self.cfg = cfg
        self.provider = str(cfg.get("ai_provider") or DEFAULT_PROVIDER).strip().lower()
        self.preset = PRESETS.get(self.provider)
        p = self.preset or {}
        self.model = str(cfg.get("ai_model") or p.get("model") or "")
        self.base_url = str(cfg.get("ai_base_url") or p.get("base_url") or "").rstrip("/")
        self.json_mode = str(cfg.get("ai_json_mode") or p.get("json") or "object")
        self.max_tokens = int(cfg.get("ai_max_tokens") or p.get("max_tokens") or 16000)
        key = cfg.get("ai_api_key")
        if not key and self.provider == "anthropic":
            key = cfg.get("anthropic_api_key")
        self.key = str(key or (os.environ.get(p["env"]) if p.get("env") else "") or "")
        self._anthropic = None

    # ---------------------------------------------------------------- trạng thái

    @property
    def is_anthropic(self):
        return self.provider == "anthropic"

    @property
    def name(self):
        return (self.preset or {}).get("name", self.provider)

    def problem(self):
        """Lý do chưa dùng được, hoặc chuỗi rỗng nếu đã đủ cấu hình."""
        if self.preset is None:
            return f"ai_provider \"{self.provider}\" không hợp lệ. Chọn một trong: {', '.join(PRESETS)}"
        if not self.key and not self.preset.get("no_key"):
            site = self.preset.get("site")
            return f"Chưa có khoá API cho {self.name}: thêm \"ai_api_key\" vào config.json" + (f" (tạo khoá tại {site})" if site else "")
        if not self.model:
            return f"Chưa chọn model cho {self.name}: thêm \"ai_model\" vào config.json"
        if not self.is_anthropic and not self.base_url:
            return "Chưa có địa chỉ máy chủ AI: thêm \"ai_base_url\" vào config.json"
        return ""

    def status(self):
        prob = self.problem()
        return {"configured": not prob, "problem": prob, "provider": self.provider, "providerName": self.name,
                "model": self.model, "pdfNative": self.is_anthropic}

    def _check(self):
        prob = self.problem()
        if prob:
            raise RuntimeError(prob)

    # -------------------------------------------------------------- gọi model

    def ask_json(self, system, messages, schema, effort="medium"):
        """Trả về (dict theo schema, usage)."""
        self._check()
        if self.is_anthropic:
            text, usage = self._anthropic_call(system, messages, effort, self.max_tokens, schema)
            return json.loads(text), usage
        sys_text = _flatten(system) + "\n\n" + json_instruction(schema)
        text, usage = self._openai_call(sys_text, messages, self.max_tokens, schema)
        return conform(schema, parse_json(text)), usage

    def ask_text(self, system, messages, effort="medium", max_tokens=8000):
        """Trả về (chữ, usage). Câu bị từ chối trả về chuỗi rỗng."""
        self._check()
        if self.is_anthropic:
            return self._anthropic_call(system, messages, effort, max_tokens, None)
        text, usage = self._openai_call(_flatten(system), messages, min(max_tokens, self.max_tokens), None)
        return _strip_think(text).strip(), usage

    # ------------------------------------------------------------ Anthropic

    def _anthropic_client(self):
        if self._anthropic is None:
            try:
                import anthropic
            except ImportError:
                raise RuntimeError("Chưa cài thư viện anthropic: pip install -r requirements.txt")
            self._anthropic = anthropic.Anthropic(api_key=self.key) if self.key else anthropic.Anthropic()
        return self._anthropic

    def _anthropic_call(self, system, messages, effort, max_tokens, schema):
        import anthropic
        output = {"effort": effort}
        if schema is not None:
            output["format"] = {"type": "json_schema", "schema": schema}
        try:
            res = self._anthropic_client().beta.messages.create(
                model=self.model, max_tokens=max_tokens, system=system, messages=messages,
                output_config=output, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            )
        except anthropic.AuthenticationError:
            raise RuntimeError("Khoá API không hợp lệ. Kiểm tra ai_api_key trong config.json")
        except anthropic.PermissionDeniedError as e:
            raise RuntimeError(f"Khoá API không có quyền dùng model {self.model}: {e.message}")
        except anthropic.RateLimitError:
            raise RuntimeError("Đang bị giới hạn số lần gọi API. Thử lại sau ít phút")
        except anthropic.BadRequestError as e:
            raise RuntimeError(f"Yêu cầu không hợp lệ: {e.message}")
        except anthropic.APIStatusError as e:
            raise RuntimeError(f"Lỗi API {e.status_code}: {e.message}")
        except anthropic.APIConnectionError:
            raise RuntimeError("Không kết nối được tới máy chủ Anthropic. Kiểm tra internet")
        usage = {"input": res.usage.input_tokens, "output": res.usage.output_tokens}
        if res.stop_reason == "refusal":
            if schema is None:
                return "", usage
            raise RuntimeError("Claude từ chối yêu cầu này")
        if res.stop_reason == "max_tokens" and schema is not None:
            raise RuntimeError("Câu trả lời bị cắt vì quá dài. Thử tách tài liệu hoặc hỏi ngắn hơn")
        return "".join(b.text for b in res.content if b.type == "text"), usage

    # --------------------------------------------------- API kiểu OpenAI

    def _openai_call(self, system, messages, max_tokens, schema):
        msgs = [{"role": "system", "content": system}] + [{"role": m["role"], "content": _flatten(m["content"])} for m in messages]
        body = {"model": self.model, "messages": msgs, (self.preset or {}).get("max_field", "max_tokens"): max_tokens}
        mode = self.json_mode if schema is not None else "none"
        if mode == "schema":
            body["response_format"] = {"type": "json_schema", "json_schema": {"name": "answer", "strict": True, "schema": schema}}
        elif mode == "object":
            body["response_format"] = {"type": "json_object"}
        try:
            data = self._post(body)
        except _BadFormat:
            # Model không hỗ trợ ép JSON: gọi lại, chỉ dặn trong lời nhắn.
            body.pop("response_format", None)
            data = self._post(body)
        choice = (data.get("choices") or [{}])[0]
        text = (choice.get("message") or {}).get("content") or ""
        u = data.get("usage") or {}
        usage = {"input": int(u.get("prompt_tokens") or 0), "output": int(u.get("completion_tokens") or 0)}
        if choice.get("finish_reason") == "length" and schema is not None:
            raise RuntimeError("Câu trả lời bị cắt vì quá dài. Thử tách tài liệu, hỏi ngắn hơn, hoặc tăng ai_max_tokens")
        if choice.get("finish_reason") == "content_filter":
            raise RuntimeError(f"{self.name} từ chối yêu cầu này")
        return text, usage

    def _post(self, body):
        headers = {"Content-Type": "application/json"}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        req = urllib.request.Request(self.base_url + "/chat/completions", data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = _error_text(e)
            if e.code == 400 and "response_format" in body and re.search(r"response_format|json_schema|json_object|schema", detail, re.I):
                raise _BadFormat()
            if e.code in (401, 403):
                raise RuntimeError(f"Khoá API không hợp lệ hoặc không có quyền ({self.name}): {detail}")
            if e.code == 404:
                raise RuntimeError(f"Không tìm thấy model \"{self.model}\" ở {self.name}. Kiểm tra ai_model: {detail}")
            if e.code == 402:
                raise RuntimeError(f"Tài khoản {self.name} hết tiền hoặc chưa nạp: {detail}")
            if e.code == 429:
                raise RuntimeError("Đang bị giới hạn số lần gọi API hoặc hết hạn mức. Thử lại sau ít phút")
            raise RuntimeError(f"Lỗi API {e.code} ({self.name}): {detail}")
        except urllib.error.URLError as e:
            hint = " Ollama đã chạy chưa?" if self.provider == "ollama" else " Kiểm tra internet."
            raise RuntimeError(f"Không kết nối được tới {self.base_url}.{hint} ({e.reason})")
        except TimeoutError:
            raise RuntimeError(f"{self.name} trả lời quá lâu. Thử lại hoặc dùng model nhanh hơn")
        except ValueError:
            raise RuntimeError(f"{self.name} trả về dữ liệu không đọc được")


class _BadFormat(Exception):
    pass


def _error_text(e):
    try:
        raw = e.read().decode("utf-8", "replace")
    except Exception:
        return str(e)
    try:
        err = json.loads(raw)
        if isinstance(err, list) and err:
            err = err[0]
        err = err.get("error", err)
        return str(err.get("message") if isinstance(err, dict) else err)[:400]
    except (ValueError, AttributeError):
        return raw[:400]


# --------------------------------------------------------------- tiện ích

def _flatten(content):
    """Khối nội dung kiểu Anthropic thành chữ thường cho API kiểu OpenAI."""
    if isinstance(content, str):
        return content
    parts = []
    for b in content or []:
        if isinstance(b, str):
            parts.append(b)
        elif b.get("type") == "text":
            parts.append(b["text"])
        elif b.get("type") == "document":
            raise RuntimeError("Model này không đọc được file PDF gốc. Cần lấy chữ từ PDF trước")
    return "\n\n".join(parts)


def json_instruction(schema):
    return ("Định dạng trả lời: CHỈ một đối tượng JSON hợp lệ, không có chữ nào khác trước hay sau, không bọc trong ```.\n"
            "Đối tượng phải có đủ mọi trường bắt buộc và đúng kiểu theo JSON Schema sau:\n"
            + json.dumps(schema, ensure_ascii=False))


def _strip_think(text):
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S)


def parse_json(text):
    """Lấy đối tượng JSON từ câu trả lời, kể cả khi model bọc trong ``` hoặc nói thêm vài chữ."""
    t = _strip_think(text).strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        pass
    a, b = t.find("{"), t.rfind("}")
    if a >= 0 and b > a:
        try:
            return json.loads(t[a:b + 1])
        except ValueError:
            pass
    raise RuntimeError("Model không trả về JSON đúng định dạng. Thử lại, hoặc dùng model mạnh hơn")


def conform(schema, value):
    """Sửa nhẹ kết quả cho khớp schema: thêm trường thiếu, đổi kiểu sai, thay giá trị ngoài enum.
    Model không có JSON Schema chặt đôi khi bỏ sót trường; app cần đủ trường để hiển thị."""
    if "anyOf" in schema:
        if value is None and any(s.get("type") == "null" for s in schema["anyOf"]):
            return None
        for s in schema["anyOf"]:
            if s.get("type") == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
                return value
            if s.get("type") == "number" and isinstance(value, str):
                try:
                    return float(value.replace(",", ""))
                except ValueError:
                    pass
        return None
    t = schema.get("type")
    if "enum" in schema:
        opts = schema["enum"]
        if value in opts:
            return value
        low = str(value).strip().lower()
        hit = next((o for o in opts if o.lower() == low), None)
        return hit or next((o for o in ("none", "range", "medium", "low") if o in opts), opts[0])
    if t == "object":
        value = value if isinstance(value, dict) else {}
        props = schema.get("properties", {})
        return {k: conform(s, value.get(k)) for k, s in props.items()}
    if t == "array":
        if not isinstance(value, list):
            value = [] if value is None else [value]
        return [conform(schema.get("items", {}), v) for v in value]
    if t == "string":
        if value is None:
            return ""
        return value if isinstance(value, str) else (json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value))
    if t == "boolean":
        if isinstance(value, str):
            return value.strip().lower() in ("true", "yes", "1", "có")
        return bool(value)
    if t == "number":
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0
    return value
