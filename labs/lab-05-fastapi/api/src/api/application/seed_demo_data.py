import asyncio
from collections.abc import Mapping

from api.application.demo_data import DEMO_OPERATION_TYPES, DEMO_PARTS, DEMO_PROCESS_CARDS
from api.application.ports import (
    OperationTypeRepository,
    PartRepository,
    ProcessCardRepository,
    Saved,
    WriteResult,
)
from api.domain.operation_type import create_operation_type_details
from api.domain.part import create_part_details
from api.domain.process_card import OperationInput, ProcessCardInput, create_process_card_details


class SeedDemoData:
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

    async def execute(self) -> bool:
        counts = await asyncio.gather(
            self._parts.count(), self._operation_types.count(), self._process_cards.count()
        )
        if any(counts):
            return False

        type_ids: dict[str, str] = {}
        for type_input in DEMO_OPERATION_TYPES:
            type_details = create_operation_type_details(type_input)
            operation_type = _saved(await self._operation_types.create(type_details))
            type_ids[operation_type.name] = operation_type.id

        part_ids: dict[str, str] = {}
        for part_input in DEMO_PARTS:
            part = _saved(await self._parts.create(create_part_details(part_input)))
            part_ids[part.designation] = part.id

        for card in DEMO_PROCESS_CARDS:
            card_details = create_process_card_details(
                ProcessCardInput(
                    part_id=_lookup(part_ids, card.part),
                    operations=[
                        OperationInput(
                            operation_type_id=_lookup(type_ids, operation.type),
                            equipment=operation.equipment,
                            duration_minutes=operation.duration_minutes,
                        )
                        for operation in card.operations
                    ],
                )
            )
            _saved(await self._process_cards.create(card_details))
        return True


def _saved[T](result: WriteResult[T]) -> T:
    if not isinstance(result, Saved):
        raise RuntimeError(f'Demo data could not be saved: {result.reason}')
    return result.value


def _lookup(ids: Mapping[str, str], key: str) -> str:
    if key not in ids:
        raise RuntimeError(f'Demo data references an unknown record: {key}')
    return ids[key]
