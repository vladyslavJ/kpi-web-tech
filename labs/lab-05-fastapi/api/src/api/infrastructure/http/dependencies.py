from dataclasses import dataclass
from typing import Annotated, cast

from fastapi import Depends, Path, Request

from api.application.operation_types_service import OperationTypesService
from api.application.parts_service import PartsService
from api.application.ports import Storage
from api.application.process_cards_service import ProcessCardsService
from api.application.statistics_service import StatisticsService
from api.infrastructure.http.schemas import EXAMPLE_ID


@dataclass(frozen=True, slots=True)
class Services:
    storage: Storage
    parts: PartsService
    operation_types: OperationTypesService
    process_cards: ProcessCardsService
    statistics: StatisticsService

    @classmethod
    def build(cls, storage: Storage) -> 'Services':
        return cls(
            storage=storage,
            parts=PartsService(parts=storage.parts, process_cards=storage.process_cards),
            operation_types=OperationTypesService(
                operation_types=storage.operation_types, process_cards=storage.process_cards
            ),
            process_cards=ProcessCardsService(
                process_cards=storage.process_cards,
                parts=storage.parts,
                operation_types=storage.operation_types,
            ),
            statistics=StatisticsService(
                parts=storage.parts,
                operation_types=storage.operation_types,
                process_cards=storage.process_cards,
            ),
        )


def _services(request: Request) -> Services:
    return cast(Services, request.app.state.services)


def _storage(request: Request) -> Storage:
    return _services(request).storage


def _parts(request: Request) -> PartsService:
    return _services(request).parts


def _operation_types(request: Request) -> OperationTypesService:
    return _services(request).operation_types


def _process_cards(request: Request) -> ProcessCardsService:
    return _services(request).process_cards


def _statistics(request: Request) -> StatisticsService:
    return _services(request).statistics


StorageDep = Annotated[Storage, Depends(_storage)]
PartsDep = Annotated[PartsService, Depends(_parts)]
OperationTypesDep = Annotated[OperationTypesService, Depends(_operation_types)]
ProcessCardsDep = Annotated[ProcessCardsService, Depends(_process_cards)]
StatisticsDep = Annotated[StatisticsService, Depends(_statistics)]

ResourceId = Annotated[
    str,
    Path(
        min_length=1,
        max_length=64,
        description='Ідентифікатор запису (24 шістнадцяткові символи ObjectId)',
        examples=[EXAMPLE_ID],
    ),
]
