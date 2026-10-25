"""One-time, source-bound import. Runtime does not require pdfplumber."""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'source-question-bank.pdf'


def import_bank():
    import pdfplumber
    topics, current, buffer = [], None, []
    region, category, mode = "mainland", "new", None
    page_no = 0

    def clean(s):
        return s.replace("’", "'").replace("‘", "'").replace("？", "?").strip()

    def flush():
        nonlocal buffer
        if not current or not buffer:
            buffer = []
            return
        text = clean(" ".join(buffer))
        if mode == "questions":
            current["questions"].append({"text": text, "page": buffer_page})
        elif mode == "prompt":
            current["prompt"] = text
        elif mode == "bullets":
            current["bullets"].append(text)
        elif mode == "p3":
            current["part3"].append({"text": text, "page": buffer_page})
        buffer = []

    with pdfplumber.open(SOURCE) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            if page_no < 5 or page_no > 45:
                continue
            for line in (page.extract_text() or "").splitlines():
                line = clean(line)
                if not line or re.fullmatch(r"\d+", line):
                    continue
                if line.startswith("三、"):
                    flush(); region = "overseas"; current = None
                    continue
                if line.startswith("二、"):
                    flush(); category = "retained"; current = None
                    continue
                if line.startswith("一、"):
                    continue
                if line.startswith("Part "):
                    flush()
                    category = "evergreen" if "万年" in line else ("retained" if "保留" in line else "new")
                    current = None
                    continue
                match = re.match(r"^(?:\d+\s+P([12])\s+(.+)|万年老题\s+(.+))$", line)
                if match:
                    flush()
                    part = int(match.group(1) or 1)
                    title = match.group(2) or match.group(3)
                    current = {"part": part, "title": title, "region": region,
                               "category": category, "page": page_no}
                    current.update({"questions": []} if part == 1 else {"prompt": "", "bullets": [], "part3": []})
                    topics.append(current)
                    mode = "questions" if part == 1 else "prompt"
                    continue
                if not current:
                    continue
                if line == "P3":
                    flush(); mode = "p3"; continue
                if line.startswith("You should say"):
                    flush(); mode = "bullets"; continue
                if mode in ("questions", "p3"):
                    # PDF line wraps are joined until the question terminates. A few
                    # source prompts are statements; a new capitalized question ends them.
                    if buffer and re.match(r"^(?:Do |Does |Did |What |Which |Why |How |When |Where |Who |Are |Is |Should |Can |Would |Will |Have |Has |Other |Some )", line) and buffer[-1].endswith("."):
                        flush()
                    if not buffer:
                        buffer_page = page_no
                    buffer.append(line)
                    if line.endswith(("?", ".")):
                        flush()
                elif mode == "prompt":
                    if not buffer:
                        buffer_page = page_no
                    buffer.append(line)
                elif mode == "bullets":
                    if re.match(r"^(?:Who|What|Where|When|Why|How|Whether|In |And |and )", line):
                        flush(); buffer_page = page_no
                    buffer.append(line)
        flush()

    for topic in topics:
        topic["id"] = f"p{topic['part']}-" + hashlib.sha1((topic["region"] + topic["category"] + topic["title"]).encode()).hexdigest()[:10]
        for key in ("questions", "part3"):
            for idx, q in enumerate(topic.get(key, [])):
                q["id"] = topic["id"] + ("-q" if key == "questions" else "-p3-") + str(idx + 1)
                if topic["title"] == "Work or studies":
                    q["branch"] = "student" if idx < 12 else "worker"
    bank = {"version": "2026.10.22", "source": SOURCE.name,
            "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
            "source_note": "用户提供的备考题库，非 IELTS 官方发布试题。原题措辞保留，仅合并跨行并统一引号和问号。",
            "topics": topics}
    (ROOT / "data" / "question-bank.json").write_text(json.dumps(bank, ensure_ascii=False, indent=2), encoding="utf-8")
    for region in ("mainland", "overseas"):
        p1 = [t for t in topics if t["region"] == region and t["part"] == 1]
        p2 = [t for t in topics if t["region"] == region and t["part"] == 2]
        print(region, "P1 topics", len(p1), "questions", sum(len(t["questions"]) for t in p1), "P2", len(p2), "P3", sum(len(t["part3"]) for t in p2))
    assert len([t for t in topics if t["part"] == 1]) == 39
    assert len([t for t in topics if t["part"] == 2]) == 63
    assert all(t.get("questions") if t["part"] == 1 else t["prompt"] and len(t["bullets"]) >= 4 and t["part3"] for t in topics)
    assert not any("\ufffd" in json.dumps(t, ensure_ascii=False) for t in topics)


if __name__ == "__main__":
    import_bank()
