import re
from dataclasses import dataclass

from api.domain.errors import DomainError

_WHITESPACE = re.compile(r'\s+')


@dataclass(frozen=True, slots=True)
class Limits:
    min: int
    max: int

    def contains(self, length: int) -> bool:
        return self.min <= length <= self.max


def normalize_text(raw: str) -> str:
    return _WHITESPACE.sub(' ', raw.strip())


def optional_text(raw: str | None) -> str | None:
    return normalize_text(raw or '') or None


def assert_length(field: str, value: str, limits: Limits) -> None:
    if not limits.contains(len(value)):
        raise DomainError(f'{field} must be {limits.min}-{limits.max} characters long')
