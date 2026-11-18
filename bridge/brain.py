"""
Kho kiến thức và agent phân tích cho FX Desk.

- Bộ kiến thức (playbook) lưu trên đĩa, trong thư mục bridge/knowledge/: tên, bộ quy tắc, tài liệu nguồn
  (PDF, văn bản, phụ đề video) và lịch sử trò chuyện khi dạy.
- "Học": gửi tài liệu nguồn, bộ quy tắc hiện tại và lời dạy mới cho Claude; Claude trả lời và viết lại bộ quy tắc.
- "Phân tích": gửi bộ quy tắc và các đặc điểm giá đã tính sẵn (xu hướng, đỉnh đáy, FVG, order block, thanh khoản)
  cho Claude; Claude chỉ áp dụng đúng bộ quy tắc đó và trả về nhận định có cấu trúc.

Nhà cung cấp AI chọn bằng "ai_provider" trong config.json (Claude, OpenAI, DeepSeek, Gemini, OpenRouter, Ollama...),
xem llm.py. PDF được lấy chữ ra ngay trên máy (pypdf) và gửi dạng chữ, rẻ hơn nhiều so với gửi nguyên file.
"""
import base64
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path

from llm import LLM

HERE = Path(__file__).resolve().parent
KB_DIR = HERE / "knowledge"
INDEX = KB_DIR / "index.json"
MAX_SOURCE_BYTES = 25_000_000  # tổng tài liệu gửi đi một lần; giới hạn của API là 32 MB mỗi yêu cầu
MAX_CHAT = 40  # số lượt trò chuyện gần nhất gửi lại cho model
MIN_CHARS_PER_PAGE = 80  # ít hơn mức này thì coi PDF là ảnh scan, không lấy được chữ


# ------------------------------------------------------------------- kho kiến thức

class Knowledge:
    def __init__(self):
        self.lock = threading.RLock()
        KB_DIR.mkdir(exist_ok=True)
        try:
            self.items = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else []
        except ValueError:
            self.items = []

    def _save(self):
        tmp = INDEX.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.items, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, INDEX)

    def _get(self, pid):
        pb = next((p for p in self.items if p["id"] == pid), None)
        if pb is None:
            raise ValueError("Không có bộ kiến thức này")
        return pb

    def list(self):
        with self.lock:
            return json.loads(json.dumps(self.items))

    def save(self, body):
        with self.lock:
            name = str(body.get("name") or "").strip()[:60]
            if body.get("id"):
                pb = self._get(str(body["id"]))
                if name:
                    pb["name"] = name
                if "rules" in body:
                    pb["rules"] = str(body["rules"])
            else:
                if not name:
                    raise ValueError("Cần đặt tên cho bộ kiến thức")
                pb = {"id": uuid.uuid4().hex[:10], "name": name, "rules": str(body.get("rules") or ""), "sources": [], "chat": []}
                self.items.append(pb)
            pb["updatedAt"] = int(time.time() * 1000)
            self._save()
            return pb

    def delete(self, pid):
        with self.lock:
            pb = self._get(pid)
            for s in pb["sources"]:
                self._file(pid, s).unlink(missing_ok=True)
                self._text_file(pid, s).unlink(missing_ok=True)
            self.items.remove(pb)
            self._save()
            return {"deleted": pid}

    def _file(self, pid, src):
        return KB_DIR / pid / f"{src['id']}.{'pdf' if src['kind'] == 'pdf' else 'txt'}"

    def _text_file(self, pid, src):
        return KB_DIR / pid / f"{src['id']}.pdf.txt"

    def pdf_text(self, pid, src):
        """Chữ trong PDF, lấy một lần rồi lưu lại. None nếu là PDF ảnh scan hoặc chưa cài pypdf."""
        cache = self._text_file(pid, src)
        if cache.exists():
            t = cache.read_text(encoding="utf-8")
            return t or None
        try:
            from pypdf import PdfReader
        except ImportError:
            return None
        try:
            reader = PdfReader(str(self._file(pid, src)))
            pages = [(p.extract_text() or "").strip() for p in reader.pages]
        except Exception:
            pages = []
        chars = sum(len(p) for p in pages)
        text = "\n\n".join(f"--- Trang {i + 1} ---\n{p}" for i, p in enumerate(pages) if p) if pages and chars >= MIN_CHARS_PER_PAGE * len(pages) else ""
        cache.write_text(text, encoding="utf-8")
        return text or None

    def add_source(self, body):
        with self.lock:
            pb = self._get(str(body.get("playbook")))
            kind = body.get("kind")
            if kind not in ("pdf", "text", "transcript"):
                raise ValueError("Loại tài liệu không hợp lệ")
            if kind == "pdf":
                data = base64.b64decode(str(body.get("data") or "").split(",", 1)[-1])
                if not data.startswith(b"%PDF"):
                    raise ValueError("File này không phải PDF")
            else:
                text = str(body.get("text") or "")
                if kind == "transcript" and "-->" in text:
                    text = strip_subtitles(text)
                data = text.strip().encode("utf-8")
                if not data:
                    raise ValueError("Tài liệu đang trống")
            total = sum(s["size"] for s in pb["sources"]) + len(data)
            if total > MAX_SOURCE_BYTES:
                raise ValueError("Tổng tài liệu của bộ này vượt 25 MB. Hãy tách thành nhiều bộ, hoặc bỏ bớt tài liệu")
            src = {"id": uuid.uuid4().hex[:10], "name": str(body.get("name") or "Tài liệu")[:120], "kind": kind, "size": len(data), "addedAt": int(time.time() * 1000)}
            path = self._file(pb["id"], src)
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(data)
            if kind == "pdf":
                text = self.pdf_text(pb["id"], src)
                src["textOnly"] = bool(text)
                src["tokens"] = estimate_tokens(text) if text else None
            else:
                src["tokens"] = estimate_tokens(data.decode("utf-8", "replace"))
            pb["sources"].append(src)
            pb["updatedAt"] = src["addedAt"]
            self._save()
            return pb

    def remove_source(self, pid, sid):
        with self.lock:
            pb = self._get(pid)
            src = next((s for s in pb["sources"] if s["id"] == sid), None)
            if src is None:
                raise ValueError("Không có tài liệu này")
            self._file(pid, src).unlink(missing_ok=True)
            self._text_file(pid, src).unlink(missing_ok=True)
            pb["sources"].remove(src)
            self._save()
            return pb

    def source_blocks(self, pb, pdf_native=False, pdf_full=False):
        """Tài liệu nguồn thành các khối nội dung gửi cho model.
        PDF gửi dạng chữ đã lấy sẵn (rẻ). Chỉ gửi nguyên file PDF (cả ảnh từng trang, đắt gấp mấy lần) khi model đọc
        được PDF và hoặc người dùng bật pdf_mode "full", hoặc PDF là ảnh scan không có chữ."""
        blocks = []
        for s in pb["sources"]:
            if s["kind"] == "pdf":
                text = None if (pdf_native and pdf_full) else self.pdf_text(pb["id"], s)
                if text:
                    blocks.append({"type": "text", "text": f"<Tài_liệu_PDF tên=\"{s['name']}\">\n{text}\n</Tài_liệu_PDF>"})
                elif pdf_native:
                    raw = self._file(pb["id"], s).read_bytes()
                    blocks.append({"type": "document", "title": s["name"], "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(raw).decode()}})
                else:
                    raise ValueError(f"Không lấy được chữ từ PDF \"{s['name']}\" (có thể là PDF ảnh scan, hoặc chưa cài pypdf). "
                                     "Model đang dùng không đọc được ảnh trong PDF: chạy pip install -r requirements.txt, "
                                     "hoặc chuyển PDF sang chữ (OCR) rồi nạp file .txt, hoặc dùng Claude")
            else:
                raw = self._file(pb["id"], s).read_bytes()
                label = "Phụ đề video" if s["kind"] == "transcript" else "Tài liệu"
                blocks.append({"type": "text", "text": f"<{label} tên=\"{s['name']}\">\n{raw.decode('utf-8', 'replace')}\n</{label}>"})
        return blocks

    def append_chat(self, pid, role, text):
        with self.lock:
            pb = self._get(pid)
            pb["chat"].append({"role": role, "text": text, "at": int(time.time() * 1000)})
            pb["updatedAt"] = int(time.time() * 1000)
            self._save()
            return pb

    def set_rules(self, pid, rules):
        with self.lock:
            pb = self._get(pid)
            pb["rules"] = rules
            self._save()
            return pb


# --------------------------------------------------------------------------- AI

LEARN_SYSTEM = """Bạn là trợ lý học phương pháp giao dịch forex của một trader. Người dùng dạy bạn một phương pháp cụ thể (ví dụ ICT, SMC, price action, hoặc kết hợp nhiều trường phái) qua tài liệu, phụ đề video và trò chuyện.

Nhiệm vụ:
1. Hiểu phương pháp từ tài liệu nguồn và lời người dùng nói.
2. Trả lời tin nhắn mới nhất của người dùng bằng tiếng Việt, ngắn gọn, đi thẳng vào ý.
3. Duy trì một BỘ QUY TẮC chính xác, kiểm tra được, đủ để người khác (hoặc chính bạn khi phân tích) áp dụng y hệt. Viết lại toàn bộ bộ quy tắc mỗi lần, không chỉ phần thay đổi.

Bộ quy tắc viết bằng Markdown tiếng Việt, theo các mục (bỏ mục nào chưa có thông tin):
## Khung thời gian
## Xác định xu hướng và cấu trúc
## Vùng quan tâm (POI)
## Điều kiện vào lệnh
## Đặt stop loss
## Đặt take profit
## Quản lý lệnh
## Khi nào không giao dịch
## Thuật ngữ

Nguyên tắc:
- Mỗi quy tắc là một gạch đầu dòng cụ thể, đo được khi có thể (khung thời gian, số nến, tỷ lệ R:R, phiên giao dịch).
- Chỉ ghi điều có trong tài liệu hoặc người dùng đã nói. Điều bạn tự suy ra thì ghi rõ "(suy luận, cần xác nhận)".
- Khi tài liệu mâu thuẫn hoặc quy tắc còn mơ hồ, hỏi lại trong open_questions thay vì tự quyết.
- Giữ nguyên các quy tắc cũ trừ khi người dùng sửa hoặc tài liệu mới cho thấy chúng sai.
- Nếu người dùng chỉ hỏi kiến thức, vẫn trả lời, và chỉ đổi bộ quy tắc khi có điều mới."""

ANALYZE_SYSTEM = """Bạn là agent phân tích forex. Bạn CHỈ được áp dụng bộ quy tắc của người dùng dưới đây, không dùng phương pháp nào khác.

Dữ liệu là các đặc điểm giá đã được tính sẵn từ nến MT5 cho nhiều khung thời gian (xu hướng EMA, đỉnh đáy swing, cấu trúc HH/HL/LH/LL, phá cấu trúc BOS/CHoCH, FVG chưa lấp, order block, thanh khoản đỉnh/đáy bằng nhau, đỉnh đáy ngày và tuần trước, vùng premium/discount, ATR). Mọi mức giá bạn đưa ra phải lấy từ dữ liệu này hoặc tính trực tiếp từ nó.

Cách làm:
1. Xác định thiên hướng (bias) từng khung theo đúng quy tắc, rồi xu hướng chính.
2. Kiểm tra lần lượt từng điều kiện vào lệnh trong bộ quy tắc. Ghi điều kiện nào đạt, điều kiện nào chưa.
3. Chỉ đề xuất lệnh khi mọi điều kiện bắt buộc đều đạt. Nếu chưa đủ, đặt has_trade = false và nói rõ cần chờ điều gì.
4. Lệnh đề xuất phải có SL đúng phía và TP theo quy tắc; tính R:R từ giá vào, SL, TP1.
5. Viết tiếng Việt, ngắn gọn. Không hứa hẹn lợi nhuận. Đây là phân tích tham khảo, người dùng tự quyết định."""

NUM_OR_NULL = {"anyOf": [{"type": "number"}, {"type": "null"}]}

LEARN_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "rules": {"type": "string"},
        "open_questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["reply", "rules", "open_questions"],
    "additionalProperties": False,
}

ANALYZE_SCHEMA = {
    "type": "object",
    "properties": {
        "main_trend": {"type": "string", "enum": ["up", "down", "range"]},
        "summary": {"type": "string"},
        "timeframes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tf": {"type": "string"},
                    "bias": {"type": "string", "enum": ["up", "down", "range"]},
                    "note": {"type": "string"},
                },
                "required": ["tf", "bias", "note"],
                "additionalProperties": False,
            },
        },
        "key_levels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"price": {"type": "number"}, "label": {"type": "string"}},
                "required": ["price", "label"],
                "additionalProperties": False,
            },
        },
        "checklist": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"rule": {"type": "string"}, "met": {"type": "boolean"}, "detail": {"type": "string"}},
                "required": ["rule", "met", "detail"],
                "additionalProperties": False,
            },
        },
        "has_trade": {"type": "boolean"},
        "trade": {
            "type": "object",
            "properties": {
                "side": {"type": "string", "enum": ["buy", "sell", "none"]},
                "order_type": {"type": "string", "enum": ["market", "limit", "stop", "none"]},
                "entry": NUM_OR_NULL,
                "sl": NUM_OR_NULL,
                "tp1": NUM_OR_NULL,
                "tp2": NUM_OR_NULL,
                "rr": NUM_OR_NULL,
                "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                "invalidation": {"type": "string"},
            },
            "required": ["side", "order_type", "entry", "sl", "tp1", "tp2", "rr", "confidence", "invalidation"],
            "additionalProperties": False,
        },
        "wait_for": {"type": "string"},
    },
    "required": ["main_trend", "summary", "timeframes", "key_levels", "checklist", "has_trade", "trade", "wait_for"],
    "additionalProperties": False,
}


class Brain:
    def __init__(self, cfg, kb):
        self.cfg = cfg or {}
        self.kb = kb
        self.llm = LLM(self.cfg)
        self.model = self.llm.model
        self.pdf_full = str(self.cfg.get("pdf_mode") or "text").lower() == "full"

    def status(self):
        return self.llm.status()

    def learn(self, body):
        pid, message = str(body.get("playbook")), str(body.get("message") or "").strip()
        if not message:
            raise ValueError("Tin nhắn đang trống")
        pb = self.kb.list()
        pb = next((p for p in pb if p["id"] == pid), None)
        if pb is None:
            raise ValueError("Không có bộ kiến thức này")
        # Tài liệu nguồn đứng đầu và được đánh dấu cache: chúng ít thay đổi, nên các lượt sau đọc lại rẻ hơn.
        # Bộ quy tắc đổi sau mỗi lượt nên đặt sau điểm cache.
        intro = self.kb.source_blocks(pb, pdf_native=self.llm.is_anthropic, pdf_full=self.pdf_full)
        if intro:
            intro[-1]["cache_control"] = {"type": "ephemeral"}
        intro.append({"type": "text", "text": f"Tên bộ kiến thức: {pb['name']}\n\nBộ quy tắc hiện tại:\n{pb['rules'] or '(chưa có)'}"})
        messages = [{"role": "user", "content": intro}, {"role": "assistant", "content": "Đã đọc tài liệu và bộ quy tắc hiện tại."}]
        for turn in pb["chat"][-MAX_CHAT:]:
            messages.append({"role": "user" if turn["role"] == "user" else "assistant", "content": turn["text"]})
        messages.append({"role": "user", "content": message})
        out, usage = self.llm.ask_json(LEARN_SYSTEM, messages, LEARN_SCHEMA, "medium")
        reply = out["reply"] + ("\n\nCâu hỏi cần bạn xác nhận:\n" + "\n".join(f"- {q}" for q in out["open_questions"]) if out["open_questions"] else "")
        self.kb.append_chat(pid, "user", message)
        self.kb.append_chat(pid, "assistant", reply)
        pb = self.kb.set_rules(pid, out["rules"].strip())
        return {"playbook": pb, "reply": reply, "usage": usage}

    def analyze(self, body):
        pid = str(body.get("playbook"))
        pb = next((p for p in self.kb.list() if p["id"] == pid), None)
        if pb is None:
            raise ValueError("Không có bộ kiến thức này")
        if not pb["rules"].strip():
            raise ValueError("Bộ kiến thức này chưa có quy tắc. Hãy dạy trước ở mục Học")
        features = body.get("features")
        if not isinstance(features, dict):
            raise ValueError("Thiếu dữ liệu giá")
        content = [
            {"type": "text", "text": f"Bộ quy tắc \"{pb['name']}\":\n{pb['rules']}", "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": "Dữ liệu giá đã tính sẵn (JSON):\n" + json.dumps(features, ensure_ascii=False)},
        ]
        note = str(body.get("note") or "").strip()
        if note:
            content.append({"type": "text", "text": f"Ghi chú thêm của người dùng: {note}"})
        out, usage = self.llm.ask_json(ANALYZE_SYSTEM, [{"role": "user", "content": content}], ANALYZE_SCHEMA, "high")
        return {"analysis": out, "usage": usage, "model": self.model}


def estimate_tokens(text):
    """Ước lượng thô số token: khoảng 3 ký tự một token với tiếng Việt có dấu."""
    return max(1, len(text or "") // 3)


def strip_subtitles(text):
    """Bỏ số thứ tự và mốc thời gian của file .srt / .vtt, giữ lời thoại."""
    out = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s == "WEBVTT" or s.isdigit() or re.match(r"^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->", s):
            continue
        if out and out[-1] == s:
            continue
        out.append(re.sub(r"<[^>]+>", "", s))
    return "\n".join(out)


# ------------------------------------------------------------ nhân vật AI để trò chuyện

PERSONAS = KB_DIR / "personas.json"
PERSONA_FIELDS = ("name", "avatar", "tagline", "personality", "values", "style", "boundaries", "greeting", "examples", "playbooks", "use_account")
MAX_CHAT_TURNS = 30  # số lượt gần nhất gửi lại cho model

CHAT_RULES = """Quy tắc chung, luôn áp dụng bất kể nhân cách:
- Bạn là một trợ lý AI. Nếu người dùng hỏi thẳng bạn có phải người thật không, hãy nói thật.
- Không hứa hẹn lợi nhuận, không khẳng định chắc chắn giá sẽ đi đâu. Phân tích là tham khảo; người dùng tự quyết định và chịu trách nhiệm.
- Không khuyến khích tăng rủi ro để gỡ lỗ, không cổ vũ trade trả thù hay dùng tiền không được phép mất.
- Khi dùng bộ quy tắc giao dịch được cung cấp, bám đúng quy tắc đó; điều không có trong quy tắc thì nói rõ là ý kiến riêng.
- Trả lời bằng tiếng Việt trừ khi người dùng dùng ngôn ngữ khác. Ngắn gọn, đi thẳng vào ý, trừ khi được yêu cầu giải thích dài."""


class Personas:
    def __init__(self, kb):
        self.kb = kb
        self.lock = threading.RLock()
        try:
            self.data = json.loads(PERSONAS.read_text(encoding="utf-8")) if PERSONAS.exists() else {"items": [], "chats": {}}
        except ValueError:
            self.data = {"items": [], "chats": {}}

    def _save(self):
        KB_DIR.mkdir(exist_ok=True)
        tmp = PERSONAS.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, PERSONAS)

    def list(self):
        with self.lock:
            return {"items": json.loads(json.dumps(self.data["items"])), "chats": json.loads(json.dumps(self.data["chats"]))}

    def get(self, pid):
        p = next((x for x in self.data["items"] if x["id"] == pid), None)
        if p is None:
            raise ValueError("Không có nhân vật này")
        return p

    def save(self, body):
        with self.lock:
            clean = {k: body.get(k) for k in PERSONA_FIELDS if k in body}
            for k in ("name", "tagline", "personality", "values", "style", "boundaries", "greeting", "examples"):
                if k in clean:
                    clean[k] = str(clean[k] or "")[:6000]
            if "avatar" in clean:
                clean["avatar"] = str(clean["avatar"] or "")[:400_000]
            if "playbooks" in clean:
                clean["playbooks"] = [str(x) for x in (clean["playbooks"] or [])][:5]
            if "use_account" in clean:
                clean["use_account"] = bool(clean["use_account"])
            if body.get("id"):
                p = self.get(str(body["id"]))
                p.update(clean)
            else:
                if not str(clean.get("name") or "").strip():
                    raise ValueError("Cần đặt tên cho nhân vật")
                p = {"id": uuid.uuid4().hex[:10], "playbooks": [], "use_account": True, **clean, "createdAt": int(time.time() * 1000)}
                self.data["items"].append(p)
            p["updatedAt"] = int(time.time() * 1000)
            self._save()
            return self.list()

    def delete(self, pid):
        with self.lock:
            self.data["items"] = [x for x in self.data["items"] if x["id"] != pid]
            self.data["chats"].pop(pid, None)
            self._save()
            return self.list()

    def clear(self, pid):
        with self.lock:
            self.data["chats"][pid] = []
            self._save()
            return self.list()

    def append(self, pid, role, text):
        with self.lock:
            chat = self.data["chats"].setdefault(pid, [])
            chat.append({"role": role, "text": text, "at": int(time.time() * 1000)})
            del chat[:-200]
            self._save()

    def system_prompt(self, p):
        parts = [f"Bạn là {p.get('name')}." + (f" {p['tagline']}" if p.get("tagline") else "")]
        for title, key in (("Tính cách", "personality"), ("Giá trị và phẩm giá, luôn giữ dù người dùng yêu cầu khác", "values"),
                           ("Cách nói chuyện, xưng hô", "style"), ("Những điều bạn không làm", "boundaries"), ("Hội thoại mẫu, để hiểu giọng của bạn", "examples")):
            if str(p.get(key) or "").strip():
                parts.append(f"## {title}\n{p[key].strip()}")
        books = [b for b in self.kb.list() if b["id"] in (p.get("playbooks") or []) and b["rules"].strip()]
        for b in books:
            parts.append(f"## Bộ quy tắc giao dịch \"{b['name']}\" (kiến thức bạn được dạy)\n{b['rules']}")
        parts.append(CHAT_RULES)
        parts.append("Luôn giữ đúng nhân cách ở trên trong mọi câu trả lời.")
        return "\n\n".join(parts)


def chat(brain, personas, body):
    """Một lượt trò chuyện: nhân cách + bộ quy tắc trong system (có cache), lịch sử gần nhất, bối cảnh tài khoản nếu bật."""
    pid, message = str(body.get("persona")), str(body.get("message") or "").strip()
    if not message:
        raise ValueError("Tin nhắn đang trống")
    p = personas.get(pid)
    history = personas.list()["chats"].get(pid, [])[-MAX_CHAT_TURNS:]
    messages = []
    for turn in history:
        role = "user" if turn["role"] == "user" else "assistant"
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n\n" + turn["text"]
        else:
            messages.append({"role": role, "content": turn["text"]})
    if messages and messages[0]["role"] == "assistant":
        messages.insert(0, {"role": "user", "content": "(bắt đầu cuộc trò chuyện)"})
    context = str(body.get("context") or "").strip()
    user_text = message if not (context and p.get("use_account", True)) else f"<boi_canh_tai_khoan>\n{context}\n</boi_canh_tai_khoan>\n\n{message}"
    if messages and messages[-1]["role"] == "user":
        messages[-1]["content"] += "\n\n" + user_text
    else:
        messages.append({"role": "user", "content": user_text})
    system = [{"type": "text", "text": personas.system_prompt(p), "cache_control": {"type": "ephemeral"}}]
    reply, _ = brain.llm.ask_text(system, messages, "medium", 8000)
    reply = reply or "Mình không thể trả lời câu này."
    personas.append(pid, "user", message)
    personas.append(pid, "assistant", reply)
    return {"reply": reply, **personas.list()}
