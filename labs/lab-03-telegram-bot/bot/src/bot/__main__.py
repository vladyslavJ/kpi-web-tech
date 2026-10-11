import argparse
import logging
import signal
import threading
from collections.abc import Sequence
from types import FrameType

from waitress.server import create_server

from bot.app import (
    build_application,
    create_assistant,
    create_telegram,
    setup_logging,
    webhook_target,
)
from bot.config import ConfigError, Settings, load_settings_or_exit
from bot.infrastructure.telegram.control import ALLOWED_UPDATES, TelegramControl


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog='python -m bot', description='Telegram bot for lab 3')
    commands = parser.add_subparsers(dest='command')
    commands.add_parser('run', help='poll Telegram for updates and serve the status page on PORT')
    webhook = commands.add_parser('webhook', help='manage the Telegram webhook')
    webhook.add_argument('action', choices=['set', 'delete', 'info'])
    commands.add_parser('check', help='check the configuration and access to Telegram and Groq')
    args = parser.parse_args(argv)

    settings = load_settings_or_exit()
    logger = setup_logging(settings)
    try:
        match args.command:
            case 'webhook':
                return manage_webhook(settings, logger, args.action)
            case 'check':
                return check(settings, logger)
            case _:
                return run(settings, logger)
    except ConfigError as error:
        logger.error(str(error))
        return 1


def run(settings: Settings, logger: logging.Logger) -> int:
    application = build_application(settings, logger=logger)
    try:
        application.control.use_polling()
        username = application.control.username()
    except Exception as error:
        logger.error('Telegram is not reachable', extra={'reason': str(error)})
        return 1
    application.control.publish_commands()

    server = create_server(
        application.web('polling'), listen=f'localhost:{settings.port}', threads=2
    )
    threading.Thread(target=server.run, name='status-page', daemon=True).start()
    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, _interrupt)
    logger.info(
        'Bot is running',
        extra={
            'environment': settings.app_env,
            'bot': f'https://t.me/{username}',
            'status_page': f'http://localhost:{settings.port}',
            'model': settings.groq_model,
        },
    )
    try:
        application.telegram.infinity_polling(
            timeout=30, long_polling_timeout=20, allowed_updates=ALLOWED_UPDATES
        )
    finally:
        server.close()
        logger.info('Bot stopped')
    return 0


def manage_webhook(settings: Settings, logger: logging.Logger, action: str) -> int:
    control = TelegramControl(create_telegram(settings), logger)
    if action == 'set':
        target = webhook_target(settings)
        control.use_webhook(target.url, target.secret)
    elif action == 'delete':
        control.remove_webhook()
    state = control.webhook()
    logger.info(
        'Webhook state',
        extra={
            'url': state.url or '(none)',
            'pending_updates': state.pending_updates,
            'last_error': state.last_error or '(none)',
        },
    )
    return 0


def check(settings: Settings, logger: logging.Logger) -> int:
    healthy = True
    control = TelegramControl(create_telegram(settings), logger)
    try:
        logger.info('Telegram is reachable', extra={'bot': f'@{control.username()}'})
    except Exception as error:
        healthy = False
        logger.error('Telegram check failed', extra={'reason': str(error)})
    try:
        model = create_assistant(settings).check_model()
        logger.info('Groq is reachable', extra={'model': model})
    except Exception as error:
        healthy = False
        logger.error('Groq check failed', extra={'reason': str(error)})
    if healthy and settings.webhook_url:
        state = control.webhook()
        registered = state.url == settings.webhook_url
        log = logger.info if registered else logger.warning
        log(
            'Webhook is registered' if registered else 'Webhook is not registered',
            extra={'expected': settings.webhook_url, 'actual': state.url or '(none)'},
        )
    return 0 if healthy else 1


def _interrupt(_signal: int, _frame: FrameType | None) -> None:
    raise KeyboardInterrupt


if __name__ == '__main__':
    raise SystemExit(main())
