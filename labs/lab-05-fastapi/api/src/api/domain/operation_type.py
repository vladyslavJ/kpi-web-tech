from dataclasses import dataclass
from datetime import datetime
from typing import NewType

from api.domain.text import Limits, assert_length, normalize_text, optional_text

OperationTypeId = NewType('OperationTypeId', str)

OPERATION_TYPE_NAME_LENGTH = Limits(2, 60)
OPERATION_TYPE_DESCRIPTION_LENGTH = Limits(1, 300)


@dataclass(frozen=True, slots=True)
class OperationTypeInput:
    name: str
    description: str | None = None


@dataclass(frozen=True, slots=True)
class OperationTypeDetails:
    name: str
    description: str | None


@dataclass(frozen=True, slots=True)
class OperationType(OperationTypeDetails):
    id: OperationTypeId
    created_at: datetime
    updated_at: datetime


def normalize_operation_type_name(raw: str) -> str:
    name = normalize_text(raw)
    return name[:1].upper() + name[1:]


def create_operation_type_details(source: OperationTypeInput) -> OperationTypeDetails:
    name = normalize_operation_type_name(source.name)
    assert_length('Operation type name', name, OPERATION_TYPE_NAME_LENGTH)
    description = optional_text(source.description)
    if description is not None:
        assert_length('Operation type description', description, OPERATION_TYPE_DESCRIPTION_LENGTH)
    return OperationTypeDetails(name, description)
