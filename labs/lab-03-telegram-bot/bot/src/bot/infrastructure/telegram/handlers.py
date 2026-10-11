import logging
from collections.abc import Callable
from contextlib import suppress

from telebot import TeleBot, types, util

from bot.application import texts
from bot.application.bot_service import (
    BotService,
    IncomingCallback,
    IncomingCommand,
    IncomingText,
)
from bot.application.ports import ChatOutput
from bot.application.replies import Reply

PRIVATE_CHATS = ['private']
NON_TEXT_CONTENT = [kind for kind in util.content_type_media if kind != 'text']

Event = types.Message | types.CallbackQuery


def register_handlers(
    bot: TeleBot, service: BotService, output: ChatOutput, logger: logging.Logger
) -> None:
    def guard[E: Event](handler: Callable[[E], None]) -> Callable[[E], None]:
        def run(event: E) -> None:
            try:
                handler(event)
            except Exception:
                logger.exception('Update handling failed')
                chat_id = _chat_id(event)
                if chat_id is not None:
                    with suppress(Exception):
                        output.send(chat_id, Reply(texts.UNEXPECTED_ERROR))

        return run

    def on_command(message: types.Message) -> None:
        sender = message.from_user
        service.handle_command(
            IncomingCommand(
                chat_id=message.chat.id,
                command=util.extract_command(message.text or '') or '',
                first_name=sender.first_name if sender else None,
            )
        )

    def on_text(message: types.Message) -> None:
        service.handle_text(IncomingText(chat_id=message.chat.id, text=message.text or ''))

    def on_other(message: types.Message) -> None:
        service.handle_unsupported(message.chat.id)

    def on_callback(query: types.CallbackQuery) -> None:
        if query.message is None or query.data is None:
            output.answer_callback(query.id, texts.STALE_BUTTON)
            return
        service.handle_callback(
            IncomingCallback(
                chat_id=query.message.chat.id,
                message_id=query.message.message_id,
                callback_id=query.id,
                data=query.data,
            )
        )

    bot.register_message_handler(
        guard(on_command), func=_is_command, content_types=['text'], chat_types=PRIVATE_CHATS
    )
    bot.register_message_handler(guard(on_text), content_types=['text'], chat_types=PRIVATE_CHATS)
    bot.register_message_handler(
        guard(on_other), content_types=NON_TEXT_CONTENT, chat_types=PRIVATE_CHATS
    )
    bot.register_callback_query_handler(guard(on_callback), func=_any)


def _is_command(message: types.Message) -> bool:
    return util.is_command(message.text or '')


def _any(_query: types.CallbackQuery) -> bool:
    return True


def _chat_id(event: Event) -> int | None:
    if isinstance(event, types.Message):
        return event.chat.id
    return event.message.chat.id if event.message else None
