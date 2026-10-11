from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Technology:
    id: str
    title: str
    summary: str
    used_in: str


TECHNOLOGIES: tuple[Technology, ...] = (
    Technology(
        id='node',
        title='Node.js і TypeScript',
        summary=(
            'Node.js виконує JavaScript на сервері й обробляє тисячі з’єднань '
            'завдяки неблокувальному введенню-виведенню. TypeScript додає статичну '
            'типізацію, тому більшість помилок видно ще до запуску програми.'
        ),
        used_in='сервери лабораторних робіт №1 і №2',
    ),
    Technology(
        id='angular',
        title='Angular',
        summary=(
            'Фреймворк для односторінкових вебзастосунків. Сучасні версії керують '
            'станом через сигнали, працюють без zone.js і мають вбудовані форми '
            'з валідацією.'
        ),
        used_in='клієнти лабораторних робіт №1 і №2',
    ),
    Technology(
        id='websocket',
        title='WebSocket і Socket.IO',
        summary=(
            'WebSocket тримає постійне двостороннє з’єднання, тому сервер надсилає '
            'дані миттєво, без повторних запитів клієнта. Socket.IO додає кімнати, '
            'підтвердження доставки та автоматичне перепідключення.'
        ),
        used_in='чат реального часу в лабораторній роботі №1',
    ),
    Technology(
        id='jwt',
        title='JWT',
        summary=(
            'JSON Web Token — підписаний токен із даними користувача, який клієнт '
            'передає в заголовку Authorization. Сервер перевіряє підпис і термін дії, '
            'тож не мусить зберігати сесії.'
        ),
        used_in='реєстрація та авторизація в лабораторній роботі №2',
    ),
    Technology(
        id='python',
        title='Python',
        summary=(
            'Мова з лаконічним синтаксисом і величезною кількістю бібліотек для вебу, '
            'автоматизації та роботи з даними. Анотації типів разом із mypy роблять '
            'код надійнішим.'
        ),
        used_in='цей бот: pyTelegramBotAPI, Flask, Pydantic',
    ),
    Technology(
        id='telegram',
        title='Telegram Bot API',
        summary=(
            'HTTP-інтерфейс, через який бот отримує повідомлення й надсилає відповіді. '
            'Оновлення можна забирати опитуванням (long polling) або отримувати '
            'на вебхук, а меню будуються з reply- та inline-клавіатур.'
        ),
        used_in='меню й обробка повідомлень у лабораторній роботі №3',
    ),
    Technology(
        id='llm',
        title='Генеративний AI',
        summary=(
            'Великі мовні моделі (LLM) генерують текст у відповідь на запит. '
            'Groq запускає відкриті моделі на спеціалізованих чипах, тому відповідь '
            'приходить за долі секунди.'
        ),
        used_in='пункт меню «Prompt AI» у лабораторній роботі №3',
    ),
)


def find_technology(technology_id: str) -> Technology | None:
    return next((item for item in TECHNOLOGIES if item.id == technology_id), None)
