from __future__ import annotations

import re

from ..datasets.schemas import SupportedLanguage


FENCED_BLOCK_PATTERN = re.compile(
    r'```(?P<lang>[a-zA-Z0-9_+-]*)\n(?P<code>.*?)```',
    re.DOTALL,
)

PYTHON_FUNCTION_PATTERN = re.compile(
    r'(?P<code>(?:def|class)\s+[\w_]+.*)',
    re.DOTALL,
)

C_FUNCTION_PATTERN = re.compile(
    r'(?P<code>(?:#include\s+<[^>]+>\s*)*(?:[a-zA-Z_][\w\s\*]+)\s+[a-zA-Z_][\w]*\s*\([^\)]*\)\s*\{.*)',
    re.DOTALL,
)


def _strip_common_leading_explanations(text: str) -> str:
    cleaned_lines: list[str] = []
    started = False
    for line in text.splitlines():
        stripped = line.strip()
        if not started and not stripped:
            continue
        if not started and stripped.lower().startswith(
            (
                'dưới đây',
                'duoi day',
                'here is',
                'here\'s',
                'solution:',
                'code:',
                'explanation:',
            )
        ):
            continue
        started = True
        cleaned_lines.append(line)
    return '\n'.join(cleaned_lines).strip()


def _extract_by_language_heuristic(response_text: str, language: SupportedLanguage) -> str | None:
    pattern = PYTHON_FUNCTION_PATTERN if language == 'python' else C_FUNCTION_PATTERN
    match = pattern.search(response_text)
    if match:
        return match.group('code').strip()
    return None


def extract_code_block(response_text: str, language: SupportedLanguage) -> str:
    response_text = _strip_common_leading_explanations(response_text)
    language_aliases = {
        'python': {'python', 'py'},
        'c': {'c', 'h'},
    }

    matches = list(FENCED_BLOCK_PATTERN.finditer(response_text))
    if matches:
        preferred = []
        for match in matches:
            lang = (match.group('lang') or '').strip().lower()
            code = match.group('code').strip()
            if not code:
                continue
            if lang in language_aliases[language]:
                preferred.append(code)

        if preferred:
            return preferred[0]

        for match in matches:
            code = match.group('code').strip()
            if code:
                return code

    cleaned = response_text.strip()
    if cleaned.startswith('```') and cleaned.endswith('```'):
        cleaned = cleaned.strip('`').strip()

    heuristic_code = _extract_by_language_heuristic(cleaned, language)
    if heuristic_code:
        return heuristic_code

    return cleaned
