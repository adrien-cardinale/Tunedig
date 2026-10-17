import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import navidrome
from settings import MUSIC_DIR

MAX_THREADS = 4
DISABLED_VALUES = {"0", "false", "no", "off"}

logger = logging.getLogger(__name__)

_state = {"status": "idle", "startedAt": None, "finishedAt": None, "error": None}
_state_lock = threading.Lock()


class ScanAlreadyRunning(RuntimeError):
    def __init__(self):
        super().__init__("passage ReplayGain déjà en cours")


def enabled() -> bool:
    flag = os.environ.get("REPLAYGAIN", "1").strip().lower()
    return flag not in DISABLED_VALUES and shutil.which("rsgain") is not None


def _run(args: list[str]) -> None:
    result = subprocess.run(["rsgain", *args], capture_output=True, text=True)
    if result.returncode != 0:
        detail = result.stderr.strip() or f"code de sortie {result.returncode}"
        raise RuntimeError(f"rsgain : {detail}")


def tag_files(paths: list[Path], album: bool) -> None:
    if not paths:
        return
    args = ["custom", "-s", "i", "-c", "p", "-I", "3", "-q"]
    if album:
        args.append("-a")
    _run([*args, *(str(p) for p in paths)])


def library_status() -> dict:
    with _state_lock:
        return dict(_state)


def _thread_count() -> int:
    return min(os.cpu_count() or 1, MAX_THREADS)


def _trigger_navidrome_scan() -> None:
    if not navidrome.enabled():
        return
    try:
        navidrome.trigger_scan()
    except Exception as exc:  # noqa: BLE001 — the scan must not fail the ReplayGain pass
        logger.warning("Scan Navidrome après ReplayGain en échec : %s", exc)


def _run_library_scan(force: bool) -> None:
    args = ["easy", "-q", "-m", str(_thread_count())]
    if not force:
        args.append("-S")
    try:
        _run([*args, str(MUSIC_DIR)])
    except Exception as exc:  # noqa: BLE001 — the error is exposed through the status
        with _state_lock:
            _state.update(status="error", finishedAt=time.time(), error=str(exc))
        return
    with _state_lock:
        _state.update(status="done", finishedAt=time.time(), error=None)
    _trigger_navidrome_scan()


def start_library_scan(force: bool) -> dict:
    with _state_lock:
        if _state["status"] == "running":
            raise ScanAlreadyRunning()
        _state.update(status="running", startedAt=time.time(), finishedAt=None, error=None)
        snapshot = dict(_state)
    threading.Thread(target=_run_library_scan, args=(force,), daemon=True).start()
    return snapshot
