import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parent.parent
MODES = {
    "dev": [
        "http://127.0.0.1:4318/api/health",
        "http://localhost:3000/",
    ],
    "start": ["http://localhost:3000/"],
}


def endpoint_is_open(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return 200 <= response.status < 500
    except urllib.error.HTTPError:
        return True
    except (urllib.error.URLError, TimeoutError):
        return False


def wait_until_ready(process: subprocess.Popen, urls: list[str]) -> None:
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"npm process exited before startup with code {process.returncode}"
            )
        if all(endpoint_is_open(url) for url in urls):
            return
        time.sleep(0.5)
    raise TimeoutError(f"services did not become ready: {', '.join(urls)}")


def wait_until_closed(urls: list[str]) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if not any(endpoint_is_open(url) for url in urls):
            return
        time.sleep(0.25)
    raise RuntimeError(f"services remained open after Ctrl+C: {', '.join(urls)}")


def tail(path: Path, limit: int = 12_000) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")[-limit:]


def force_stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )


def verify_lifecycle(mode: str) -> None:
    urls = MODES[mode]
    log_root = Path(tempfile.mkdtemp(prefix=f"advisor-{mode}-"))
    stdout_path = log_root / "stdout.log"
    stderr_path = log_root / "stderr.log"

    with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open(
        "w", encoding="utf-8"
    ) as stderr_file:
        process = subprocess.Popen(
            ["cmd.exe", "/d", "/s", "/c", f"npm run {mode}"],
            cwd=WEB_ROOT,
            stdout=stdout_file,
            stderr=stderr_file,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )

        try:
            wait_until_ready(process, urls)
            process.send_signal(signal.CTRL_C_EVENT)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired as error:
                raise RuntimeError("npm process did not exit after Ctrl+C") from error
            wait_until_closed(urls)
        except Exception:
            stdout_file.flush()
            stderr_file.flush()
            print("--- npm stdout ---")
            print(tail(stdout_path))
            print("--- npm stderr ---")
            print(tail(stderr_path))
            raise
        finally:
            force_stop(process)

    print(
        f"npm run {mode} became ready, handled Windows Ctrl+C, "
        "and closed every service endpoint."
    )


if __name__ == "__main__":
    if sys.platform != "win32":
        raise SystemExit("This lifecycle check must run on Windows.")
    if len(sys.argv) != 2 or sys.argv[1] not in MODES:
        raise SystemExit("Usage: windows-user-lifecycle.py <dev|start>")
    verify_lifecycle(sys.argv[1])
