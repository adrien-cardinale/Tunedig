import os
from pathlib import Path

MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", str(Path.home() / "music")))
