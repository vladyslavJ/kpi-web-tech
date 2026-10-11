import logging
from typing import cast

from telebot import TeleBot, types
from telebot.apihelper import ApiTelegramException

from bot.application.replies import InlineKeyboard, MenuKeyboard, Reply, TextFormat
from bot.infrastructure.telegram.formatting import markdown_to_html, split_markdown

HTML = 'HTML'
NO_PREVIEW = types.LinkPreviewOptions(is_disabled=True)

Markup = types.ReplyKeyboardMarkup | types.InlineKeyboardMarkup


class TelegramChatOutput:
    def __init__(self, bot: TeleBot, logger: logging.Logger) -> None:
        self._bot = bot
        self._logger = logger

    def send(self, chat_id: int, reply: Reply) -> None:
        markup = _markup(reply.keyboard)
        if reply.format is TextFormat.HTML:
            self._send(chat_id, reply.text, HTML, markup)
            return
        chunks = split_markdown(reply.text)
        for index, chunk in enumerate(chunks):
            self._send_markdown(chat_id, chunk, markup if index == len(chunks) - 1 else None)

    def edit(self, chat_id: int, message_id: int, reply: Reply) -> None:
        if isinstance(reply.keyboard, MenuKeyboard):
            raise TypeError('Only an inline keyboard can be attached to an edited message')
        text = markdown_to_html(reply.text) if reply.format is TextFormat.MARKDOWN else reply.text
        try:
            self._bot.edit_message_text(
                text,
                chat_id=chat_id,
                message_id=message_id,
                parse_mode=HTML,
                reply_markup=_inline_markup(reply.keyboard) if reply.keyboard else None,
                link_preview_options=NO_PREVIEW,
            )
        except ApiTelegramException as error:
            if 'message is not modified' not in error.description:
                raise

    def show_typing(self, chat_id: int) -> None:
        try:
            self._bot.send_chat_action(chat_id, 'typing')
        except ApiTelegramException as error:
            self._logger.debug('Typing indicator failed', extra={'reason': error.description})

    def answer_callback(self, callback_id: str, text: str | None = None) -> None:
        try:
            self._bot.answer_callback_query(cast(int, callback_id), text)
        except ApiTelegramException as error:
            self._logger.debug('Callback answer failed', extra={'reason': error.description})

    def _send_markdown(self, chat_id: int, chunk: str, markup: Markup | None) -> None:
        try:
            self._send(chat_id, markdown_to_html(chunk), HTML, markup)
        except ApiTelegramException as error:
            if error.error_code != 400 or "can't parse entities" not in error.description:
                raise
            self._logger.warning('Sending as plain text', extra={'reason': error.description})
            self._send(chat_id, chunk, None, markup)

    def _send(self, chat_id: int, text: str, parse_mode: str | None, markup: Markup | None) -> None:
        self._bot.send_message(
            chat_id,
            text,
            parse_mode=parse_mode,
            reply_markup=markup,
            link_preview_options=NO_PREVIEW,
        )


def _markup(keyboard: InlineKeyboard | MenuKeyboard | None) -> Markup | None:
    match keyboard:
        case MenuKeyboard(rows=rows, placeholder=placeholder):
            markup = types.ReplyKeyboardMarkup(
                resize_keyboard=True, is_persistent=True, input_field_placeholder=placeholder
            )
            for row in rows:
                markup.row(*(types.KeyboardButton(label) for label in row))
            return markup
        case InlineKeyboard():
            return _inline_markup(keyboard)
        case None:
            return None


def _inline_markup(keyboard: InlineKeyboard) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        keyboard=[
            [
                types.InlineKeyboardButton(
                    button.text, url=button.url, callback_data=button.callback_data
                )
                for button in row
            ]
            for row in keyboard.rows
        ]
    )
