"""Double-click launcher for the Beihan Customer Feedback Workbench."""

import errno
import hashlib
import hmac
import http.client
import json
import os
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing
from pathlib import Path
from threading import Thread

# Isolated and Windows embedded Python omit the script directory from sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from portable_state import LocalHandler as PortableHandler
from server import Accounts, WorkbenchServer


HOST = "127.0.0.1"
FIRST_PORT = 18765
PROBE = "/_local/instance/"
LOGIN_NOTE = "首次登录.txt"


def data_directory():
    override = os.environ.get("BEIHAN_FEEDBACK_DATA_DIR")
    if override:
        path = Path(override)
        if not path.is_absolute():
            raise ValueError("数据目录须使用绝对路径。")
        return path
    if os.name == "nt":
        root = Path(os.environ["LOCALAPPDATA"])
    else:
        root = Path.home() / "Library" / "Application Support"
    return root / "Beihan" / "CustomerFeedback"


def atomic_text(path, text):
    # Same-directory replace keeps the previous complete file after a failed write.
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, delete=False) as handle:
            tmp = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def try_lock(stream):
    try:
        if os.name == "nt":
            import msvcrt
            # Windows supports locking one byte beyond EOF in an empty file.
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError as error:
        if error.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
            return False
        raise


def open_browser(url):
    if os.environ.get("BEIHAN_FEEDBACK_NO_BROWSER") == "1":
        return
    try:
        if os.name == "nt":
            os.startfile(url)
        else:
            subprocess.run(["/usr/bin/open", url], check=True, timeout=16)
        print("已将访问地址发送到系统默认浏览器。", flush=True)
    except (OSError, subprocess.SubprocessError):
        print("请复制上面的访问地址到浏览器。", flush=True)


def digest(key, challenge):
    return hmac.new(key, challenge.encode("ascii"), hashlib.sha256).hexdigest()


class LocalHandler(PortableHandler):
    def get(self, path):
        if path.startswith(PROBE):
            challenge = path[len(PROBE):]
            if len(challenge) == 32 and all(c in "0123456789abcdef" for c in challenge):
                proof = digest(self.server.instance_key, challenge)
                self.response(200, proof.encode("ascii"), "text/plain")
                return
        super().get(path)


class LocalServer(WorkbenchServer):
    allow_reuse_port = False
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def active_url(state_path):
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        port, key = state["port"], bytes.fromhex(state["key"])
        if type(port) is not int or not 1 <= port <= 65535 or len(key) != 32:
            return None
        challenge = secrets.token_hex(16)
        # No OS proxy or redirect. The on-disk key never goes on the wire.
        with closing(http.client.HTTPConnection(HOST, port, timeout=0.4)) as connection:
            connection.request("GET", PROBE + challenge)
            reply = connection.getresponse()
            if reply.status == 200 and hmac.compare_digest(
                reply.read(65), digest(key, challenge).encode("ascii")
            ):
                return f"http://{HOST}:{port}/"
    except (OSError, http.client.HTTPException, KeyError, TypeError, ValueError):
        pass
    return None


def read_ports(settings):
    if not settings.exists():
        return None, None
    port_data = json.loads(settings.read_text(encoding="utf-8"))
    primary = port_data["primary"]
    fallback = port_data.get("fallback")
    for port in [primary] + ([fallback] if fallback is not None else []):
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError("本地启动设置的端口无效。请保留数据目录，并核对 ports.json。")
    return primary, fallback


def bind_server(primary, fallback):
    for port in dict.fromkeys((primary or FIRST_PORT, fallback, 0)):
        if port is None:
            continue
        try:
            return LocalServer(HOST, port, "", None)
        except OSError as error:
            # Windows can report WSAEACCES when another service owns a port exclusively.
            occupied = error.errno == errno.EADDRINUSE or getattr(error, "winerror", None) in (10013, 10048)
            if port == 0 or not occupied:
                raise


def existing_admin(db):
    if not db.is_file():
        return False
    with closing(sqlite3.connect(db)) as connection:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").fetchone():
            return False
        return bool(connection.execute("SELECT 1 FROM users WHERE role='admin' LIMIT 1").fetchone())


def prepare_accounts(directory):
    db = directory / "auth.sqlite3"
    note = directory / LOGIN_NOTE
    if existing_admin(db):
        # Accounts only consults the seed password if the database has no administrator.
        return Accounts(db, "admin", secrets.token_bytes(32)), None
    if note.exists():
        lines = note.read_text(encoding="utf-8-sig").splitlines()
        choices = [line.removeprefix("密码：") for line in lines if line.startswith("密码：")]
        if len(choices) != 1 or len(choices[0]) < 20:
            raise ValueError(f"初始登录资料无法读取，请核对 {note}。")
        password = choices[0]
    else:
        password = secrets.token_urlsafe(24)
        atomic_text(note, "\ufeff贝翰战略咨询 · 客户反馈工作台\n账号：admin\n密码：" + password
                    + "\n\n请把密码收存在密码管理器中，之后可删除此文件。\n")
    # Write the login note before committing SQLite, so interruption is recoverable.
    return Accounts(db, "admin", password.encode("utf-8")), password


def run():
    os.umask(0o077)
    directory = data_directory()
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    active = directory / "active.json"
    settings = directory / "ports.json"
    with open(directory / "instance.lock", "a+b") as lock:
        if not try_lock(lock):
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                url = active_url(active)
                if url:
                    print(f"工作台已经运行。访问地址：{url}", flush=True)
                    open_browser(url)
                    return
                time.sleep(0.15)
                if try_lock(lock):
                    break
            else:
                raise RuntimeError("另一个启动窗口正在使用数据目录。请检查该窗口，或关闭它后重新双击。")
        primary, fallback = read_ports(settings)
        with bind_server(primary, fallback) as service:
            accounts, password = prepare_accounts(directory)
            service.accounts = accounts
            service.RequestHandlerClass = LocalHandler
            service.instance_key = secrets.token_bytes(32)
            service.portable_directory = directory
            location = os.fsencode(directory.resolve())
            service.profile_cookie_name = "beihan_profile_" + hashlib.sha256(location).hexdigest()[:16]
            port = service.server_port
            primary = primary or port
            if port != primary:
                fallback = port
            atomic_text(settings, json.dumps({"primary": primary, "fallback": fallback}))
            try:
                atomic_text(active, json.dumps({"port": port, "key": service.instance_key.hex()}))
                url = f"http://{HOST}:{port}/"
                print(f"\n贝翰战略咨询 · 客户反馈工作台\n访问地址：{url}\n本机数据目录：{directory}", flush=True)
                if port != primary:
                    print(f"原端口 {primary} 被占用，本次使用备用地址。同一浏览器登录原账号后可恢复已同步的本地项目。\n"
                          f"下次启动时将再次尝试原端口 {primary}。", flush=True)
                if password:
                    print(f"\n首次登录\n账号：admin\n密码：{password}", flush=True)
                note = directory / LOGIN_NOTE
                if note.exists():
                    print(f"初始登录资料：{note}", flush=True)
                print("\n请保留此窗口。关闭窗口或按 Ctrl+C 可停止服务。下次双击同一启动文件即可重新打开。", flush=True)
                Thread(target=open_browser, args=(url,), daemon=True).start()
                service.serve_forever()
            finally:
                active.unlink(missing_ok=True)


if __name__ == "__main__":
    for output in (sys.stdout, sys.stderr):
        if output is not None:
            output.reconfigure(encoding="utf-8", errors="replace")
    try:
        run()
    except KeyboardInterrupt:
        print("\n工作台已关闭。", flush=True)
    except (OSError, sqlite3.Error, KeyError, ValueError, RuntimeError) as error:
        print(f"启动失败：{error}", file=sys.stderr, flush=True)
        sys.exit(1)
