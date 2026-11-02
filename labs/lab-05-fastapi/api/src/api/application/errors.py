from typing import Literal

type AppErrorCode = Literal[
    'NOT_FOUND',
    'PART_DESIGNATION_TAKEN',
    'OPERATION_TYPE_NAME_TAKEN',
    'PART_ALREADY_HAS_CARD',
    'PART_IN_USE',
    'OPERATION_TYPE_IN_USE',
    'UNKNOWN_PART',
    'UNKNOWN_OPERATION_TYPE',
]


class AppError(Exception):
    def __init__(self, code: AppErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: AppErrorCode = code
        self.message = message


class StorageUnavailableError(Exception):
    pass
