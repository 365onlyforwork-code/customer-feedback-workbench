"""Smoke-test the extracted Windows release through its customer .cmd launcher."""
import contextlib
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
from urllib.error import HTTPError, URLError
from urllib.request import build_opener, HTTPCookieProcessor, ProxyHandler, Request

LAUNCHER = None
ARCH = None


def client():
    return build_opener(ProxyHandler({}), HTTPCookieProcessor(http.cookiejar.CookieJar()))


def http(opener, url, data=None, extra=None):
    request = Request(url, headers=extra or {})
    if data is not None:
        request.add_header("Content-Type", "application/json")
        request.data = json.dumps(data).encode("utf-8")
    with opener.open(request, timeout=4) as response:
        body = response.read()
        return json.loads(body) if "application/json" in response.headers.get("Content-Type", "") else body


@contextlib.contextmanager
def service(data_dir):
    # Use exactly the command processor and working directory Explorer supplies on double-click.
    comspec = os.environ["COMSPEC"]
    command = f'"{comspec}" /d /s /c ""{LAUNCHER.name}""'
    env = {**os.environ, "BEIHAN_FEEDBACK_DATA_DIR": str(data_dir), "BEIHAN_FEEDBACK_NO_BROWSER": "1"}
    proc = subprocess.Popen(command, cwd=LAUNCHER.parent, env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(120):
            if proc.poll() is not None:
                raise AssertionError(f"Launcher exited with code {proc.returncode}")
            try:
                active = json.loads((data_dir / "active.json").read_text(encoding="utf-8"))
                origin = f"http://127.0.0.1:{active['port']}"
                if http(client(), origin + "/api/session") == {"user": None}:
                    break
            except (OSError, ValueError, KeyError, URLError):
                pass
            time.sleep(0.25)
        else:
            raise AssertionError("Local service did not become available")
        # Check the actual listening process uses the bundled architecture and binds only loopback.
        check = """
        $ErrorActionPreference = 'Stop'
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $env:QA_PORT)
        if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') { exit 8 }
        $exe = (Get-Process -Id $listeners[0].OwningProcess).Path
        if ($exe -ne $env:QA_INTERPRETER) { exit 9 }
        """
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", check],
                       env={**env, "QA_PORT": str(active["port"]), "QA_INTERPRETER": sys.executable}, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        yield origin
    finally:
        if proc.poll() is None:
            subprocess.run(["taskkill.exe", "/PID", str(proc.pid), "/T", "/F"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        proc.wait(timeout=15)


def test(data_dir):
    admin = client()
    member = {"username": "release_qa", "password": secrets.token_urlsafe(18)}
    headers = {"X-Workspace-Account": "admin"}
    fixture = {"active": "release-test", "demos": {}, "projects": [{"id": "release-test", "name": "本地验收"}]}
    # Reserve an ephemeral preferred port before starting. This avoids TIME_WAIT
    # differences while exercising a real bind conflict and a later origin change.
    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        preferred = occupied.getsockname()[1]
        (data_dir / "ports.json").write_text(json.dumps({"primary": preferred}), encoding="utf-8")
        with service(data_dir) as url:
            assert int(url.rsplit(":", 1)[1]) != preferred
            assert "登录".encode() in http(admin, url + "/")
            note = (data_dir / "首次登录.txt").read_text(encoding="utf-8-sig")
            password = next(line[3:] for line in note.splitlines() if line.startswith("密码："))
            assert len(password) >= 20 and password != "admin"
            account = {"username": "admin", "password": password}
            assert http(admin, url + "/api/login", account)["user"]["role"] == "admin"
            assert "客户反馈工作台".encode() in http(admin, url + "/workspace.html")
            assert http(client(), url + "/api/register", member)["user"]["status"] == "pending"
            try:
                http(client(), url + "/api/login", member)
            except HTTPError as error:
                assert error.code == 403
            else:
                raise AssertionError("Pending account could sign in")
            assert http(admin, url + "/api/admin/approve", {"username": member["username"]})["user"]["status"] == "approved"
            state = http(admin, url + "/api/local-workspace", extra=headers)
            assert state["state"] is None
            new = http(admin, url + "/api/local-workspace", fixture, {**headers, "X-Workspace-Revision": state["revision"]})
            assert new["revision"]
    with service(data_dir) as restarted:
        assert int(restarted.rsplit(":", 1)[1]) == preferred
        assert restarted != url
        assert http(admin, restarted + "/api/login", account)["user"]["role"] == "admin"
        assert http(client(), restarted + "/api/login", member)["user"]["role"] == "member"
        assert http(admin, restarted + "/api/local-workspace", extra=headers)["state"] == fixture
        assert note == (data_dir / "首次登录.txt").read_text(encoding="utf-8-sig")
        with contextlib.closing(sqlite3.connect(data_dir / "auth.sqlite3")) as db:
            assert db.execute("SELECT count(*) FROM users WHERE status='approved'").fetchone()[0] == 2
    print(f"PASS native Windows {ARCH}: bundled launcher, loopback, account approval, workspace recovery on a new port.")


if __name__ == "__main__":
    try:
        LAUNCHER = Path(sys.argv[1]).resolve()
        ARCH = sys.argv[2]
        assert ARCH in ("x64", "arm64")
        assert os.name == "nt" and LAUNCHER.name == "Start 客户反馈工作台.cmd"
        assert Path(sys.executable).resolve() == (LAUNCHER.parent / "runtime" / ARCH / "python.exe").resolve()
        with tempfile.TemporaryDirectory(prefix="beihan-release-") as temporary:
            test(Path(temporary))
    except Exception as error:
        # HTTP bodies, command lines and absolute paths can contain local identifiers.
        frame = next(frame for frame in reversed(traceback.extract_tb(error.__traceback__))
                     if Path(frame.filename).name == Path(__file__).name)
        print(f"FAIL {type(error).__name__} in {frame.name}, test line {frame.lineno}.", file=sys.stderr)
        sys.exit(1)
