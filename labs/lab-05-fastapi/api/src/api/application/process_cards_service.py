from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from api.application.errors import AppError
from api.application.ports import (
    OperationTypeRepository,
    PartRepository,
    ProcessCardRepository,
    Saved,
    WriteResult,
)
from api.domain.operation_type import OperationType, OperationTypeId
from api.domain.part import Part
from api.domain.process_card import (
    ProcessCard,
    ProcessCardDetails,
    ProcessCardId,
    ProcessCardInput,
    create_process_card_details,
    referenced_operation_types,
)


@dataclass(frozen=True, slots=True)
class ProcessCardView:
    card: ProcessCard
    part: Part
    operation_types: Mapping[OperationTypeId, OperationType]


def _not_found() -> AppError:
    return AppError('NOT_FOUND', 'Process card not found')


class ProcessCardsService:
    def __init__(
        self,
        *,
        process_cards: ProcessCardRepository,
        parts: PartRepository,
        operation_types: OperationTypeRepository,
    ) -> None:
        self._process_cards = process_cards
        self._parts = parts
        self._operation_types = operation_types

    async def list_all(self) -> Sequence[ProcessCardView]:
        views = await self._views(await self._process_cards.list_all())
        return sorted(views, key=lambda view: view.part.designation)

    async def get(self, card_id: ProcessCardId) -> ProcessCardView:
        card = await self._process_cards.find(card_id)
        if card is None:
            raise _not_found()
        return await self._view(card)

    async def create(self, source: ProcessCardInput) -> ProcessCardView:
        details = create_process_card_details(source)
        await self._check_references(details)
        return await self._saved(await self._process_cards.create(details))

    async def update(self, card_id: ProcessCardId, source: ProcessCardInput) -> ProcessCardView:
        details = create_process_card_details(source)
        if await self._process_cards.find(card_id) is None:
            raise _not_found()
        await self._check_references(details)
        return await self._saved(await self._process_cards.update(card_id, details))

    async def delete(self, card_id: ProcessCardId) -> None:
        if not await self._process_cards.delete(card_id):
            raise _not_found()

    async def _check_references(self, details: ProcessCardDetails) -> None:
        if await self._parts.find(details.part_id) is None:
            raise AppError('UNKNOWN_PART', 'The referenced part does not exist')
        ids = referenced_operation_types(details)
        found = {operation_type.id for operation_type in await self._operation_types.find_many(ids)}
        missing = next((type_id for type_id in ids if type_id not in found), None)
        if missing is not None:
            raise AppError('UNKNOWN_OPERATION_TYPE', f'Operation type {missing} does not exist')

    async def _saved(self, result: WriteResult[ProcessCard]) -> ProcessCardView:
        if isinstance(result, Saved):
            return await self._view(result.value)
        if result.reason == 'duplicate':
            raise AppError('PART_ALREADY_HAS_CARD', 'The part already has a process card')
        raise _not_found()

    async def _view(self, card: ProcessCard) -> ProcessCardView:
        [view] = await self._views([card])
        return view

    async def _views(self, cards: Sequence[ProcessCard]) -> list[ProcessCardView]:
        part_ids = list(dict.fromkeys(card.part_id for card in cards))
        type_ids = list(
            dict.fromkeys(type_id for card in cards for type_id in referenced_operation_types(card))
        )
        parts = {part.id: part for part in await self._parts.find_many(part_ids)}
        operation_types = {
            operation_type.id: operation_type
            for operation_type in await self._operation_types.find_many(type_ids)
        }

        views: list[ProcessCardView] = []
        for card in cards:
            part = parts.get(card.part_id)
            resolved = all(
                operation.operation_type_id in operation_types for operation in card.operations
            )
            if part is None or not resolved:
                raise RuntimeError(
                    f'Process card {card.id} references a deleted part or operation type'
                )
            views.append(ProcessCardView(card, part, operation_types))
        return views
