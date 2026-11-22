"""Prepare the Windows dual-architecture runtime from the official CPython ZIPs."""
import argparse
from hashlib import sha256
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from zipfile import ZipFile

VERSION = "3.14.10"
METADATA = Path(__file__).resolve().parent / "upstream"
# win-architecture, ZIP digest published by python.org, original SBOM digest
FILES = {
    "amd64": ("x64", "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159",
              "d448c78f5fae170303d3b022d61507155e4d30e541c32bff3a4edd2b1e8dbf47"),
    "arm64": ("arm64", "bbe116bb1248820359cbf25127ac5c7794ea161869d83686cfbc9a45203ff836",
              "3c72b9d3484a8ade03396b0640e0bf8f7fe9f443662484de107de022e037e837"),
}


def require_digest(path, expected):
    if not path.is_file():
        raise ValueError("Missing input: " + path.name)
    if sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError("SHA-256 mismatch: " + path.name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True, help="Folder containing both official ZIPs")
    parser.add_argument("--out", type=Path, required=True, help="New runtime output folder")
    args = parser.parse_args()
    target = args.out.resolve()
    if target.exists():
        parser.error("Choose a new output folder; the requested one already exists.")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with TemporaryDirectory(dir=target.parent) as staging:
            runtime = Path(staging) / "runtime"
            runtime.mkdir()
            notice = METADATA / "NOTICE.txt"
            require_digest(notice, "6e927d80c74c5c58a0636ca2c572e0448ce73091c2fa19da670acc1abff4f4d2")
            shutil.copyfile(notice, runtime / "NOTICE.txt")
            for vendor, (arch, digest, sbom_digest) in FILES.items():
                archive = args.cache / f"python-{VERSION}-embed-{vendor}.zip"
                sbom = METADATA / f"{vendor}.spdx.json"
                require_digest(archive, digest)
                require_digest(sbom, sbom_digest)
                with ZipFile(archive) as source:
                    if source.testzip():
                        raise ValueError("ZIP CRC mismatch: " + archive.name)
                    # The two official archives are flat; retain all upstream files exactly.
                    if any(name != Path(name).name or "\\" in name or name in (".", "..")
                           for name in source.namelist()):
                        raise ValueError("Unexpected directory inside " + archive.name)
                    source.extractall(runtime / arch)
                shutil.copyfile(sbom, runtime / arch / "upstream.spdx.json")
            runtime.rename(target)
    except (OSError, ValueError) as failure:
        parser.exit(1, str(failure) + "\n")
    print("Verified and prepared the Windows x64 and ARM64 runtime.")


if __name__ == "__main__":
    main()
