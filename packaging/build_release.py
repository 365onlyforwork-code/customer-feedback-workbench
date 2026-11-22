"""Assemble an offline customer release from a verified, unpacked platform runtime."""
import argparse
import os
import re
import shutil
import stat
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

PRODUCT = "客户反馈工作台"
ROOT = Path(__file__).resolve().parents[1]
EXCLUDE = {".DS_Store", "Thumbs.db", "__MACOSX", ".git", "__pycache__", "node_modules"}
APP_FILES = ["server.py", "local_start.py", "portable_state.py", "admin.html", "index.html", "workspace.html"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", required=True, choices=("Windows", "macOS"))
    parser.add_argument("--version", required=True)
    parser.add_argument("--runtime", required=True, type=Path)
    parser.add_argument("--out", default=ROOT / "dist", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.version):
        parser.error("Use a numeric release version such as 1.0.0")
    windows = args.platform == "Windows"
    platform_dir = ROOT / "packaging" / args.platform
    start = "Start " + PRODUCT + (".cmd" if windows else ".command")
    runtime = args.runtime.resolve()
    for arch in ("arm64", "x64"):
        binary = runtime / arch / ("python.exe" if windows else "bin/python3.14")
        if not binary.is_file():
            parser.error("Missing runtime binary: " + str(binary))
    if not any("license" in file.name.casefold() or "licence" in file.name.casefold()
               for file in runtime.rglob("*") if file.is_file()):
        parser.error("Runtime license files missing")
    app = ROOT / "app"
    entries = [(platform_dir / start, Path(start)), (platform_dir / "开始使用.txt", Path("开始使用.txt"))]
    entries += [(app / name, Path("app") / name) for name in APP_FILES]
    for file in sorted((app / "assets").iterdir()):
        if file.suffix.lower() in {".css", ".js", ".png", ".svg", ".woff", ".woff2"}:
            entries.append((file, Path("app/assets") / file.name))
    for file in sorted(runtime.rglob("*")):
        relative = file.relative_to(runtime)
        if file.is_symlink():
            parser.error("Use real files in the portable runtime: " + str(relative))
        if file.is_file() and not EXCLUDE.intersection(relative.parts):
            if file.name.startswith(".env") or file.suffix in {".sqlite", ".sqlite3", ".db", ".key", ".pem"}:
                parser.error("Unexpected private or state file in runtime: " + str(relative))
            entries.append((file, Path("runtime") / relative))
    name = f"{PRODUCT}-{args.version}-{args.platform}"
    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / (name + ".zip")
    with tempfile.TemporaryDirectory(dir=args.out) as temporary:
        output = Path(temporary) / target.name
        with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=7) as z:
            for file, relative in entries:
                info = ZipInfo(name + "/" + relative.as_posix(), (2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                executable = (relative.name.endswith(".command") or
                              (not windows and relative.parts[0] == "runtime" and
                               ("bin" in relative.parts or file.suffix == ".dylib")))
                info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
                info.compress_type = ZIP_DEFLATED
                with file.open("rb") as source, z.open(info, "w") as dest:
                    shutil.copyfileobj(source, dest)
        with ZipFile(output) as z:
            if z.testzip():
                raise RuntimeError("Archive CRC verification failed")
        os.replace(output, target)
    print(target)


if __name__ == "__main__":
    main()
