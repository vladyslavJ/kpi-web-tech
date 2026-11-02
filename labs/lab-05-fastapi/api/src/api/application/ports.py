from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from api.domain.operation_type import OperationType, OperationTypeDetails, OperationTypeId
from api.domain.part import Part, PartDetails, PartId
from api.domain.process_card import ProcessCard, ProcessCardDetails, ProcessCardId


@dataclass(frozen=True, slots=True)
class Saved[T]:
    value: T


@dataclass(frozen=True, slots=True)
class Rejected:
    reason: Literal['duplicate', 'not-found']


type WriteResult[T] = Saved[T] | Rejected


class Repository[TEntity, TDetails, TId: str](Protocol):
    async def list_all(self) -> Sequence[TEntity]: ...

    async def count(self) -> int: ...

    async def find(self, entity_id: TId) -> TEntity | None: ...

    async def find_many(self, entity_ids: Sequence[TId]) -> Sequence[TEntity]: ...

    async def create(self, details: TDetails) -> WriteResult[TEntity]: ...

    async def update(self, entity_id: TId, details: TDetails) -> WriteResult[TEntity]: ...

    async def delete(self, entity_id: TId) -> bool: ...


class PartRepository(Repository[Part, PartDetails, PartId], Protocol):
    pass


class OperationTypeRepository(
    Repository[OperationType, OperationTypeDetails, OperationTypeId], Protocol
):
    pass


@dataclass(frozen=True, slots=True)
class OperationTypeWorkload:
    operation_type_id: OperationTypeId
    operations: int
    total_duration_minutes: float


class ProcessCardRepository(Repository[ProcessCard, ProcessCardDetails, ProcessCardId], Protocol):
    async def is_part_used(self, part_id: PartId) -> bool: ...

    async def is_operation_type_used(self, operation_type_id: OperationTypeId) -> bool: ...

    async def workload(self) -> Sequence[OperationTypeWorkload]: ...


class Storage(Protocol):
    @property
    def parts(self) -> PartRepository: ...

    @property
    def operation_types(self) -> OperationTypeRepository: ...

    @property
    def process_cards(self) -> ProcessCardRepository: ...

    async def is_available(self) -> bool: ...

    async def close(self) -> None: ...
