import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import NewType

from api.domain.errors import DomainError
from api.domain.operation_type import OperationTypeId
from api.domain.part import PartId
from api.domain.text import Limits, assert_length, optional_text

ProcessCardId = NewType('ProcessCardId', str)

OPERATIONS_COUNT = Limits(1, 30)
DURATION_MIN_MINUTES = 0.1
DURATION_MAX_MINUTES = 1440.0
EQUIPMENT_LENGTH = Limits(1, 120)
OPERATION_NUMBER_STEP = 5

_TENTHS_PER_MINUTE = 10


@dataclass(frozen=True, slots=True)
class OperationInput:
    operation_type_id: str
    duration_minutes: float
    equipment: str | None = None


@dataclass(frozen=True, slots=True)
class ProcessCardInput:
    part_id: str
    operations: Sequence[OperationInput]


@dataclass(frozen=True, slots=True)
class Operation:
    operation_type_id: OperationTypeId
    equipment: str | None
    duration_minutes: float


@dataclass(frozen=True, slots=True)
class ProcessCardDetails:
    part_id: PartId
    operations: tuple[Operation, ...]


@dataclass(frozen=True, slots=True)
class ProcessCard(ProcessCardDetails):
    id: ProcessCardId
    created_at: datetime
    updated_at: datetime


def is_valid_duration(minutes: float) -> bool:
    if isinstance(minutes, bool) or not math.isfinite(minutes):
        return False
    tenths = minutes * _TENTHS_PER_MINUTE
    return (
        DURATION_MIN_MINUTES <= minutes <= DURATION_MAX_MINUTES
        and abs(tenths - round(tenths)) < 1e-9
    )


def round_duration(minutes: float) -> float:
    return round(minutes * _TENTHS_PER_MINUTE) / _TENTHS_PER_MINUTE


def sum_durations(durations: Iterable[float]) -> float:
    return sum(round(minutes * _TENTHS_PER_MINUTE) for minutes in durations) / _TENTHS_PER_MINUTE


def total_duration(card: ProcessCardDetails) -> float:
    return sum_durations(operation.duration_minutes for operation in card.operations)


def operation_number(index: int) -> int:
    return (index + 1) * OPERATION_NUMBER_STEP


def referenced_operation_types(card: ProcessCardDetails) -> tuple[OperationTypeId, ...]:
    return tuple(dict.fromkeys(operation.operation_type_id for operation in card.operations))


def create_process_card_details(source: ProcessCardInput) -> ProcessCardDetails:
    if not OPERATIONS_COUNT.contains(len(source.operations)):
        raise DomainError(
            f'A process card must have {OPERATIONS_COUNT.min}-{OPERATIONS_COUNT.max} operations'
        )
    operations: list[Operation] = []
    for index, operation in enumerate(source.operations):
        number = operation_number(index)
        if not is_valid_duration(operation.duration_minutes):
            raise DomainError(f'Operation {number}: invalid duration {operation.duration_minutes}')
        equipment = optional_text(operation.equipment)
        if equipment is not None:
            assert_length(f'Operation {number} equipment', equipment, EQUIPMENT_LENGTH)
        operations.append(
            Operation(
                OperationTypeId(operation.operation_type_id),
                equipment,
                float(operation.duration_minutes),
            )
        )
    return ProcessCardDetails(PartId(source.part_id), tuple(operations))
