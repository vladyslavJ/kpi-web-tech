from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from bot.application.replies import Reply
from bot.domain.conversation import ChatMessage


@dataclass(frozen=True, slots=True)
class AiAnswer:
    text: str
    truncated: bool = False


class AiAssistant(Protocol):
    def answer(self, instructions: str, conversation: Sequence[ChatMessage]) -> AiAnswer: ...


class ConversationRepository(Protocol):
    def recent(self, chat_id: int, limit: int) -> list[ChatMessage]: ...

    def append(self, chat_id: int, messages: Sequence[ChatMessage]) -> None: ...

    def clear(self, chat_id: int) -> None: ...


class ChatOutput(Protocol):
    def send(self, chat_id: int, reply: Reply) -> None: ...

    def edit(self, chat_id: int, message_id: int, reply: Reply) -> None: ...

    def show_typing(self, chat_id: int) -> None: ...

    def answer_callback(self, callback_id: str, text: str | None = None) -> None: ...
