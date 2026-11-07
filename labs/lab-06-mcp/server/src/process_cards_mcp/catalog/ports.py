from dataclasses import dataclass
from typing import Protocol

from process_cards_mcp.catalog.models import (
    OperationTypeList,
    OperationTypeSortField,
    Overview,
    PartList,
    PartSortField,
    ProcessCardDetail,
    ProcessCardList,
    ProcessCardSortField,
    SearchResult,
    SortOrder,
)


class CatalogUnavailableError(Exception):
    pass


class ProcessCardNotFoundError(Exception):
    def __init__(self, designation: str, *, part_exists: bool, known: list[str]) -> None:
        super().__init__(designation)
        self.designation = designation
        self.part_exists = part_exists
        self.known = known


@dataclass(frozen=True, slots=True)
class PartQuery:
    sort_by: PartSortField = 'designation'
    order: SortOrder = 'asc'
    limit: int = 50


@dataclass(frozen=True, slots=True)
class OperationTypeQuery:
    sort_by: OperationTypeSortField = 'name'
    order: SortOrder = 'asc'


@dataclass(frozen=True, slots=True)
class ProcessCardQuery:
    sort_by: ProcessCardSortField = 'designation'
    order: SortOrder = 'asc'
    limit: int = 50
    operation_type: str | None = None
    material: str | None = None
    min_total_minutes: float | None = None
    max_total_minutes: float | None = None


class CatalogReader(Protocol):
    async def overview(self) -> Overview: ...

    async def list_parts(self, query: PartQuery) -> PartList: ...

    async def list_operation_types(self, query: OperationTypeQuery) -> OperationTypeList: ...

    async def list_process_cards(self, query: ProcessCardQuery) -> ProcessCardList: ...

    async def get_process_card(self, designation: str) -> ProcessCardDetail: ...

    async def search(self, text: str, limit: int) -> SearchResult: ...

    async def is_available(self) -> bool: ...

    async def close(self) -> None: ...
