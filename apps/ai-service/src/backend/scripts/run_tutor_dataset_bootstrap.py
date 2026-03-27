from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.backend.services.tutor_dataset_seed_service import tutor_dataset_seed_service


async def main() -> None:
    await tutor_dataset_seed_service.ensure_schema()
    result = await tutor_dataset_seed_service.bootstrap_if_enabled()
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
