from enum import StrEnum

from bot.application.replies import InlineButton, InlineKeyboard, MenuKeyboard
from bot.domain.technologies import TECHNOLOGIES


class MenuItem(StrEnum):
    STUDENT = '👤 Студент'
    TECHNOLOGIES = '💻 IT-технології'
    CONTACTS = '📇 Контакти'
    PROMPT_AI = '🤖 Prompt AI'


class Command(StrEnum):
    START = 'start'
    MENU = 'menu'
    STUDENT = 'student'
    TECHNOLOGIES = 'tech'
    CONTACTS = 'contacts'
    PROMPT_AI = 'ai'
    NEW_CHAT = 'new'
    HELP = 'help'


BOT_COMMANDS: tuple[tuple[Command, str], ...] = (
    (Command.MENU, 'Головне меню'),
    (Command.STUDENT, 'Інформація про студента'),
    (Command.TECHNOLOGIES, 'IT-технології'),
    (Command.CONTACTS, 'Контакти'),
    (Command.PROMPT_AI, 'Запит до AI'),
    (Command.NEW_CHAT, 'Почати нову розмову з AI'),
    (Command.HELP, 'Довідка'),
)

EXAMPLE_PROMPTS: tuple[str, ...] = (
    'Поясни простими словами, що таке REST API',
    'Чим WebSocket відрізняється від HTTP?',
    'Як безпечно зберігати паролі користувачів?',
)

TECHNOLOGY_LIST = 'tech:list'
TECHNOLOGY_PREFIX = 'tech:'
RESET_CONVERSATION = 'ai:reset'
EXAMPLE_PREFIX = 'ai:example:'

MAIN_MENU = MenuKeyboard(
    rows=(
        (MenuItem.STUDENT, MenuItem.TECHNOLOGIES),
        (MenuItem.CONTACTS, MenuItem.PROMPT_AI),
    ),
    placeholder='Оберіть пункт меню або напишіть запит до AI',
)


def technologies_keyboard() -> InlineKeyboard:
    buttons = [
        InlineButton(item.title, callback_data=f'{TECHNOLOGY_PREFIX}{item.id}')
        for item in TECHNOLOGIES
    ]
    return InlineKeyboard(rows=tuple(tuple(buttons[i : i + 2]) for i in range(0, len(buttons), 2)))


def back_to_technologies_keyboard() -> InlineKeyboard:
    return InlineKeyboard(rows=((InlineButton('⬅️ До списку', callback_data=TECHNOLOGY_LIST),),))


def prompt_keyboard() -> InlineKeyboard:
    examples = tuple(
        (InlineButton(f'💡 {prompt}', callback_data=f'{EXAMPLE_PREFIX}{index}'),)
        for index, prompt in enumerate(EXAMPLE_PROMPTS)
    )
    reset = (InlineButton('🧹 Нова розмова', callback_data=RESET_CONVERSATION),)
    return InlineKeyboard(rows=(*examples, reset))
