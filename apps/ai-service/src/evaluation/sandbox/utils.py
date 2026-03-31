from __future__ import annotations

import tempfile
from pathlib import Path


def _sanitize_prefix(prefix: str) -> str:
    return prefix.replace('/', '_').replace('\\', '_').replace(':', '_')


def create_workdir(root: Path, prefix: str) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    safe_prefix = _sanitize_prefix(prefix)
    return Path(tempfile.mkdtemp(prefix=f'{safe_prefix}_', dir=root))


def write_text(path: Path, content: str) -> Path:
    path.write_text(content, encoding='utf-8')
    return path
