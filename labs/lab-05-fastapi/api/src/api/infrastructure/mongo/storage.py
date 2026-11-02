import logging

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ConnectionFailure, PyMongoError

from api.application.errors import StorageUnavailableError
from api.infrastructure.mongo.records import Document
from api.infrastructure.mongo.repositories import (
    MongoOperationTypeRepository,
    MongoPartRepository,
    MongoProcessCardRepository,
)
from api.infrastructure.mongo.schema import (
    INDEXES,
    OPERATION_TYPES,
    PARTS,
    PROCESS_CARDS,
    VALIDATORS,
)

DEFAULT_DATABASE = 'lab05'

logger = logging.getLogger('api.mongodb')


class MongoStorage:
    def __init__(
        self, client: AsyncMongoClient[Document], database: AsyncDatabase[Document]
    ) -> None:
        self._client = client
        self.parts = MongoPartRepository(database[PARTS])
        self.operation_types = MongoOperationTypeRepository(database[OPERATION_TYPES])
        self.process_cards = MongoProcessCardRepository(database[PROCESS_CARDS])

    @classmethod
    async def connect(cls, *, uri: str, timeout_ms: int) -> 'MongoStorage':
        client: AsyncMongoClient[Document] = AsyncMongoClient(
            uri, serverSelectionTimeoutMS=timeout_ms, tz_aware=True, appname='lab-05-fastapi'
        )
        try:
            await client.admin.command('ping')
        except ConnectionFailure as error:
            await client.close()
            raise StorageUnavailableError('Cannot connect to MongoDB') from error

        database = client.get_default_database(default=DEFAULT_DATABASE)
        try:
            await _prepare(database)
        except BaseException:
            await client.close()
            raise
        logger.debug('MongoDB collections, validators and indexes are ready')
        return cls(client, database)

    async def is_available(self) -> bool:
        try:
            await self._client.admin.command('ping')
        except PyMongoError:
            return False
        return True

    async def close(self) -> None:
        await self._client.close()


async def _prepare(database: AsyncDatabase[Document]) -> None:
    existing = set(await database.list_collection_names())
    for name, validator in VALIDATORS.items():
        if name in existing:
            await database.command('collMod', name, validator=validator, validationLevel='strict')
        else:
            await database.create_collection(name, validator=validator, validationLevel='strict')
    for name, indexes in INDEXES.items():
        await database[name].create_indexes(indexes)
