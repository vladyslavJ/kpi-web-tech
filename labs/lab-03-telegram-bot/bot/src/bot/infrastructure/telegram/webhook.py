import hmac
import logging
from typing import Protocol

from telebot import TeleBot, types

WEBHOOK_AUTH_HEADER = 'X-Telegram-Bot-Api-Secret-Token'


class UpdateJournal(Protocol):
    def first_seen(self, update_id: int) -> bool: ...


class InvalidUpdateError(ValueError):
    pass


class WebhookReceiver:
    def __init__(
        self, bot: TeleBot, journal: UpdateJournal, secret: str, logger: logging.Logger
    ) -> None:
        self._bot = bot
        self._journal = journal
        self._secret = secret.encode()
        self._logger = logger

    def authorized(self, token: str | None) -> bool:
        return token is not None and hmac.compare_digest(token.encode(), self._secret)

    def receive(self, payload: object) -> None:
        if not isinstance(payload, dict) or not isinstance(payload.get('update_id'), int):
            raise InvalidUpdateError('The body is not a Telegram update')
        update_id: int = payload['update_id']
        if not self._journal.first_seen(update_id):
            self._logger.info('Duplicate update skipped', extra={'update_id': update_id})
            return
        update = types.Update.de_json(payload)
        if update is not None:
            self._bot.process_new_updates([update])
