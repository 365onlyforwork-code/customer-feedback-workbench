"""Prepare both macOS runtime trees from the two original, pinned upstream tarballs."""
import argparse
import hashlib
import shutil
import tarfile
from pathlib import Path, PurePosixPath

VERSION = "3.14.10"
TAG = "20261110"
BUILDS = {
    "arm64": ("aarch64", "f15ec3d15460dd66c2eb88639b152cd9040e7d1ece11e38bf89e8f53f0171e02"),
    "x64": ("x86_64", "85f8e54798e8e6aa58d2253f013d815c5616343cc0d15cbea882fca78bdfeae2"),
}
OMIT = {"site-packages", "ensurepip", "venv", "idlelib", "tkinter", "turtledemo",
        "lib-dynload", "build-details.json", "config-3.14-darwin"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path, help="Directory with original upstream tar.gz archives")
    parser.add_argument("runtime", type=Path, help="New or empty target runtime directory")
    args = parser.parse_args()
    if args.runtime.exists() and any(args.runtime.iterdir()):
        parser.error("Choose an empty destination")
    notices = Path(__file__).resolve().parent / "vendor-notices"
    for arch, (cpu, expected) in BUILDS.items():
        name = f"cpython-{VERSION}+{TAG}-{cpu}-apple-darwin-install_only_stripped.tar.gz"
        archive = args.cache / name
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
            raise ValueError("Upstream SHA-256 mismatch: " + name)
        root = args.runtime / arch
        with tarfile.open(archive, "r:gz") as tar:
            for item in tar:
                if not item.isfile():
                    continue
                path = PurePosixPath(item.name).relative_to("python")
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError("Invalid archive path")
                executable = path.as_posix() == "bin/python3.14"
                marker = path.as_posix() == "lib/python3.14/lib-dynload/.empty"
                stdlib = len(path.parts) > 2 and path.parts[:2] == ("lib", "python3.14") and path.parts[2] not in OMIT
                if executable or marker or stdlib:
                    dest = root / path
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(item) as source, dest.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    dest.chmod(0o755 if executable else 0o644)
        shutil.copy2(notices / (arch + ".txt"), root / "THIRD-PARTY.txt")
        shutil.copytree(notices / "licenses", root / "licenses")


if __name__ == "__main__":
    main()
