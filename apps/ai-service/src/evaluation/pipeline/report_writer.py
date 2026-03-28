from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import orjson


def write_report(report_root: Path, filename: str, payload: dict[str, Any]) -> Path:
    report_root.mkdir(parents=True, exist_ok=True)
    output_path = report_root / filename
    payload = {
        **payload,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
    }
    output_path.write_bytes(orjson.dumps(payload, option=orjson.OPT_INDENT_2))
    return output_path
