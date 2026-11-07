from typing import Literal

from pydantic import BaseModel, Field

SortOrder = Literal['asc', 'desc']
PartSortField = Literal['designation', 'name', 'material', 'created_at']
OperationTypeSortField = Literal['name', 'operations', 'total_duration']
ProcessCardSortField = Literal['designation', 'name', 'operations', 'total_duration', 'updated_at']


class PartRow(BaseModel):
    designation: str = Field(description='Позначення (креслярський номер) деталі')
    name: str = Field(description='Найменування деталі')
    material: str | None = Field(description='Матеріал деталі')
    has_process_card: bool = Field(description='Чи є для деталі технологічна карта')


class PartList(BaseModel):
    total: int = Field(description='Кількість деталей у базі')
    sorted_by: PartSortField
    order: SortOrder
    items: list[PartRow]


class OperationTypeRow(BaseModel):
    name: str = Field(description='Назва виду обробки')
    description: str | None
    operations: int = Field(description='Скільки операцій цього виду є в усіх картах')
    total_duration_minutes: float = Field(description='Сумарна тривалість цих операцій, хв')
    total_duration: str = Field(description='Сумарна тривалість у годинах і хвилинах')


class OperationTypeList(BaseModel):
    sorted_by: OperationTypeSortField
    order: SortOrder
    items: list[OperationTypeRow]


class ProcessCardRow(BaseModel):
    designation: str = Field(description='Позначення деталі')
    part_name: str
    material: str | None
    operations: int = Field(description='Кількість операцій у маршруті')
    route: list[str] = Field(description='Види обробки в порядку виконання')
    total_duration_minutes: float
    total_duration: str
    updated_at: str = Field(description='Дата й час останньої зміни (Київ)')


class ProcessCardFilters(BaseModel):
    operation_type: str | None
    material: str | None
    min_total_minutes: float | None
    max_total_minutes: float | None


class ProcessCardList(BaseModel):
    total: int = Field(description='Кількість карт, що відповідають фільтрам')
    sorted_by: ProcessCardSortField
    order: SortOrder
    filters: ProcessCardFilters | None = Field(description='Застосовані фільтри')
    items: list[ProcessCardRow]


class OperationRow(BaseModel):
    number: str = Field(description='Номер операції: 005, 010, 015…')
    operation_type: str
    equipment: str | None
    duration_minutes: float
    share_percent: float = Field(description='Частка від сумарної тривалості карти, %')


class ProcessCardDetail(BaseModel):
    designation: str
    part_name: str
    material: str | None
    operations: list[OperationRow]
    total_duration_minutes: float
    total_duration: str
    created_at: str
    updated_at: str


class WorkloadRow(BaseModel):
    operation_type: str
    operations: int
    total_duration_minutes: float
    share_percent: float


class Overview(BaseModel):
    parts: int
    operation_types: int
    process_cards: int
    operations: int
    total_duration_minutes: float
    total_duration: str
    parts_without_card: list[str] = Field(description='Позначення деталей без технологічної карти')
    workload: list[WorkloadRow] = Field(
        description='Трудомісткість за видами обробки, від найбільшої'
    )


class OperationTypeMatch(BaseModel):
    name: str
    description: str | None


class OperationMatch(BaseModel):
    designation: str
    part_name: str
    number: str
    operation_type: str
    equipment: str | None
    duration_minutes: float


class SearchResult(BaseModel):
    query: str
    parts: list[PartRow]
    operation_types: list[OperationTypeMatch]
    operations: list[OperationMatch] = Field(
        description='Операції, у яких запит знайдено в обладнанні або назві виду обробки'
    )
