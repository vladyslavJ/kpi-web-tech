from collections.abc import Callable, Mapping, Sequence
from typing import Any

from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.collation import Collation
from pymongo.errors import DuplicateKeyError

from api.application.ports import OperationTypeWorkload, Rejected, Saved, WriteResult
from api.domain.operation_type import OperationType, OperationTypeDetails, OperationTypeId
from api.domain.part import Part, PartDetails, PartId
from api.domain.process_card import (
    ProcessCard,
    ProcessCardDetails,
    ProcessCardId,
    round_duration,
)
from api.infrastructure.mongo.errors import storage_errors
from api.infrastructure.mongo.records import (
    Document,
    object_id,
    operation_type_document,
    part_document,
    process_card_document,
    to_operation_type,
    to_part,
    to_process_card,
    utc_now,
)
from api.infrastructure.mongo.schema import UKRAINIAN_CASE_INSENSITIVE

type Collection = AsyncCollection[Document]


class MongoRepository[TEntity, TDetails, TId: str]:
    def __init__(
        self,
        collection: Collection,
        *,
        to_entity: Callable[[Mapping[str, Any]], TEntity],
        to_document: Callable[[TDetails], Document],
        sort: Sequence[tuple[str, int]],
        collation: Collation | None = None,
    ) -> None:
        self._collection = collection
        self._to_entity = to_entity
        self._to_document = to_document
        self._sort = list(sort)
        self._collation = collation

    async def list_all(self) -> Sequence[TEntity]:
        with storage_errors():
            cursor = self._collection.find({}, sort=self._sort, collation=self._collation)
            return [self._to_entity(document) async for document in cursor]

    async def count(self) -> int:
        with storage_errors():
            return await self._collection.count_documents({})

    async def find(self, entity_id: TId) -> TEntity | None:
        key = object_id(entity_id)
        if key is None:
            return None
        with storage_errors():
            document = await self._collection.find_one({'_id': key})
        return None if document is None else self._to_entity(document)

    async def find_many(self, entity_ids: Sequence[TId]) -> Sequence[TEntity]:
        keys = [key for key in map(object_id, entity_ids) if key is not None]
        if not keys:
            return []
        with storage_errors():
            cursor = self._collection.find({'_id': {'$in': keys}})
            return [self._to_entity(document) async for document in cursor]

    async def create(self, details: TDetails) -> WriteResult[TEntity]:
        now = utc_now()
        document = {**self._to_document(details), 'createdAt': now, 'updatedAt': now}
        with storage_errors():
            try:
                result = await self._collection.insert_one(document)
            except DuplicateKeyError:
                return Rejected('duplicate')
        return Saved(self._to_entity({**document, '_id': result.inserted_id}))

    async def update(self, entity_id: TId, details: TDetails) -> WriteResult[TEntity]:
        key = object_id(entity_id)
        if key is None:
            return Rejected('not-found')
        changes = {**self._to_document(details), 'updatedAt': utc_now()}
        with storage_errors():
            try:
                document = await self._collection.find_one_and_update(
                    {'_id': key}, {'$set': changes}, return_document=ReturnDocument.AFTER
                )
            except DuplicateKeyError:
                return Rejected('duplicate')
        return Rejected('not-found') if document is None else Saved(self._to_entity(document))

    async def delete(self, entity_id: TId) -> bool:
        key = object_id(entity_id)
        if key is None:
            return False
        with storage_errors():
            result = await self._collection.delete_one({'_id': key})
        return result.deleted_count == 1


class MongoPartRepository(MongoRepository[Part, PartDetails, PartId]):
    def __init__(self, collection: Collection) -> None:
        super().__init__(
            collection,
            to_entity=to_part,
            to_document=part_document,
            sort=[('designation', ASCENDING)],
            collation=Collation(locale='uk', numericOrdering=True),
        )


class MongoOperationTypeRepository(
    MongoRepository[OperationType, OperationTypeDetails, OperationTypeId]
):
    def __init__(self, collection: Collection) -> None:
        super().__init__(
            collection,
            to_entity=to_operation_type,
            to_document=operation_type_document,
            sort=[('name', ASCENDING)],
            collation=UKRAINIAN_CASE_INSENSITIVE,
        )


class MongoProcessCardRepository(MongoRepository[ProcessCard, ProcessCardDetails, ProcessCardId]):
    def __init__(self, collection: Collection) -> None:
        super().__init__(
            collection,
            to_entity=to_process_card,
            to_document=process_card_document,
            sort=[('createdAt', ASCENDING)],
        )

    async def is_part_used(self, part_id: PartId) -> bool:
        return await self._exists('part', part_id)

    async def is_operation_type_used(self, operation_type_id: OperationTypeId) -> bool:
        return await self._exists('operations.operationType', operation_type_id)

    async def workload(self) -> Sequence[OperationTypeWorkload]:
        pipeline: list[Document] = [
            {'$unwind': '$operations'},
            {
                '$group': {
                    '_id': '$operations.operationType',
                    'operations': {'$sum': 1},
                    'totalDurationMinutes': {'$sum': '$operations.durationMinutes'},
                }
            },
        ]
        with storage_errors():
            cursor = await self._collection.aggregate(pipeline)
            return [
                OperationTypeWorkload(
                    operation_type_id=OperationTypeId(str(row['_id'])),
                    operations=row['operations'],
                    total_duration_minutes=round_duration(row['totalDurationMinutes']),
                )
                async for row in cursor
            ]

    async def _exists(self, field: str, value: str) -> bool:
        key = object_id(value)
        if key is None:
            return False
        with storage_errors():
            return await self._collection.find_one({field: key}, projection={'_id': 1}) is not None
