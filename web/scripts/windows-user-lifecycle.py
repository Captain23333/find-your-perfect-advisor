import ctypes
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parent.parent
CTRL_C_EVENT = 0
ATTACH_PARENT_PROCESS = 0xFFFFFFFF
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


def send_console_ctrl_c(process: subprocess.Popen) -> None:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.FreeConsole.restype = ctypes.c_bool
    kernel32.AttachConsole.argtypes = [ctypes.c_uint32]
    kernel32.AttachConsole.restype = ctypes.c_bool
    kernel32.SetConsoleCtrlHandler.argtypes = [ctypes.c_void_p, ctypes.c_bool]
    kernel32.SetConsoleCtrlHandler.restype = ctypes.c_bool
    kernel32.GenerateConsoleCtrlEvent.argtypes = [ctypes.c_uint32, ctypes.c_uint32]
    kernel32.GenerateConsoleCtrlEvent.restype = ctypes.c_bool
    if not kernel32.FreeConsole():
        raise ctypes.WinError(ctypes.get_last_error())

    attached = False
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if kernel32.AttachConsole(process.pid):
                attached = True
                break
            time.sleep(0.1)
        if not attached:
            raise ctypes.WinError(ctypes.get_last_error())

        if not kernel32.SetConsoleCtrlHandler(None, True):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel32.GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(0.5)
    finally:
        if attached:
            kernel32.FreeConsole()
        kernel32.AttachConsole(ATTACH_PARENT_PROCESS)
        kernel32.SetConsoleCtrlHandler(None, False)


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
            creationflags=subprocess.CREATE_NEW_CONSOLE,
        )

        try:
            wait_until_ready(process, urls)
            send_console_ctrl_c(process)
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
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    if sys.platform != "win32":
        raise SystemExit("This lifecycle check must run on Windows.")
    if len(sys.argv) != 2 or sys.argv[1] not in MODES:
        raise SystemExit("Usage: windows-user-lifecycle.py <dev|start>")
    verify_lifecycle(sys.argv[1])
