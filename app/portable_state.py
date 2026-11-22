"""Local release only. Keep a same-browser, per-account recovery copy across ports."""
import hashlib
import json
import re
import secrets
import sqlite3
from contextlib import closing
from http import HTTPStatus
from http.cookies import SimpleCookie
from urllib.parse import unquote

from server import APP_ROOT, SESSION_COOKIE, RequestError, WorkbenchHandler

ROUTE = "/api/local-workspace"
MAX_BYTES = 32 * 1024 * 1024


class LocalHandler(WorkbenchHandler):
    def cookie_value(self, name):
        cookies = SimpleCookie(self.headers.get("Cookie", ""))
        value = cookies[name].value if name in cookies else ""
        return value if re.fullmatch(r"[a-zA-Z0-9_-]{43}", value) else ""

    def token(self):
        return self.cookie_value(self.server.profile_cookie_name + "_session")

    def session_cookie(self, token):
        original = super().session_cookie(token)
        return original.replace(SESSION_COOKIE + "=", self.server.profile_cookie_name + "_session=", 1)

    def html(self, name):
        if name != "workspace.html":
            return super().html(name)
        html = (APP_ROOT / name).read_bytes().replace(
            b"<head>", b'<head>\n  <meta name="local-port-recovery" content="1">', 1
        )
        self.response(HTTPStatus.OK, html, "text/html; charset=utf-8")

    def get(self, path):
        if path != ROUTE:
            return super().get(path)
        self.local_workspace(write=False)

    def post(self, path):
        if path != ROUTE:
            return super().post(path)
        self.local_workspace(write=True)

    def local_workspace(self, write):
        account = self.server.accounts.session(self.token())
        if not account or unquote(self.headers.get("X-Workspace-Account", "")) != account["username"]:
            raise RequestError(HTTPStatus.UNAUTHORIZED, "login_required")
        username = account["username"].casefold()
        name = self.server.profile_cookie_name
        profile = self.cookie_value(name)
        if write and not profile:
            raise RequestError(HTTPStatus.CONFLICT, "reload_workspace")
        if not profile:
            profile = secrets.token_urlsafe(32)
        # Only its digest is stored on disk. The HttpOnly browser cookie follows 127.0.0.1 across ports.
        key = hashlib.sha256(profile.encode("ascii")).hexdigest()
        if write:
            lengths = self.headers.get_all("Content-Length", [])
            if (self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding")
                    or len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,8}", lengths[0])
                    or not 0 < int(lengths[0]) <= MAX_BYTES):
                raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_workspace")
            raw = self.rfile.read(int(lengths[0]))
            data = json.loads(raw.decode("utf-8"))
            if not (isinstance(data, dict) and isinstance(data.get("projects"), list)
                    and isinstance(data.get("demos"), dict) and isinstance(data.get("active"), str)):
                raise RequestError(HTTPStatus.BAD_REQUEST, "invalid_workspace")
            digest = hashlib.sha256(raw).hexdigest()
        file = self.server.portable_directory / "workspace-recovery.sqlite3"
        with closing(sqlite3.connect(file, timeout=5)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS workspaces (profile TEXT, username TEXT, revision TEXT NOT NULL,"
                       " content BLOB NOT NULL, PRIMARY KEY(profile, username))")
            if write:
                db.execute("BEGIN IMMEDIATE")
            stored = db.execute("SELECT revision,content FROM workspaces WHERE profile=? AND username=?",
                                (key, username)).fetchone()
            revision = stored[0] if stored else ""
            if write:
                if digest != revision:
                    if self.headers.get("X-Workspace-Revision") != revision:
                        raise RequestError(HTTPStatus.CONFLICT, "reload_workspace")
                    db.execute("INSERT OR REPLACE INTO workspaces VALUES (?,?,?,?)",
                               (key, username, digest, raw))
                response = {"revision": digest}
            else:
                response = {"revision": revision, "state": json.loads(stored[1]) if stored else None}
        cookie = SimpleCookie({name: profile})
        cookie[name]["path"] = ROUTE
        cookie[name]["httponly"] = True
        cookie[name]["samesite"] = "Strict"
        cookie[name]["max-age"] = 34560000
        self.json_response(HTTPStatus.OK, response, cookie=cookie[name].OutputString())
