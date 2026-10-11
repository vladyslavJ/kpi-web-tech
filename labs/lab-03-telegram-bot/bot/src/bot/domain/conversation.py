from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    USER = 'user'
    ASSISTANT = 'assistant'


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: Role
    content: str


def recent_context(
    messages: Sequence[ChatMessage], *, max_messages: int, max_chars: int
) -> list[ChatMessage]:
    selected: list[ChatMessage] = []
    used = 0
    for message in reversed(messages):
        if len(selected) >= max_messages or used + len(message.content) > max_chars:
            break
        selected.append(message)
        used += len(message.content)
    selected.reverse()
    while selected and selected[0].role is not Role.USER:
        selected.pop(0)
    return selected
