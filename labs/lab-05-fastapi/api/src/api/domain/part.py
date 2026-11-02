import re
from dataclasses import dataclass
from datetime import datetime
from typing import NewType

from api.domain.errors import DomainError
from api.domain.text import Limits, assert_length, normalize_text, optional_text

PartId = NewType('PartId', str)

PART_DESIGNATION_PATTERN = re.compile(r'[^\W_](?:[^\W_]|[./-]){1,38}[^\W_]')
PART_DESIGNATION_LENGTH = Limits(3, 40)
PART_NAME_LENGTH = Limits(2, 120)
PART_MATERIAL_LENGTH = Limits(1, 80)


@dataclass(frozen=True, slots=True)
class PartInput:
    designation: str
    name: str
    material: str | None = None


@dataclass(frozen=True, slots=True)
class PartDetails:
    designation: str
    name: str
    material: str | None


@dataclass(frozen=True, slots=True)
class Part(PartDetails):
    id: PartId
    created_at: datetime
    updated_at: datetime


def normalize_designation(raw: str) -> str:
    return raw.strip().upper()


def is_valid_designation(raw: str) -> bool:
    return PART_DESIGNATION_PATTERN.fullmatch(normalize_designation(raw)) is not None


def create_part_details(source: PartInput) -> PartDetails:
    if not is_valid_designation(source.designation):
        raise DomainError(f'Invalid part designation: {source.designation!r}')
    name = normalize_text(source.name)
    assert_length('Part name', name, PART_NAME_LENGTH)
    material = optional_text(source.material)
    if material is not None:
        assert_length('Part material', material, PART_MATERIAL_LENGTH)
    return PartDetails(normalize_designation(source.designation), name, material)
