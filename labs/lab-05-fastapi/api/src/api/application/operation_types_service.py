from collections.abc import Sequence

from api.application.errors import AppError
from api.application.ports import (
    OperationTypeRepository,
    ProcessCardRepository,
    Saved,
    WriteResult,
)
from api.domain.operation_type import (
    OperationType,
    OperationTypeId,
    OperationTypeInput,
    create_operation_type_details,
)


def _not_found() -> AppError:
    return AppError('NOT_FOUND', 'Operation type not found')


class OperationTypesService:
    def __init__(
        self, *, operation_types: OperationTypeRepository, process_cards: ProcessCardRepository
    ) -> None:
        self._operation_types = operation_types
        self._process_cards = process_cards

    async def list_all(self) -> Sequence[OperationType]:
        return await self._operation_types.list_all()

    async def get(self, operation_type_id: OperationTypeId) -> OperationType:
        operation_type = await self._operation_types.find(operation_type_id)
        if operation_type is None:
            raise _not_found()
        return operation_type

    async def create(self, source: OperationTypeInput) -> OperationType:
        details = create_operation_type_details(source)
        return _saved(await self._operation_types.create(details))

    async def update(
        self, operation_type_id: OperationTypeId, source: OperationTypeInput
    ) -> OperationType:
        details = create_operation_type_details(source)
        return _saved(await self._operation_types.update(operation_type_id, details))

    async def delete(self, operation_type_id: OperationTypeId) -> None:
        if await self._process_cards.is_operation_type_used(operation_type_id):
            raise AppError(
                'OPERATION_TYPE_IN_USE',
                'The operation type is used in process cards, remove those operations first',
            )
        if not await self._operation_types.delete(operation_type_id):
            raise _not_found()


def _saved(result: WriteResult[OperationType]) -> OperationType:
    if isinstance(result, Saved):
        return result.value
    if result.reason == 'duplicate':
        raise AppError(
            'OPERATION_TYPE_NAME_TAKEN', 'An operation type with this name already exists'
        )
    raise _not_found()
