"""Speaking Room: local-only, dependency-free desktop web app."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import random
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
FROZEN = bool(getattr(sys, 'frozen', False))
APP_HOME = Path(sys.executable).resolve().parent if FROZEN else ROOT
DATA = APP_HOME / 'NotShyData' if FROZEN else ROOT / "data"
WEB = ROOT / "web"
VERSION = '1.3.1'
TOKEN = secrets.token_urlsafe(32)
LOCK = threading.RLock()
TTS_LOCK = threading.Lock()
BANK = json.loads((ROOT / "data" / "question-bank.json").read_text(encoding="utf-8"))
TOPICS = {t["id"]: t for t in BANK["topics"]}
QUESTION_TOPICS = {}
for topic in BANK["topics"]:
    for question in topic.get("questions", []) + topic.get("part3", []):
        QUESTION_TOPICS[question["id"]] = topic["id"]
    if topic["part"] == 2:
        QUESTION_TOPICS[topic["id"]] = topic["id"]
DB = DATA / "practice.sqlite3"


@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=15)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "recordings").mkdir(exist_ok=True)
    (DATA / "voice-cache").mkdir(exist_ok=True)
    with connect() as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, started REAL, updated REAL, payload TEXT);
        CREATE TABLE IF NOT EXISTS asked(session_id TEXT, question_id TEXT, topic_id TEXT, asked_at REAL,
          PRIMARY KEY(session_id, question_id));
        CREATE TABLE IF NOT EXISTS discarded(id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS single_practice(session_id TEXT, question_id TEXT, topic_id TEXT, happened REAL,
          PRIMARY KEY(session_id,question_id));
        CREATE TABLE IF NOT EXISTS exam_draws(session_id TEXT, question_id TEXT, topic_id TEXT, happened REAL,
          PRIMARY KEY(session_id,question_id));
        CREATE TABLE IF NOT EXISTS exam_completed(session_id TEXT, question_id TEXT, topic_id TEXT, happened REAL,
          PRIMARY KEY(session_id,question_id));
        """)
        # Rebuild derived progress from existing records without changing the originals.
        for row in db.execute("SELECT payload FROM sessions").fetchall():
            index_progress(db, json.loads(row[0]))


def index_progress(db, payload):
    sid = payload['id']
    for table in ('single_practice', 'exam_draws', 'exam_completed'):
        db.execute(f'DELETE FROM {table} WHERE session_id=?', (sid,))
    events = payload.get('events', [])
    def put(table, qid, happened):
        if qid in QUESTION_TOPICS:
            db.execute(f'INSERT OR IGNORE INTO {table} VALUES(?,?,?,?)',
                       (sid, qid, QUESTION_TOPICS[qid], happened))
    if payload.get('mode') == 'topic':
        for event in events:
            if event.get('answered'):
                qid = event.get('questionId')
                if qid in TOPICS and TOPICS[qid]['part'] == 2 and not any(e.get('stage') == 'talk' and e.get('answered') for e in events):
                    continue
                put('single_practice', qid, event.get('askedAt', payload.get('started', 0)))
        return
    for qid in payload.get('selection', []):
        put('exam_draws', qid, payload.get('started', 0))
    for event in events:
        qid = event.get('questionId')
        happened = event.get('askedAt', payload.get('started', 0))
        put('exam_draws', qid, happened)
        if payload.get('status') == 'completed' and event.get('answered'):
            put('exam_completed', qid, happened)


def usage():
    with connect() as db:
        return {r["question_id"]: {"count": r["n"], "last": r["last"]}
                for r in db.execute("SELECT question_id, COUNT(*) n, MAX(happened) last FROM single_practice GROUP BY question_id")}


def exam_metrics(field='question_id'):
    if field not in ('question_id', 'topic_id'):
        raise ValueError('Invalid progress grouping')
    result = {}
    with connect() as db:
        for table, key in (('exam_draws', 'drawn'), ('exam_completed', 'completed')):
            for row in db.execute(f'SELECT {field} id, COUNT(DISTINCT session_id) n, MAX(happened) last FROM {table} GROUP BY {field}'):
                item = result.setdefault(row['id'], {'drawn': 0, 'completed': 0, 'count': 0, 'last': 0})
                item[key] = row['n']
                if key == 'completed':
                    item['count'] = row['n']
                item['last'] = max(item['last'], row['last'])
    return result


def choose_plan(options, counts=None):
    mode = options.get("mode", "full")
    topic_counts = exam_metrics('topic_id') if mode == 'full' and counts is None else {}
    counts = counts if counts is not None else (exam_metrics() if mode == 'full' else usage())
    region = options.get("region", "mainland")
    pool = [t for t in BANK["topics"] if region == "all" or t["region"] == "mainland"]
    def score(qid):
        item = counts.get(qid, {})
        return item.get("count", 0), item.get('drawn', 0), item.get("last", 0), random.random()
    def topic_score(t):
        if mode == 'full' and t['id'] in topic_counts:
            item = topic_counts[t['id']]
            return item['completed'], item['drawn'], item['last'], random.random()
        if t["part"] == 2:
            return score(t["id"])
        qs = eligible_questions(t, options)
        return min((counts.get(q["id"], {}).get("count", 0) for q in qs), default=0), sum(counts.get(q["id"], {}).get('drawn', counts.get(q['id'], {}).get('count', 0)) for q in qs) / max(len(qs), 1), 0, random.random()
    p1 = sorted([t for t in pool if t["part"] == 1], key=topic_score)
    p2 = sorted([t for t in pool if t["part"] == 2], key=topic_score)
    chosen = options.get("topicId")
    if mode == "topic" and chosen in TOPICS:
        target = TOPICS[chosen]
        p1 = [target] if target["part"] == 1 else []
        p2 = [target] if target["part"] == 2 else []
    groups = []
    for t in p1:
        qs = eligible_questions(t, options)
        # Full exams ask up to four questions in each topic, consecutively.
        selected = sorted(qs, key=lambda q: score(q["id"]))[:4] if mode == "full" else qs
        selected_ids = {q["id"] for q in selected}
        groups.append({**t, "questions": [q for q in qs if q["id"] in selected_ids]})
    return {"part1": groups, "part2": p2[0] if p2 else None, "mode": mode,
            "type": options.get("type", "practice" if mode == "topic" else "exam")}


def eligible_questions(topic, options):
    return [q for q in topic.get("questions", []) if not q.get("branch") or q["branch"] == options.get("identity", "student")]


def save_session(payload):
    sid = str(payload.get("id", ""))
    if not re.fullmatch(r"[a-f0-9-]{36}", sid):
        raise ValueError("Invalid session ID")
    events = payload.get("events", [])
    if not isinstance(events, list) or len(events) > 500:
        raise ValueError("Too many events")
    if not isinstance(payload.get('selection', []), list) or len(payload.get('selection', [])) > 1000:
        raise ValueError('Invalid selection')
    now = time.time()
    with LOCK, connect() as db:
        if db.execute("SELECT 1 FROM discarded WHERE id=?", (sid,)).fetchone():
            raise ValueError("This session was discarded")
        db.execute("INSERT INTO sessions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,payload=excluded.payload",
                   (sid, payload.get("started", now), now, json.dumps(payload, ensure_ascii=False)))
        for event in events:
            qid = str(event.get("questionId", ""))
            if qid in QUESTION_TOPICS:
                db.execute("INSERT OR IGNORE INTO asked VALUES(?,?,?,?)", (sid, qid, QUESTION_TOPICS[qid], event.get("askedAt", now)))
        index_progress(db, payload)
    return sid


def discard_session(sid):
    if not re.fullmatch(r"[a-f0-9-]{36}", str(sid)):
        raise ValueError("Invalid session ID")
    recordings_root = (DATA / "recordings").resolve()
    folder = (recordings_root / sid).resolve()
    if folder.parent != recordings_root or not folder.is_relative_to(recordings_root):
        raise ValueError("Invalid recording directory")
    with LOCK:
        with connect() as db:
            # Tombstone rejects delayed autosaves and uploads from old windows.
            db.execute("INSERT OR IGNORE INTO discarded VALUES(?)", (sid,))
            db.execute("DELETE FROM asked WHERE session_id=?", (sid,))
            db.execute("DELETE FROM sessions WHERE id=?", (sid,))
            for table in ('single_practice', 'exam_draws', 'exam_completed'):
                db.execute(f'DELETE FROM {table} WHERE session_id=?', (sid,))
        if folder.exists():
            shutil.rmtree(folder)
    return sid


def voice_file(text, rate=0):
    text = text[:1600]
    rate = max(-3, min(3, int(rate)))
    key = hashlib.sha256((str(rate) + text).encode()).hexdigest()
    path = DATA / "voice-cache" / (key + ".wav")
    with TTS_LOCK:
        if path.exists():
            return path
        # Text is data on stdin; it never becomes PowerShell source.
        script = """
        Add-Type -AssemblyName System.Speech
        $taskData = [Console]::In.ReadToEnd() | ConvertFrom-Json
        $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
        try {
          $english = $speaker.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
          if (-not $english) { throw 'No English voice installed' }
          $speaker.SelectVoice($english.VoiceInfo.Name)
          $speaker.Rate = [int]$taskData.rate
          $speaker.SetOutputToWaveFile($taskData.path)
          $speaker.Speak([string]$taskData.text)
        } finally { $speaker.Dispose() }
        """
        import base64
        command = base64.b64encode(script.encode("utf-16le")).decode()
        powershell = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-EncodedCommand", command],
                                input=json.dumps({"text": text, "rate": rate, "path": str(path)}),
                                text=True, encoding="utf-8", capture_output=True, timeout=25,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode or not path.exists():
            path.unlink(missing_ok=True)
            raise RuntimeError("本机英文语音不可用，请在设置中使用浏览器语音。")
    return path


class Handler(BaseHTTPRequestHandler):
    server_version = "NotShy/" + VERSION

    def log_message(self, fmt, *args):
        pass

    def send_bytes(self, body, content_type, status=200):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def json_out(self, value, status=200):
        self.send_bytes(json.dumps(value, ensure_ascii=False).encode(), "application/json; charset=utf-8", status)

    def allowed_host(self):
        return self.headers.get("Host", "") in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

    def do_GET(self):
        if not self.allowed_host():
            return self.json_out({"error": "Invalid host"}, 403)
        route = urlsplit(self.path).path
        try:
            if route == "/api/health":
                return self.json_out({"app": "speaking-room", 'product': 'NotShy', "version": VERSION,
                                      'profile_id': hashlib.sha256(str(DATA.resolve()).encode()).hexdigest()[:16]})
            if route == "/api/bootstrap":
                return self.json_out({"token": TOKEN, "bank": BANK, "usage": usage(),
                                      'examUsage': exam_metrics(), 'examTopics': exam_metrics('topic_id'),
                                      'desktop': FROZEN, 'version': VERSION})
            if route == "/api/history":
                with connect() as db:
                    rows = db.execute("SELECT payload FROM sessions ORDER BY started DESC LIMIT 200").fetchall()
                return self.json_out([json.loads(r[0]) for r in rows])
            if route.startswith("/recordings/"):
                file = (DATA / route.lstrip("/")).resolve()
                if not file.is_relative_to((DATA / "recordings").resolve()) or not file.is_file():
                    return self.json_out({"error": "Not found"}, 404)
                return self.send_bytes(file.read_bytes(), "audio/webm" if file.suffix == ".webm" else "audio/mp4")
            relative = "index.html" if route == "/" else route.lstrip("/")
            file = (WEB / relative).resolve()
            if not file.is_relative_to(WEB.resolve()) or not file.is_file():
                return self.json_out({"error": "Not found"}, 404)
            ct = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml"}.get(file.suffix, mimetypes.guess_type(str(file))[0] or "application/octet-stream")
            return self.send_bytes(file.read_bytes(), ct + "; charset=utf-8")
        except Exception as exc:
            return self.json_out({"error": str(exc)}, 500)

    def do_POST(self):
        if not self.allowed_host() or self.headers.get("X-App-Token") != TOKEN:
            return self.json_out({"error": "Invalid application token; reload this window."}, 403)
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size < 32 * 1024 * 1024:
                raise ValueError("Invalid body size")
            route = urlsplit(self.path).path
            if route == "/api/audio":
                sid = self.headers.get("X-Session-Id", "")
                eid = self.headers.get("X-Event-Id", "")
                if not re.fullmatch(r"[a-f0-9-]{36}", sid) or not re.fullmatch(r"[a-f0-9-]{36}", eid):
                    raise ValueError("Invalid recording ID")
                audio_body = self.rfile.read(size)
                with LOCK:
                    with connect() as db:
                        if db.execute("SELECT 1 FROM discarded WHERE id=?", (sid,)).fetchone():
                            raise ValueError("This session was discarded")
                    folder = DATA / "recordings" / sid
                    folder.mkdir(exist_ok=True)
                    ext = ".mp4" if "mp4" in self.headers.get("Content-Type", "") else ".webm"
                    path = folder / (eid + ext)
                    temp = path.with_suffix(ext + ".tmp")
                    temp.write_bytes(audio_body)
                    temp.replace(path)
                return self.json_out({"url": "/recordings/" + sid + "/" + path.name})
            body = json.loads(self.rfile.read(size))
            if route == "/api/plan":
                return self.json_out(choose_plan(body))
            if route == "/api/session":
                return self.json_out({"id": save_session(body)})
            if route == "/api/discard":
                return self.json_out({"id": discard_session(body.get("id")), "discarded": True})
            if route == '/api/quit':
                self.json_out({'exiting': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if route == "/api/tts":
                path = voice_file(str(body.get("text", "")), body.get("rate", 0))
                return self.send_bytes(path.read_bytes(), "audio/wav")
            if route == "/api/backup":
                with connect() as db:
                    rows = [json.loads(r[0]) for r in db.execute("SELECT payload FROM sessions ORDER BY started")]
                return self.json_out({"app": "speaking-room", "version": 1, "exported": time.time(), "sessions": rows})
            return self.json_out({"error": "Not found"}, 404)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return self.json_out({"error": str(exc)}, 400)
        except Exception as exc:
            return self.json_out({"error": str(exc)}, 500)


class LocalHTTPServer(ThreadingHTTPServer):
    # Windows otherwise permits two SO_REUSEADDR listeners on the same address.
    allow_reuse_address = False

    def server_bind(self):
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def open_app(port):
    url = f"http://127.0.0.1:{port}"
    edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    if edge.exists():
        subprocess.Popen([str(edge), "--app=" + url], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    else:
        webbrowser.open(url)


def main():
    global DATA, DB
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int)
    parser.add_argument("--open", action="store_true")
    parser.add_argument('--no-open', action='store_true', help='Do not open the app window')
    parser.add_argument('--no-tray', action='store_true', help='Do not start the Windows tray icon')
    parser.add_argument("--data-dir", type=Path, help="Separate data directory for testing or another profile")
    args = parser.parse_args()
    if args.data_dir:
        DATA = args.data_dir.resolve()
        DB = DATA / 'practice.sqlite3'
    try:
        init_db()
    except PermissionError:
        if not FROZEN or args.data_dir:
            raise
        DATA = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'NotShy' / 'data'
        DB = DATA / 'practice.sqlite3'
        init_db()
    if sys.stdout is None:
        sys.stdout = (DATA / 'server.log').open('a', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = (DATA / 'server-error.log').open('a', encoding='utf-8')
    port = args.port if args.port is not None else (8767 if FROZEN else 8765)
    show_window = (args.open or FROZEN) and not args.no_open
    attempts = 20 if FROZEN and args.port is None else 1
    profile_id = hashlib.sha256(str(DATA.resolve()).encode()).hexdigest()[:16]
    server = None
    for candidate_port in range(port, port + attempts):
        try:
            server = LocalHTTPServer(('127.0.0.1', candidate_port), Handler)
            break
        except OSError:
            import http.client
            connection = None
            try:
                # Loopback checks must not be routed through Windows/HTTP proxies.
                connection = http.client.HTTPConnection('127.0.0.1', candidate_port, timeout=2)
                connection.request('GET', '/api/health')
                response = connection.getresponse()
                health = json.load(response)
                if health.get('app') == 'speaking-room' and health.get('profile_id') == profile_id:
                    if show_window:
                        open_app(candidate_port)
                    return
            except Exception:
                pass
            finally:
                if connection:
                    connection.close()
    if server is None:
        raise RuntimeError(f'端口 {port} 已被占用，请使用 --port 指定其他端口。')
    actual_port = server.server_port
    print(f'NotShy {VERSION} running at http://127.0.0.1:{actual_port}', flush=True)
    tray = None
    if FROZEN and not args.no_tray:
        from desktop_app import start_tray
        tray = start_tray(server, lambda: open_app(actual_port))
    if show_window:
        open_app(actual_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if tray:
            tray.stop()


if __name__ == "__main__":
    main()
