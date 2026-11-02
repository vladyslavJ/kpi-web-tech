from collections.abc import Sequence

from api.application.errors import AppError
from api.application.ports import PartRepository, ProcessCardRepository, Saved, WriteResult
from api.domain.part import Part, PartId, PartInput, create_part_details


def _not_found() -> AppError:
    return AppError('NOT_FOUND', 'Part not found')


class PartsService:
    def __init__(self, *, parts: PartRepository, process_cards: ProcessCardRepository) -> None:
        self._parts = parts
        self._process_cards = process_cards

    async def list_all(self) -> Sequence[Part]:
        return await self._parts.list_all()

    async def get(self, part_id: PartId) -> Part:
        part = await self._parts.find(part_id)
        if part is None:
            raise _not_found()
        return part

    async def create(self, source: PartInput) -> Part:
        return _saved(await self._parts.create(create_part_details(source)))

    async def update(self, part_id: PartId, source: PartInput) -> Part:
        return _saved(await self._parts.update(part_id, create_part_details(source)))

    async def delete(self, part_id: PartId) -> None:
        if await self._process_cards.is_part_used(part_id):
            raise AppError('PART_IN_USE', 'The part has a process card, delete the card first')
        if not await self._parts.delete(part_id):
            raise _not_found()


def _saved(result: WriteResult[Part]) -> Part:
    if isinstance(result, Saved):
        return result.value
    if result.reason == 'duplicate':
        raise AppError('PART_DESIGNATION_TAKEN', 'A part with this designation already exists')
    raise _not_found()
