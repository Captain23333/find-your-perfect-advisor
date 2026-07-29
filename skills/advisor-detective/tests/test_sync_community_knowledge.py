import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = (
    Path(__file__).resolve().parents[1] / "scripts" / "sync_community_knowledge.py"
)
SPEC = importlib.util.spec_from_file_location("sync_community_knowledge", SCRIPT_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = SYNC
SPEC.loader.exec_module(SYNC)


class SyncCommunityKnowledgeTests(unittest.TestCase):
    def test_read_limited_rejects_declared_oversize(self):
        with self.assertRaisesRegex(ValueError, "exceeding limit"):
            SYNC.read_limited(
                io.BytesIO(b"small"),
                max_bytes=4,
                expected_bytes=10,
            )

    def test_read_limited_rejects_stream_oversize(self):
        with self.assertRaisesRegex(ValueError, "exceeds limit"):
            SYNC.read_limited(io.BytesIO(b"12345"), max_bytes=4)

    def test_clear_destination_removes_only_generated_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            keep = destination / "community-sources.md"
            keep.write_text("keep", encoding="utf-8")
            for name in SYNC.GENERATED_FILES:
                (destination / name).write_text("cache", encoding="utf-8")
            (destination / ".community-download.tmp").write_text(
                "temp",
                encoding="utf-8",
            )

            removed = SYNC.clear_destination(destination)

            self.assertTrue(keep.exists())
            self.assertIn("community-knowledge-metadata.json", removed)
            self.assertFalse((destination / ".community-download.tmp").exists())

    def test_pdftotext_temp_file_is_cleaned_after_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf_path = Path(directory) / "community-blacklist-current.pdf"
            pdf_path.write_bytes(b"%PDF-test")
            temporary_path = (
                pdf_path.with_suffix(".txt").with_name(
                    ".community-blacklist-current.txt.tmp"
                )
            )

            def fail_after_writing(command, **_kwargs):
                Path(command[-1]).write_text("partial", encoding="utf-8")
                raise RuntimeError("pdftotext failed")

            with mock.patch.object(SYNC.shutil, "which", return_value="/pdftotext"):
                with mock.patch.object(
                    SYNC.subprocess,
                    "run",
                    side_effect=fail_after_writing,
                ):
                    with self.assertRaisesRegex(RuntimeError, "pdftotext failed"):
                        SYNC.extract_pdf_text(pdf_path)

            self.assertFalse(temporary_path.exists())


if __name__ == "__main__":
    unittest.main()
