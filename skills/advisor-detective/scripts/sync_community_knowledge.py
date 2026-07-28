#!/usr/bin/env python3
"""Synchronize local community advisor-review snapshots.

The volatile snapshots are intentionally ignored by Git. This script keeps a
searchable local copy beside the advisor-detective skill and records hashes so
scheduled runs can tell whether either source changed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class Source:
    name: str
    source_url: str
    download_url: str
    kind: str


SOURCES = (
    Source(
        name="community-blacklist-current.pdf",
        source_url=(
            "https://drive.google.com/file/d/"
            "1DMpkLQMIvk7-bO8lux1cU1YNth6s0J3h/view"
        ),
        download_url=(
            "https://drive.usercontent.google.com/download"
            "?id=1DMpkLQMIvk7-bO8lux1cU1YNth6s0J3h"
            "&export=download&confirm=t"
        ),
        kind="pdf",
    ),
    Source(
        name="community-red-flags-current.txt",
        source_url=(
            "https://docs.google.com/document/d/"
            "1-AtKUh-xE1CPRRDVlfPx1d42Trhr7F8qQIw69hP85Ds/edit"
        ),
        download_url=(
            "https://docs.google.com/document/d/"
            "1-AtKUh-xE1CPRRDVlfPx1d42Trhr7F8qQIw69hP85Ds/"
            "export?format=txt"
        ),
        kind="text",
    ),
)

USER_AGENT = "AdvisorAtlasKnowledgeSync/1.0"
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(source: Source, timeout: int) -> tuple[bytes, dict[str, str | int | None]]:
    request = urllib.request.Request(
        source.download_url,
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read()
        headers = {
            "http_status": response.status,
            "final_url": response.geturl(),
            "etag": response.headers.get("ETag"),
            "last_modified": response.headers.get("Last-Modified"),
            "content_type": response.headers.get("Content-Type"),
        }
    return data, headers


def validate(source: Source, data: bytes) -> bytes:
    if source.kind == "pdf":
        if not data.startswith(b"%PDF-"):
            raise ValueError(f"{source.name}: download is not a PDF")
        if len(data) < 10_000:
            raise ValueError(f"{source.name}: PDF is unexpectedly small")
        return data

    text = data.decode("utf-8-sig")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if len(text) < 1_000 or "Purpose" not in text:
        raise ValueError(f"{source.name}: text export failed validation")
    return text.encode("utf-8")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        dir=path.parent,
    )
    try:
        with os.fdopen(file_descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def extract_pdf_text(pdf_path: Path) -> Path | None:
    executable = shutil.which("pdftotext")
    output_path = pdf_path.with_suffix(".txt")
    if executable is not None:
        temporary_path = output_path.with_name(f".{output_path.name}.tmp")
        subprocess.run(
            [executable, "-layout", str(pdf_path), str(temporary_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        text = temporary_path.read_text(encoding="utf-8", errors="replace")
        atomic_write(output_path, text.encode("utf-8"))
        temporary_path.unlink(missing_ok=True)
        return output_path

    try:
        from pypdf import PdfReader
    except ImportError:
        return None

    reader = PdfReader(str(pdf_path))
    pages = []
    for page_number, page in enumerate(reader.pages, start=1):
        pages.append(f"\n\n--- Page {page_number} ---\n\n")
        pages.append(page.extract_text() or "")
    atomic_write(output_path, "".join(pages).encode("utf-8"))
    return output_path


def clean_url(url: str) -> str:
    return url.rstrip(".,;:!?，。；、）)]}")


def extract_urls(paths: Iterable[Path]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for path in paths:
        if not path.exists() or path.suffix.lower() == ".pdf":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for raw_url in URL_PATTERN.findall(text):
            url = clean_url(raw_url)
            key = (path.name, url)
            if key not in seen:
                seen.add(key)
                rows.append({"source_file": path.name, "url": url})
    return rows


def parse_args() -> argparse.Namespace:
    default_destination = Path(__file__).resolve().parent.parent / "references"
    parser = argparse.ArgumentParser(
        description="Sync local advisor-community knowledge snapshots."
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=default_destination,
        help="Destination directory (default: advisor-detective/references).",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=90,
        help="Per-download timeout in seconds.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    destination = args.dest.expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    fetched_at = datetime.now(timezone.utc).isoformat()

    metadata: dict[str, object] = {
        "schema_version": 1,
        "fetched_at": fetched_at,
        "sources": [],
    }
    searchable_paths: list[Path] = []

    for source in SOURCES:
        data, response_metadata = download(source, args.timeout)
        data = validate(source, data)
        output_path = destination / source.name
        previous_sha256 = sha256_file(output_path)
        current_sha256 = sha256_bytes(data)
        changed = previous_sha256 != current_sha256
        if changed:
            atomic_write(output_path, data)

        source_metadata = {
            "name": source.name,
            "source_url": source.source_url,
            "download_url": source.download_url,
            "bytes": len(data),
            "sha256": current_sha256,
            "previous_sha256": previous_sha256,
            "changed": changed,
            **response_metadata,
        }
        metadata["sources"].append(source_metadata)
        searchable_paths.append(output_path)

        if source.kind == "pdf":
            text_path = extract_pdf_text(output_path)
            if text_path is not None:
                searchable_paths.append(text_path)
                source_metadata["text_extract"] = text_path.name
                source_metadata["text_extract_sha256"] = sha256_file(text_path)
            else:
                source_metadata["text_extract"] = None
                source_metadata["text_extract_note"] = (
                    "Install pdftotext or pypdf to create a searchable text copy"
                )

    links = extract_urls(searchable_paths)
    atomic_write(
        destination / "community-links.json",
        (json.dumps(links, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    metadata["extracted_link_count"] = len(links)
    atomic_write(
        destination / "community-knowledge-metadata.json",
        (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )

    summary = {
        "destination": str(destination),
        "fetched_at": fetched_at,
        "changed_sources": [
            item["name"] for item in metadata["sources"] if item["changed"]
        ],
        "extracted_link_count": len(links),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
