"""Serve the workbench and its local, administrator-approved accounts."""

import argparse
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import sqlite3
import time
import unicodedata
from collections import deque
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import unquote, urlsplit


APP_ROOT = Path(__file__).resolve().parent
DEFAULT_DB = APP_ROOT.parent / ".customer-feedback-state" / "auth.sqlite3"
SESSION_COOKIE = "feedback_session"
SESSION_SECONDS = 12 * 60 * 60
MAX_JSON_BYTES = 4096
PBKDF2_ROUNDS = 600_000
ASSET_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


class RequestError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def checked_username(value):
    value = unicodedata.normalize("NFKC", value.strip()) if isinstance(value, str) else ""
    if (
        not 3 <= len(value) <= 40
        or not value[0].isalnum()
        or not all(character.isalnum() or character in "._-" for character in value)
    ):
        raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_username")
    return value


def checked_password(value, min_length=8):
    if not isinstance(value, str) or not min_length <= len(value) <= 128:
        raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_password")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_password") from error
    if len(encoded) > 512:
        raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_password")
    return encoded


def make_password_hash(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password, salt, PBKDF2_ROUNDS)
    return "%d:%s:%s" % (PBKDF2_ROUNDS, salt.hex(), digest.hex())


def check_password(password, stored):
    rounds, salt, digest = stored.split(":")
    actual = hashlib.pbkdf2_hmac("sha256", password, bytes.fromhex(salt), int(rounds))
    return hmac.compare_digest(actual, bytes.fromhex(digest))


def now_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def token_digest(token):
    return hashlib.sha256(token.encode("ascii")).digest()


def public_user(record, detailed=False):
    user = {"username": record["username"], "role": record["role"]}
    if detailed:
        user.update(status=record["status"], createdAt=record["created_at"])
    return user


class Accounts:
    def __init__(self, path, admin_username, admin_password, public_deployment=False):
        self.path = path
        self.dummy_password = make_password_hash(secrets.token_bytes(32))
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.database() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    username_key TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
                    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash BLOB PRIMARY KEY,
                    username_key TEXT NOT NULL REFERENCES users(username_key) ON DELETE CASCADE,
                    expires INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires);
            """)
            db.execute("BEGIN IMMEDIATE")
            admins = db.execute("SELECT password_hash FROM users WHERE role = 'admin'").fetchall()
            if public_deployment and (
                (not admins and admin_password == b"admin")
                or any(check_password(b"admin", row["password_hash"]) for row in admins)
            ):
                raise ValueError(
                    "For HTTPS deployment, initialize a new database with a non-default FEEDBACK_ADMIN_PASSWORD "
                    "or use a database that already has a non-default administrator password."
                )
            if not admins:
                db.execute(
                    "INSERT INTO users VALUES (?, ?, ?, 'admin', 'approved', ?)",
                    (admin_username.casefold(), admin_username, make_password_hash(admin_password), now_utc()),
                )
            db.execute("DELETE FROM sessions WHERE expires <= ?", (int(time.time()),))

    @contextmanager
    def database(self):
        with closing(sqlite3.connect(self.path, timeout=5)) as db, db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            yield db

    def register(self, username, password):
        created = now_utc()
        with self.database() as db:
            if db.execute("SELECT 1 FROM users WHERE username_key = ?", (username.casefold(),)).fetchone():
                raise RequestError(HTTPStatus.CONFLICT, "username_taken")
            digest = make_password_hash(password)
            inserted = db.execute(
                "INSERT OR IGNORE INTO users VALUES (?, ?, ?, 'member', 'pending', ?)",
                (username.casefold(), username, digest, created),
            )
            if inserted.rowcount != 1:
                raise RequestError(HTTPStatus.CONFLICT, "username_taken")
        return {"username": username, "role": "member", "status": "pending", "createdAt": created}

    def login(self, username, password, old_token):
        with self.database() as db:
            user = db.execute("SELECT * FROM users WHERE username_key = ?", (username.casefold(),)).fetchone()
            matched = check_password(password, user["password_hash"] if user else self.dummy_password)
            if not user or not matched:
                raise RequestError(HTTPStatus.UNAUTHORIZED, "invalid_credentials")
            if user["status"] != "approved":
                code = "pending_approval" if user["status"] == "pending" else "account_rejected"
                raise RequestError(HTTPStatus.FORBIDDEN, code)
            now = int(time.time())
            token = secrets.token_urlsafe(32)
            db.execute("DELETE FROM sessions WHERE expires <= ?", (now,))
            if old_token:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(old_token),))
            db.execute(
                "INSERT INTO sessions VALUES (?, ?, ?)",
                (token_digest(token), user["username_key"], now + SESSION_SECONDS),
            )
        return public_user(user), token

    def session(self, token):
        if not token:
            return None
        with self.database() as db:
            user = db.execute(
                """
                SELECT users.username, users.role
                FROM sessions JOIN users USING (username_key)
                WHERE sessions.token_hash = ? AND sessions.expires > ? AND users.status = 'approved'
                """,
                (token_digest(token), int(time.time())),
            ).fetchone()
        return public_user(user) if user else None

    def logout(self, token):
        if token:
            with self.database() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_digest(token),))

    def user_list(self):
        with self.database() as db:
            return [
                public_user(user, detailed=True)
                for user in db.execute(
                    "SELECT username, role, status, created_at FROM users "
                    "ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC, username_key"
                )
            ]

    def approve(self, username):
        with self.database() as db:
            key = username.casefold()
            db.execute("BEGIN IMMEDIATE")
            user = db.execute("SELECT * FROM users WHERE username_key = ?", (key,)).fetchone()
            if not user:
                raise RequestError(HTTPStatus.NOT_FOUND, "user_not_found")
            if user["status"] == "rejected":
                raise RequestError(HTTPStatus.CONFLICT, "already_rejected")
            if user["status"] == "pending":
                db.execute("UPDATE users SET status = 'approved' WHERE username_key = ?", (key,))
        return {**public_user(user, detailed=True), "status": "approved"}


class WorkbenchServer(ThreadingHTTPServer):
    def __init__(self, host, port, public_origin, accounts):
        if ":" in host:
            self.address_family = socket.AF_INET6
        super().__init__((host, port), WorkbenchHandler)
        self.accounts = accounts
        self.public_origin = public_origin
        self.secure_cookie = public_origin.startswith("https://")
        self._attempts = {}
        self._attempt_lock = Lock()
        if public_origin:
            self.allowed_hosts = {urlsplit(public_origin).netloc}
        else:
            actual_port = self.server_port
            names = {formatted_host(host), "127.0.0.1", "localhost"}
            self.allowed_hosts = {f"{name}:{actual_port}" for name in names}
            if actual_port == 80:
                self.allowed_hosts.update(names)

    def check_attempt(self, address, action):
        now = time.monotonic()
        limit = 12 if action == "register" else 30
        with self._attempt_lock:
            cutoff = now - 300
            if len(self._attempts) > 256:
                self._attempts = {key: recent for key, recent in self._attempts.items() if recent[-1] > cutoff}
            recent = self._attempts.setdefault((action, address), deque())
            while recent and recent[0] <= cutoff:
                recent.popleft()
            if len(recent) >= limit:
                raise RequestError(HTTPStatus.TOO_MANY_REQUESTS, "rate_limited")
            recent.append(now)


class WorkbenchHandler(BaseHTTPRequestHandler):
    server_version = "FeedbackWorkbench"
    sys_version = ""
    timeout = 15

    def do_GET(self):
        self.handle_route()

    def do_HEAD(self):
        self.handle_route()

    def do_POST(self):
        self.handle_route()

    def handle_route(self):
        try:
            host_headers = self.headers.get_all("Host", [])
            host = host_headers[0].lower() if len(host_headers) == 1 else ""
            if host not in self.server.allowed_hosts:
                raise RequestError(HTTPStatus.FORBIDDEN, "request_blocked")
            path = unquote(urlsplit(self.path).path)
            if self.command == "POST":
                self.check_origin(host)
                self.post(path)
            else:
                self.get(path)
        except RequestError as error:
            self.json_response(error.status, {"error": error.code})
        except (sqlite3.Error, OSError) as error:
            if isinstance(error, (BrokenPipeError, ConnectionResetError)):
                return
            self.log_error("Request failed (%s)", type(error).__name__)
            self.json_response(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "server_error"})
        except ValueError:
            self.json_response(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})

    def check_origin(self, host):
        expected = self.server.public_origin or "http://" + host
        origin = self.headers.get("Origin")
        if (origin is not None and origin != expected) or self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise RequestError(HTTPStatus.FORBIDDEN, "request_blocked")

    def token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        token = cookie[SESSION_COOKIE].value if SESSION_COOKIE in cookie else ""
        if len(token) == 43 and all(character.isascii() and (character.isalnum() or character in "_-") for character in token):
            return token
        return None

    def require_admin(self):
        user = self.server.accounts.session(self.token())
        if not user:
            raise RequestError(HTTPStatus.UNAUTHORIZED, "login_required")
        if user["role"] != "admin":
            raise RequestError(HTTPStatus.FORBIDDEN, "admin_required")

    def payload(self):
        if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
            raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_request")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or len(lengths[0]) > 5 or not lengths[0].isascii() or not lengths[0].isdigit():
            raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_request")
        length = int(lengths[0])
        if not 1 <= length <= MAX_JSON_BYTES:
            raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_request")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, RecursionError) as error:
            raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_request") from error
        if not isinstance(payload, dict):
            raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_request")
        return payload

    def get(self, path):
        accounts = self.server.accounts
        if path == "/api/session":
            self.json_response(HTTPStatus.OK, {"user": accounts.session(self.token())})
        elif path == "/api/admin/users":
            self.require_admin()
            self.json_response(HTTPStatus.OK, {"users": accounts.user_list()})
        elif path in ("/", "/index.html"):
            self.html("index.html")
        elif path in ("/workspace", "/workspace/", "/workspace.html"):
            if not accounts.session(self.token()):
                self.response(HTTPStatus.SEE_OTHER, b"", "text/plain", location="/?next=workspace")
            elif path == "/workspace/":
                self.response(HTTPStatus.SEE_OTHER, b"", "text/plain", location="/workspace.html")
            else:
                self.html("workspace.html")
        elif path in ("/admin", "/admin/", "/admin.html"):
            user = accounts.session(self.token())
            if not user:
                self.response(HTTPStatus.SEE_OTHER, b"", "text/plain", location="/?next=admin")
            elif user["role"] != "admin":
                self.response(HTTPStatus.SEE_OTHER, b"", "text/plain", location="/workspace.html")
            elif path == "/admin/":
                self.response(HTTPStatus.SEE_OTHER, b"", "text/plain", location="/admin.html")
            else:
                self.html("admin.html")
        elif path.startswith("/assets/"):
            self.asset(path)
        else:
            raise RequestError(HTTPStatus.NOT_FOUND, "not_found")

    def post(self, path):
        accounts = self.server.accounts
        if path in ("/api/register", "/api/login"):
            action = path.rsplit("/", 1)[-1]
            payload = self.payload()
            self.server.check_attempt(self.client_address[0], action)
            if action == "register":
                username = checked_username(payload.get("username"))
                password = checked_password(payload.get("password"))
                self.json_response(HTTPStatus.CREATED, {"user": accounts.register(username, password)})
            else:
                try:
                    username = checked_username(payload.get("username"))
                    password = checked_password(payload.get("password"), min_length=1)
                except RequestError as error:
                    raise RequestError(HTTPStatus.UNAUTHORIZED, "invalid_credentials") from error
                user, token = accounts.login(username, password, self.token())
                self.json_response(HTTPStatus.OK, {"user": user}, cookie=self.session_cookie(token))
        elif path == "/api/logout":
            self.payload()
            accounts.logout(self.token())
            self.json_response(HTTPStatus.OK, {"user": None}, cookie=self.session_cookie(""))
        elif path == "/api/admin/approve":
            self.require_admin()
            username = checked_username(self.payload().get("username"))
            self.json_response(HTTPStatus.OK, {"user": accounts.approve(username)})
        else:
            raise RequestError(HTTPStatus.NOT_FOUND, "not_found")

    def html(self, name):
        self.response(HTTPStatus.OK, (APP_ROOT / name).read_bytes(), "text/html; charset=utf-8")

    def asset(self, path):
        root = APP_ROOT / "assets"
        target = (APP_ROOT / path.lstrip("/")).resolve()
        content_type = ASSET_TYPES.get(target.suffix.lower())
        if not target.is_relative_to(root) or not content_type or not target.is_file():
            raise RequestError(HTTPStatus.NOT_FOUND, "not_found")
        self.response(HTTPStatus.OK, target.read_bytes(), content_type, cache="no-cache")

    def session_cookie(self, token):
        cookie = SimpleCookie({SESSION_COOKIE: token})
        properties = cookie[SESSION_COOKIE]
        properties["path"] = "/"
        properties["httponly"] = True
        properties["samesite"] = "Strict"
        properties["max-age"] = SESSION_SECONDS if token else 0
        if self.server.secure_cookie:
            properties["secure"] = True
        return properties.OutputString()

    def json_response(self, status, payload, cookie=None):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.response(status, content, "application/json; charset=utf-8", cookie=cookie)

    def response(self, status, content, content_type, cache="no-store", cookie=None, location=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
        )
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        if location is not None:
            self.send_header("Location", location)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(content)


def formatted_host(host):
    return f"[{host.lower()}]" if ":" in host else host.lower()


def configured_origin(value):
    if not value:
        return ""
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("FEEDBACK_PUBLIC_ORIGIN must be an HTTPS origin such as https://feedback.example.com")
    port = parsed.port
    host = formatted_host(parsed.hostname)
    return "https://" + host + (f":{port}" if port and port != 443 else "")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", type=Path, default=Path(os.environ.get("FEEDBACK_DATABASE", DEFAULT_DB)))
    args = parser.parse_args()
    try:
        origin = configured_origin(os.environ.get("FEEDBACK_PUBLIC_ORIGIN", ""))
        loopback = args.host == "localhost" or ipaddress.ip_address(args.host).is_loopback
        admin = checked_username(os.environ.get("FEEDBACK_ADMIN_USERNAME", "admin"))
        password = checked_password(os.environ.get("FEEDBACK_ADMIN_PASSWORD"), min_length=1)
    except (ValueError, RequestError) as error:
        parser.error(str(error))
    if not loopback and not origin:
        parser.error("For non-loopback binding, set FEEDBACK_PUBLIC_ORIGIN and use an HTTPS reverse proxy.")
    os.umask(0o077)
    try:
        accounts = Accounts(args.db.expanduser().resolve(), admin, password, public_deployment=bool(origin))
    except ValueError as error:
        parser.error(str(error))
    try:
        with WorkbenchServer(args.host, args.port, origin, accounts) as server:
            local_url = f"http://{formatted_host(args.host)}:{server.server_port}"
            print(f"Feedback Workbench at {origin or local_url}", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    import sys

    if len(sys.argv) == 1 and not os.environ.get("FEEDBACK_ADMIN_PASSWORD"):
        import runpy
        runpy.run_path(str(Path(__file__).with_name("local_start.py")), run_name="__main__")
    else:
        main()
