import logging
from dataclasses import dataclass

from telebot import TeleBot, types

from bot.application.menu import BOT_COMMANDS

ALLOWED_UPDATES = ['message', 'callback_query']


@dataclass(frozen=True, slots=True)
class WebhookState:
    url: str
    pending_updates: int
    last_error: str | None


class TelegramControl:
    def __init__(self, bot: TeleBot, logger: logging.Logger) -> None:
        self._bot = bot
        self._logger = logger

    def username(self) -> str:
        username = self._bot.get_me().username
        if not username:
            raise RuntimeError('Telegram returned a bot without a username')
        return username

    def publish_commands(self) -> None:
        commands = [types.BotCommand(command.value, title) for command, title in BOT_COMMANDS]
        try:
            self._bot.set_my_commands(commands)
        except Exception:
            self._logger.warning('Could not publish the command menu', exc_info=True)

    def webhook(self) -> WebhookState:
        info = self._bot.get_webhook_info()
        return WebhookState(
            url=info.url or '',
            pending_updates=info.pending_update_count or 0,
            last_error=info.last_error_message or None,
        )

    def use_webhook(self, url: str, secret: str) -> None:
        self._bot.set_webhook(
            url=url,
            secret_token=secret,
            allowed_updates=ALLOWED_UPDATES,
            max_connections=1,
        )
        self._logger.info('Webhook registered', extra={'url': url})

    def use_polling(self) -> None:
        current = self.webhook().url
        if current:
            self._logger.warning(
                'Removing the webhook to receive updates by polling; '
                'reload the web app on PythonAnywhere to register it again',
                extra={'webhook': current},
            )
        self._bot.delete_webhook()

    def remove_webhook(self) -> None:
        self._bot.delete_webhook()
        self._logger.info('Webhook removed')
