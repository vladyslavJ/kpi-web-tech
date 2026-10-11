from dataclasses import dataclass
from enum import StrEnum

CALLBACK_DATA_LIMIT = 64


class TextFormat(StrEnum):
    HTML = 'html'
    MARKDOWN = 'markdown'


@dataclass(frozen=True, slots=True)
class InlineButton:
    text: str
    callback_data: str | None = None
    url: str | None = None

    def __post_init__(self) -> None:
        if (self.callback_data is None) == (self.url is None):
            raise ValueError('An inline button needs exactly one of callback_data or url')
        if self.callback_data is not None and (
            len(self.callback_data.encode()) > CALLBACK_DATA_LIMIT
        ):
            raise ValueError(f'Callback data is longer than {CALLBACK_DATA_LIMIT} bytes')


@dataclass(frozen=True, slots=True)
class InlineKeyboard:
    rows: tuple[tuple[InlineButton, ...], ...]


@dataclass(frozen=True, slots=True)
class MenuKeyboard:
    rows: tuple[tuple[str, ...], ...]
    placeholder: str | None = None


@dataclass(frozen=True, slots=True)
class Reply:
    text: str
    format: TextFormat = TextFormat.HTML
    keyboard: InlineKeyboard | MenuKeyboard | None = None
