import asyncio
from collections.abc import Sequence
from dataclasses import dataclass

from api.application.ports import OperationTypeRepository, PartRepository, ProcessCardRepository
from api.domain.operation_type import OperationType
from api.domain.process_card import sum_durations


@dataclass(frozen=True, slots=True)
class WorkloadEntry:
    operation_type: OperationType
    operations: int
    total_duration_minutes: float


@dataclass(frozen=True, slots=True)
class Statistics:
    parts: int
    operation_types: int
    process_cards: int
    operations: int
    total_duration_minutes: float
    workload: Sequence[WorkloadEntry]


class StatisticsService:
    def __init__(
        self,
        *,
        parts: PartRepository,
        operation_types: OperationTypeRepository,
        process_cards: ProcessCardRepository,
    ) -> None:
        self._parts = parts
        self._operation_types = operation_types
        self._process_cards = process_cards

    async def collect(self) -> Statistics:
        parts, process_cards, operation_types, workload = await asyncio.gather(
            self._parts.count(),
            self._process_cards.count(),
            self._operation_types.list_all(),
            self._process_cards.workload(),
        )
        by_type = {entry.operation_type_id: entry for entry in workload}
        entries = [
            WorkloadEntry(
                operation_type=operation_type,
                operations=entry.operations if entry else 0,
                total_duration_minutes=entry.total_duration_minutes if entry else 0.0,
            )
            for operation_type in operation_types
            for entry in [by_type.get(operation_type.id)]
        ]
        entries.sort(key=lambda entry: -entry.total_duration_minutes)

        return Statistics(
            parts=parts,
            operation_types=len(operation_types),
            process_cards=process_cards,
            operations=sum(entry.operations for entry in entries),
            total_duration_minutes=sum_durations(entry.total_duration_minutes for entry in entries),
            workload=entries,
        )
