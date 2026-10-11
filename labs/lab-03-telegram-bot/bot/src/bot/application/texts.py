from html import escape

from bot.application.errors import AiFailure
from bot.domain.student import Contacts, Student
from bot.domain.technologies import Technology

MENU_HINT = 'Оберіть пункт меню нижче або просто напишіть запитання для AI.'

HELP = (
    '<b>Що вміє бот</b>\n\n'
    '👤 <b>Студент</b> — хто виконав роботу\n'
    '💻 <b>IT-технології</b> — технології, використані в лабораторних роботах\n'
    '📇 <b>Контакти</b> — як зв’язатися з автором\n'
    '🤖 <b>Prompt AI</b> — запит до штучного інтелекту\n\n'
    'Будь-який текст, що не є пунктом меню, бот надсилає AI й пам’ятає контекст '
    'розмови. Команда /new починає розмову з чистого аркуша.\n\n'
    'Команди: /menu /student /tech /contacts /ai /new /help'
)

TECHNOLOGIES = (
    '💻 <b>IT-технології</b>\n\n'
    'Технології, використані в лабораторних роботах курсу «Основи WEB технологій». '
    'Оберіть, щоб дізнатися більше.'
)

CONVERSATION_RESET = '🧹 Розмову з AI очищено. Можна починати нову тему.'
UNSUPPORTED_CONTENT = (
    'Я розумію лише текстові повідомлення. Оберіть пункт меню або напишіть запитання.'
)
UNKNOWN_COMMAND = 'Такої команди немає. Список команд — /help.'
STALE_BUTTON = 'Ця кнопка вже неактуальна'
UNEXPECTED_ERROR = '😵 Щось пішло не так. Спробуйте ще раз.'
TRUNCATED_NOTE = '\n\n*(відповідь скорочено через обмеження довжини)*'

AI_FAILURES: dict[AiFailure, str] = {
    AiFailure.RATE_LIMITED: '⏳ Забагато запитів до AI. Спробуйте за хвилину.',
    AiFailure.UNAVAILABLE: '⚠️ AI тимчасово недоступний. Спробуйте трохи пізніше.',
    AiFailure.EMPTY_ANSWER: (
        '🤷 AI не зміг сформулювати відповідь. Спробуйте переформулювати запит.'
    ),
}


def welcome(first_name: str | None) -> str:
    greeting = f'Привіт, {escape(first_name)}!' if first_name else 'Привіт!'
    return (
        f'{greeting} Я навчальний бот лабораторної роботи №3 з курсу '
        '«Основи WEB технологій».\n\n'
        f'{MENU_HINT}'
    )


def student_card(student: Student) -> str:
    return (
        '👤 <b>Студент</b>\n\n'
        f'<b>ПІБ:</b> {escape(student.full_name)}\n'
        f'<b>Група:</b> {escape(student.group)}\n'
        f'<b>Варіант:</b> {student.variant}\n'
        f'<b>Університет:</b> {escape(student.university)}'
    )


def contacts_card(contacts: Contacts) -> str:
    if contacts.is_empty:
        return '📇 <b>Контакти</b>\n\nКонтакти ще не додано.'
    lines = ['📇 <b>Контакти</b>', '']
    if contacts.phone:
        lines.append(f'📞 <b>Телефон:</b> {escape(contacts.phone)}')
    if contacts.email:
        lines.append(f'✉️ <b>E-mail:</b> {escape(contacts.email)}')
    if contacts.telegram:
        lines.append(f'💬 <b>Telegram:</b> {escape(contacts.telegram)}')
    if contacts.github:
        url = escape(contacts.github, quote=True)
        lines.append(f'🐙 <b>GitHub:</b> <a href="{url}">{escape(contacts.github)}</a>')
    return '\n'.join(lines)


def technology_card(technology: Technology) -> str:
    return (
        f'💻 <b>{escape(technology.title)}</b>\n\n'
        f'{escape(technology.summary)}\n\n'
        f'<i>Де використано:</i> {escape(technology.used_in)}'
    )


def prompt_intro(model: str) -> str:
    return (
        '🤖 <b>Prompt AI</b>\n\n'
        'Напишіть запитання звичайним повідомленням — відповідь згенерує модель '
        f'<code>{escape(model)}</code> через Groq. Бот пам’ятає останні повідомлення, '
        'тому можна ставити уточнювальні запитання.\n\n'
        'Або спробуйте один із прикладів:'
    )


def prompt_echo(prompt: str) -> str:
    return f'❓ <i>{escape(prompt)}</i>'


def prompt_too_long(length: int, limit: int) -> str:
    return f'✂️ Запит задовгий: {length} символів. Максимум — {limit}.'
