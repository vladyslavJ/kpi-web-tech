from collections.abc import Iterator
from contextlib import contextmanager

from pymongo.errors import ConnectionFailure

from api.application.errors import StorageUnavailableError


@contextmanager
def storage_errors() -> Iterator[None]:
    try:
        yield
    except ConnectionFailure as error:
        raise StorageUnavailableError('MongoDB is unavailable') from error
