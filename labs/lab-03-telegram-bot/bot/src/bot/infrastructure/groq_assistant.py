from collections.abc import Sequence

import groq
from groq import Groq, omit
from groq.types.chat import ChatCompletionMessageParam

from bot.application.errors import AiError, AiFailure
from bot.application.ports import AiAnswer
from bot.config import ReasoningEffort
from bot.domain.conversation import ChatMessage, Role


class GroqAssistant:
    def __init__(
        self,
        *,
        client: Groq,
        model: str,
        reasoning_effort: ReasoningEffort | None,
        max_answer_tokens: int,
        temperature: float = 0.6,
    ) -> None:
        self._client = client
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._max_answer_tokens = max_answer_tokens
        self._temperature = temperature

    def answer(self, instructions: str, conversation: Sequence[ChatMessage]) -> AiAnswer:
        try:
            completion = self._client.chat.completions.create(
                model=self._model,
                messages=_to_messages(instructions, conversation),
                max_completion_tokens=self._max_answer_tokens,
                temperature=self._temperature,
                reasoning_effort=omit if self._reasoning_effort is None else self._reasoning_effort,
            )
        except groq.RateLimitError as error:
            raise AiError(AiFailure.RATE_LIMITED, str(error)) from error
        except groq.APIError as error:
            raise AiError(AiFailure.UNAVAILABLE, str(error)) from error

        if not completion.choices:
            raise AiError(AiFailure.EMPTY_ANSWER, 'The completion has no choices')
        choice = completion.choices[0]
        text = (choice.message.content or '').strip()
        if not text:
            raise AiError(AiFailure.EMPTY_ANSWER, f'Finish reason: {choice.finish_reason}')
        return AiAnswer(text=text, truncated=choice.finish_reason == 'length')

    def check_model(self) -> str:
        available = {model.id for model in self._client.models.list().data}
        if self._model not in available:
            raise AiError(AiFailure.UNAVAILABLE, f'Model {self._model} is not available')
        return self._model


def _to_messages(
    instructions: str, conversation: Sequence[ChatMessage]
) -> list[ChatCompletionMessageParam]:
    messages: list[ChatCompletionMessageParam] = [{'role': 'system', 'content': instructions}]
    for message in conversation:
        if message.role is Role.USER:
            messages.append({'role': 'user', 'content': message.content})
        else:
            messages.append({'role': 'assistant', 'content': message.content})
    return messages
