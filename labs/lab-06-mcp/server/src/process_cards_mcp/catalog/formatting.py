from datetime import UTC, datetime
from zoneinfo import ZoneInfo

KYIV = ZoneInfo('Europe/Kyiv')
OPERATION_NUMBER_STEP = 5
_TENTHS_PER_MINUTE = 10


def round_minutes(minutes: float) -> float:
    return round(minutes * _TENTHS_PER_MINUTE) / _TENTHS_PER_MINUTE


def format_minutes(minutes: float) -> str:
    text = f'{round_minutes(minutes):.1f}'.removesuffix('.0')
    return text.replace('.', ',')


def format_duration(minutes: float) -> str:
    tenths = round(minutes * _TENTHS_PER_MINUTE)
    hours, rest = divmod(tenths, 60 * _TENTHS_PER_MINUTE)
    rest_minutes = format_minutes(rest / _TENTHS_PER_MINUTE)
    if hours == 0:
        return f'{rest_minutes} хв'
    return f'{hours} год' if rest == 0 else f'{hours} год {rest_minutes} хв'


def operation_number(index: int) -> str:
    return f'{(index + 1) * OPERATION_NUMBER_STEP:03d}'


def share_percent(part: float, whole: float) -> float:
    return round(part / whole * 100, 1) if whole > 0 else 0.0


def local_time(value: datetime) -> str:
    aware = value if value.tzinfo else value.replace(tzinfo=UTC)
    return aware.astimezone(KYIV).strftime('%Y-%m-%d %H:%M')
