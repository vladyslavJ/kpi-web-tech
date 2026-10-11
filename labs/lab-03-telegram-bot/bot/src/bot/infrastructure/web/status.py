import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, tzinfo
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bot.infrastructure.telegram.control import TelegramControl

Mode = Literal['polling', 'webhook']


def _local_zone() -> tzinfo:
    try:
        return ZoneInfo('Europe/Kyiv')
    except ZoneInfoNotFoundError:
        return UTC


@dataclass(frozen=True, slots=True)
class BotStatus:
    online: bool
    username: str | None
    mode: Mode
    model: str
    started_at: datetime
    webhook_registered: bool | None = None
    webhook_error: str | None = None
    pending_updates: int | None = None


class StatusReporter:
    def __init__(
        self,
        control: TelegramControl,
        *,
        mode: Mode,
        model: str,
        expected_webhook: str | None,
        logger: logging.Logger,
        ttl_seconds: float = 30,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._control = control
        self._mode = mode
        self._model = model
        self._expected_webhook = expected_webhook
        self._logger = logger
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._started_at = datetime.now(_local_zone())
        self._username: str | None = None
        self._cached: tuple[float, BotStatus] | None = None
        self._lock = threading.Lock()

    def snapshot(self) -> BotStatus:
        with self._lock:
            now = self._clock()
            if self._cached is not None and now - self._cached[0] < self._ttl_seconds:
                return self._cached[1]
            status = self._collect()
            self._cached = (now, status)
            return status

    def _collect(self) -> BotStatus:
        base = BotStatus(
            online=False,
            username=self._username,
            mode=self._mode,
            model=self._model,
            started_at=self._started_at,
        )
        try:
            if self._username is None:
                self._username = self._control.username()
            webhook = self._control.webhook() if self._mode == 'webhook' else None
        except Exception:
            self._logger.warning('Telegram status check failed', exc_info=True)
            return base
        if webhook is None:
            return replace(base, online=True, username=self._username)
        return replace(
            base,
            online=True,
            username=self._username,
            webhook_registered=webhook.url == self._expected_webhook,
            webhook_error=webhook.last_error,
            pending_updates=webhook.pending_updates,
        )
