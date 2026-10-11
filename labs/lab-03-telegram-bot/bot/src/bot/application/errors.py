from enum import StrEnum


class AiFailure(StrEnum):
    RATE_LIMITED = 'rate_limited'
    UNAVAILABLE = 'unavailable'
    EMPTY_ANSWER = 'empty_answer'


class AiError(Exception):
    def __init__(self, failure: AiFailure, detail: str = '') -> None:
        super().__init__(detail or failure.value)
        self.failure = failure
