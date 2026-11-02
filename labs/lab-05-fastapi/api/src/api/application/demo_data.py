from dataclasses import dataclass

from api.domain.operation_type import OperationTypeInput
from api.domain.part import PartInput


@dataclass(frozen=True, slots=True)
class DemoOperation:
    type: str
    equipment: str | None
    duration_minutes: float


@dataclass(frozen=True, slots=True)
class DemoProcessCard:
    part: str
    operations: tuple[DemoOperation, ...]


DEMO_OPERATION_TYPES = (
    OperationTypeInput('Заготівельна', 'Відрізання заготовки з прутка, труби або листа'),
    OperationTypeInput('Токарна', 'Обробка поверхонь обертання різцями на токарному верстаті'),
    OperationTypeInput('Фрезерна', 'Обробка площин, уступів, пазів і зубів фрезами'),
    OperationTypeInput('Свердлильна', 'Свердління, зенкерування та розвертання отворів'),
    OperationTypeInput(
        'Шліфувальна',
        'Чистова обробка абразивним кругом до точного розміру й низької шорсткості',
    ),
    OperationTypeInput('Термічна', 'Гартування та відпуск для отримання потрібної твердості'),
    OperationTypeInput('Слюсарна', 'Зняття задирок і притуплення гострих кромок'),
    OperationTypeInput('Контрольна', 'Перевірка розмірів, форми та шорсткості за кресленням'),
)

DEMO_PARTS = (
    PartInput('КПІ.301.011', 'Вал ведучий', 'Сталь 45'),
    PartInput('КПІ.302.017', 'Колесо зубчасте циліндричне', 'Сталь 40Х'),
    PartInput('КПІ.305.004', 'Втулка', 'Бронза БрО10Ф1'),
    PartInput('КПІ.310.022', 'Корпус підшипника', 'Чавун СЧ20'),
    PartInput('КПІ.320.008', 'Фланець', 'Сталь 20'),
)

DEMO_PROCESS_CARDS = (
    DemoProcessCard(
        'КПІ.301.011',
        (
            DemoOperation('Заготівельна', 'Стрічкопильний верстат 8544', 2.5),
            DemoOperation('Токарна', 'Токарно-гвинторізний верстат 16К20', 18),
            DemoOperation('Фрезерна', 'Вертикально-фрезерний верстат 6Р12', 9.5),
            DemoOperation('Термічна', 'Установка СВЧ-гартування', 45),
            DemoOperation('Шліфувальна', 'Круглошліфувальний верстат 3М151', 12),
            DemoOperation('Контрольна', None, 4),
        ),
    ),
    DemoProcessCard(
        'КПІ.302.017',
        (
            DemoOperation('Заготівельна', 'Стрічкопильний верстат 8544', 3),
            DemoOperation('Токарна', 'Токарний верстат з ЧПК 16А20Ф3', 22),
            DemoOperation('Фрезерна', 'Зубофрезерний верстат 5К324', 35),
            DemoOperation('Термічна', 'Шахтна піч', 60),
            DemoOperation('Шліфувальна', 'Внутрішньошліфувальний верстат 3К228', 15),
            DemoOperation('Контрольна', None, 5),
        ),
    ),
    DemoProcessCard(
        'КПІ.305.004',
        (
            DemoOperation('Токарна', 'Токарно-револьверний верстат 1П365', 11.5),
            DemoOperation('Свердлильна', 'Вертикально-свердлильний верстат 2Н135', 4),
            DemoOperation('Слюсарна', 'Верстак слюсарний', 3),
            DemoOperation('Контрольна', None, 2),
        ),
    ),
    DemoProcessCard(
        'КПІ.310.022',
        (
            DemoOperation('Фрезерна', 'Горизонтально-фрезерний верстат 6Р82', 28),
            DemoOperation('Свердлильна', 'Радіально-свердлильний верстат 2Н55', 14),
            DemoOperation('Слюсарна', 'Верстак слюсарний', 6),
            DemoOperation('Контрольна', None, 5),
        ),
    ),
)
