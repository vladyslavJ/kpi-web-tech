from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import Field

from process_cards_mcp.catalog.models import (
    OperationTypeList,
    OperationTypeSortField,
    Overview,
    PartList,
    PartSortField,
    ProcessCardDetail,
    ProcessCardList,
    ProcessCardSortField,
    SearchResult,
    SortOrder,
)
from process_cards_mcp.catalog.ports import (
    CatalogReader,
    CatalogUnavailableError,
    OperationTypeQuery,
    PartQuery,
    ProcessCardNotFoundError,
    ProcessCardQuery,
)

NAME = 'process-cards'
VERSION = '1.0.0'

INSTRUCTIONS = """\
Сервер дає доступ лише на читання до бази технологічних карт деталей у MongoDB.
Деталь має позначення (наприклад КПІ.301.011), найменування й матеріал. Вид обробки має назву
й опис. Технологічна карта описує маршрут обробки деталі: операції 005, 010… з видом обробки,
обладнанням і тривалістю у хвилинах.
Для загальної картини викликай get_overview. Для таблиць із сортуванням використовуй list_parts,
list_operation_types і list_process_cards з параметрами sort_by та order. Повну карту однієї
деталі дає get_process_card, а пошук за словом чи фрагментом виконує search.
Відповідай українською й не вигадуй даних, яких немає у відповідях інструментів.
"""

READ_ONLY = ToolAnnotations(readOnlyHint=True, idempotentHint=True, openWorldHint=False)

Order = Annotated[
    SortOrder, Field(description='asc — за зростанням (А→Я, менше→більше), desc — за спаданням')
]
Limit = Annotated[int, Field(ge=1, le=200, description='Скільки рядків повернути')]
Minutes = Annotated[float | None, Field(ge=0, description='Хвилини')]


@contextmanager
def _tool_errors() -> Iterator[None]:
    try:
        yield
    except CatalogUnavailableError as error:
        raise ToolError(
            'База даних MongoDB недоступна. Запустіть ./run.sh у теці лабораторної роботи 6 '
            'або контейнер kpi-labs-mongo і повторіть запит.'
        ) from error
    except ProcessCardNotFoundError as error:
        reason = (
            'деталь існує, але технологічної карти для неї ще немає'
            if error.part_exists
            else 'деталі з таким позначенням немає в базі'
        )
        known = ', '.join(error.known) or 'немає'
        raise ToolError(
            f'Технологічну карту для «{error.designation}» не знайдено: {reason}. '
            f'Карти є для деталей: {known}.'
        ) from error


def create_server(catalog: CatalogReader) -> MCPServer:
    server = MCPServer(
        NAME,
        title='Технологічні карти',
        description='Інструменти для читання, сортування й пошуку в базі технологічних карт',
        instructions=INSTRUCTIONS,
        version=VERSION,
    )

    @server.tool(
        title='Зведення по базі',
        annotations=READ_ONLY,
        description=(
            'Зведення по всій базі: кількість деталей, видів обробки, технологічних карт і '
            'операцій, сумарна трудомісткість, трудомісткість кожного виду обробки (від '
            'найбільшої) і перелік деталей, для яких ще немає технологічної карти.'
        ),
    )
    async def get_overview() -> Overview:
        with _tool_errors():
            return await catalog.overview()

    @server.tool(
        title='Деталі',
        annotations=READ_ONLY,
        description=(
            'Таблиця деталей: позначення, найменування, матеріал і наявність технологічної '
            'карти. Сортування виконує MongoDB з українським алфавітним порядком.'
        ),
    )
    async def list_parts(
        sort_by: Annotated[
            PartSortField,
            Field(
                description='Поле сортування: designation — позначення, name — найменування, '
                'material — матеріал, created_at — дата додавання'
            ),
        ] = 'designation',
        order: Order = 'asc',
        limit: Limit = 50,
    ) -> PartList:
        with _tool_errors():
            return await catalog.list_parts(PartQuery(sort_by, order, limit))

    @server.tool(
        title='Види обробки',
        annotations=READ_ONLY,
        description=(
            'Довідник видів обробки з тим, скільки разів і скільки хвилин кожен вид '
            'використовується в технологічних картах.'
        ),
    )
    async def list_operation_types(
        sort_by: Annotated[
            OperationTypeSortField,
            Field(
                description='Поле сортування: name — назва, operations — кількість операцій '
                'у картах, total_duration — сумарна тривалість цих операцій'
            ),
        ] = 'name',
        order: Order = 'asc',
    ) -> OperationTypeList:
        with _tool_errors():
            return await catalog.list_operation_types(OperationTypeQuery(sort_by, order))

    @server.tool(
        title='Технологічні карти',
        annotations=READ_ONLY,
        description=(
            'Технологічні карти з маршрутом обробки й сумарною тривалістю. Підтримує '
            'сортування та фільтри за видом обробки, матеріалом і межами сумарної тривалості '
            'у хвилинах.'
        ),
    )
    async def list_process_cards(
        *,
        sort_by: Annotated[
            ProcessCardSortField,
            Field(
                description='Поле сортування: designation — позначення деталі, name — '
                'найменування, operations — кількість операцій, total_duration — сумарна '
                'тривалість, updated_at — дата зміни'
            ),
        ] = 'designation',
        order: Order = 'asc',
        limit: Limit = 50,
        operation_type: Annotated[
            str | None,
            Field(
                max_length=60,
                description='Лише карти, що містять цей вид обробки (частина назви, '
                'без урахування регістру), наприклад «термічна»',
            ),
        ] = None,
        material: Annotated[
            str | None,
            Field(max_length=80, description='Лише деталі з цим матеріалом (частина назви)'),
        ] = None,
        min_total_minutes: Minutes = None,
        max_total_minutes: Minutes = None,
    ) -> ProcessCardList:
        query = ProcessCardQuery(
            sort_by=sort_by,
            order=order,
            limit=limit,
            operation_type=operation_type or None,
            material=material or None,
            min_total_minutes=min_total_minutes,
            max_total_minutes=max_total_minutes,
        )
        with _tool_errors():
            return await catalog.list_process_cards(query)

    @server.tool(
        title='Технологічна карта деталі',
        annotations=READ_ONLY,
        description=(
            'Повна технологічна карта однієї деталі: операції 005, 010… з видом обробки, '
            'обладнанням, тривалістю та часткою від загального часу.'
        ),
    )
    async def get_process_card(
        designation: Annotated[
            str,
            Field(
                min_length=3,
                max_length=64,
                description='Позначення деталі, наприклад КПІ.301.011 (регістр не важливий)',
            ),
        ],
    ) -> ProcessCardDetail:
        with _tool_errors():
            return await catalog.get_process_card(designation)

    @server.tool(
        title='Пошук',
        annotations=READ_ONLY,
        description=(
            'Пошук без урахування регістру в позначеннях, найменуваннях і матеріалах деталей, '
            'у назвах та описах видів обробки й в обладнанні операцій технологічних карт.'
        ),
    )
    async def search(
        query: Annotated[
            str,
            Field(
                min_length=2,
                max_length=100,
                description='Слово або фрагмент, наприклад «16К20», «сталь», «шліф»',
            ),
        ],
        limit: Annotated[
            int, Field(ge=1, le=50, description='Максимум збігів у кожній групі')
        ] = 20,
    ) -> SearchResult:
        with _tool_errors():
            return await catalog.search(query, limit)

    return server
