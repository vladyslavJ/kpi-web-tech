from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    WithJsonSchema,
    field_validator,
)
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from api.domain.operation_type import (
    OPERATION_TYPE_DESCRIPTION_LENGTH,
    OPERATION_TYPE_NAME_LENGTH,
    OperationTypeInput,
)
from api.domain.part import (
    PART_MATERIAL_LENGTH,
    PART_NAME_LENGTH,
    PartInput,
    is_valid_designation,
)
from api.domain.process_card import (
    DURATION_MAX_MINUTES,
    DURATION_MIN_MINUTES,
    EQUIPMENT_LENGTH,
    OPERATIONS_COUNT,
    OperationInput,
    ProcessCardInput,
    is_valid_duration,
)
from api.domain.text import Limits, normalize_text

EXAMPLE_ID = '6acbf38bddbf20c6012ff1f0'
EXAMPLE_TIMESTAMP = '2026-11-02T10:00:00.000Z'


def iso_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


Timestamp = Annotated[
    datetime,
    PlainSerializer(iso_timestamp, return_type=str),
    WithJsonSchema({'type': 'string', 'format': 'date-time', 'examples': [EXAMPLE_TIMESTAMP]}),
]


def _check_length(value: str, limits: Limits) -> str:
    if not limits.contains(len(normalize_text(value))):
        raise PydanticCustomError('length', f'Must be {limits.min}-{limits.max} characters long')
    return value


def _check_max_length(value: str | None, limits: Limits) -> str | None:
    if value is not None and len(normalize_text(value)) > limits.max:
        raise PydanticCustomError('length', f'Must be at most {limits.max} characters long')
    return value


class Schema(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class RequestSchema(Schema):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, frozen=True, extra='forbid'
    )


class PartRequest(RequestSchema):
    model_config = ConfigDict(
        json_schema_extra={
            'examples': [{'designation': 'КПІ.320.008', 'name': 'Фланець', 'material': 'Сталь 20'}]
        }
    )

    designation: Annotated[
        str,
        Field(
            max_length=64,
            description='Позначення (креслярський номер): 3–40 літер, цифр, крапок, дефісів або '
            'скісних рисок; починається й закінчується літерою чи цифрою. '
            'Зберігається у верхньому регістрі й унікальне.',
        ),
    ]
    name: Annotated[
        str,
        Field(description=f'Найменування, {PART_NAME_LENGTH.min}–{PART_NAME_LENGTH.max} символів'),
    ]
    material: Annotated[
        str | None,
        Field(description=f'Матеріал, до {PART_MATERIAL_LENGTH.max} символів'),
    ] = None

    @field_validator('designation')
    @classmethod
    def _check_designation(cls, value: str) -> str:
        if not is_valid_designation(value):
            raise PydanticCustomError(
                'designation',
                'Must be 3-40 letters, digits, dots, dashes or slashes, '
                'starting and ending with a letter or digit',
            )
        return value

    @field_validator('name')
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _check_length(value, PART_NAME_LENGTH)

    @field_validator('material')
    @classmethod
    def _check_material(cls, value: str | None) -> str | None:
        return _check_max_length(value, PART_MATERIAL_LENGTH)

    def to_input(self) -> PartInput:
        return PartInput(designation=self.designation, name=self.name, material=self.material)


class OperationTypeRequest(RequestSchema):
    model_config = ConfigDict(
        json_schema_extra={
            'examples': [
                {
                    'name': 'Зубофрезерна',
                    'description': 'Нарізання зубів коліс черв’ячною фрезою',
                }
            ]
        }
    )

    name: Annotated[
        str,
        Field(
            description=f'Назва, {OPERATION_TYPE_NAME_LENGTH.min}–{OPERATION_TYPE_NAME_LENGTH.max} '
            'символів, унікальна без урахування регістру',
        ),
    ]
    description: Annotated[
        str | None,
        Field(description=f'Опис, до {OPERATION_TYPE_DESCRIPTION_LENGTH.max} символів'),
    ] = None

    @field_validator('name')
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _check_length(value, OPERATION_TYPE_NAME_LENGTH)

    @field_validator('description')
    @classmethod
    def _check_description(cls, value: str | None) -> str | None:
        return _check_max_length(value, OPERATION_TYPE_DESCRIPTION_LENGTH)

    def to_input(self) -> OperationTypeInput:
        return OperationTypeInput(name=self.name, description=self.description)


class OperationRequest(RequestSchema):
    operation_type_id: Annotated[
        str, Field(min_length=1, max_length=64, description='Ідентифікатор виду обробки')
    ]
    equipment: Annotated[
        str | None,
        Field(description=f'Обладнання, до {EQUIPMENT_LENGTH.max} символів'),
    ] = None
    duration_minutes: Annotated[
        float,
        Field(
            strict=True,
            description=f'Тривалість у хвилинах: від {DURATION_MIN_MINUTES} до '
            f'{DURATION_MAX_MINUTES:g} з точністю до 0,1',
        ),
    ]

    @field_validator('equipment')
    @classmethod
    def _check_equipment(cls, value: str | None) -> str | None:
        return _check_max_length(value, EQUIPMENT_LENGTH)

    @field_validator('duration_minutes')
    @classmethod
    def _check_duration(cls, value: float) -> float:
        if not is_valid_duration(value):
            raise PydanticCustomError(
                'duration',
                f'Must be {DURATION_MIN_MINUTES}-{DURATION_MAX_MINUTES:g} minutes '
                'with at most one decimal place',
            )
        return value

    def to_input(self) -> OperationInput:
        return OperationInput(
            operation_type_id=self.operation_type_id,
            equipment=self.equipment,
            duration_minutes=self.duration_minutes,
        )


class ProcessCardRequest(RequestSchema):
    model_config = ConfigDict(
        json_schema_extra={
            'examples': [
                {
                    'partId': EXAMPLE_ID,
                    'operations': [
                        {
                            'operationTypeId': '6acbf38bddbf20c6012ff1e9',
                            'equipment': 'Токарно-гвинторізний верстат 16К20',
                            'durationMinutes': 18.5,
                        },
                        {'operationTypeId': '6acbf38bddbf20c6012ff1ef', 'durationMinutes': 4},
                    ],
                }
            ]
        }
    )

    part_id: Annotated[str, Field(min_length=1, max_length=64, description='Ідентифікатор деталі')]
    operations: Annotated[
        list[OperationRequest],
        Field(
            min_length=OPERATIONS_COUNT.min,
            max_length=OPERATIONS_COUNT.max,
            description='Операції в порядку виконання; номери 005, 010… призначаються за порядком',
        ),
    ]

    def to_input(self) -> ProcessCardInput:
        return ProcessCardInput(
            part_id=self.part_id,
            operations=[operation.to_input() for operation in self.operations],
        )


class PartDto(Schema):
    id: str = Field(examples=[EXAMPLE_ID])
    designation: str = Field(examples=['КПІ.301.011'])
    name: str = Field(examples=['Вал ведучий'])
    material: str | None = Field(examples=['Сталь 45'])
    created_at: Timestamp
    updated_at: Timestamp


class PartResponse(Schema):
    part: PartDto


class PartsResponse(Schema):
    parts: list[PartDto]


class OperationTypeDto(Schema):
    id: str = Field(examples=['6acbf38bddbf20c6012ff1e9'])
    name: str = Field(examples=['Токарна'])
    description: str | None = Field(
        examples=['Обробка поверхонь обертання різцями на токарному верстаті']
    )
    created_at: Timestamp
    updated_at: Timestamp


class OperationTypeResponse(Schema):
    operation_type: OperationTypeDto


class OperationTypesResponse(Schema):
    operation_types: list[OperationTypeDto]


class PartRefDto(Schema):
    id: str
    designation: str
    name: str
    material: str | None


class OperationTypeRefDto(Schema):
    id: str
    name: str


class OperationDto(Schema):
    number: int = Field(description='Номер операції з кроком 5', examples=[5])
    operation_type: OperationTypeRefDto
    equipment: str | None
    duration_minutes: float = Field(examples=[18.5])


class ProcessCardDto(Schema):
    id: str
    part: PartRefDto
    operations: list[OperationDto]
    total_duration_minutes: float = Field(description='Сумарна тривалість операцій, хв')
    created_at: Timestamp
    updated_at: Timestamp


class ProcessCardResponse(Schema):
    process_card: ProcessCardDto


class ProcessCardsResponse(Schema):
    process_cards: list[ProcessCardDto]


class WorkloadDto(Schema):
    operation_type: OperationTypeRefDto
    operations: int
    total_duration_minutes: float


class StatisticsResponse(Schema):
    parts: int
    operation_types: int
    process_cards: int
    operations: int
    total_duration_minutes: float
    workload: list[WorkloadDto] = Field(description='Трудомісткість кожного виду обробки')


class HealthResponse(Schema):
    status: Literal['ok', 'degraded']
    database: Literal['up', 'down']


ErrorCode = Literal[
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'PART_DESIGNATION_TAKEN',
    'OPERATION_TYPE_NAME_TAKEN',
    'PART_ALREADY_HAS_CARD',
    'PART_IN_USE',
    'OPERATION_TYPE_IN_USE',
    'UNKNOWN_PART',
    'UNKNOWN_OPERATION_TYPE',
    'DATABASE_UNAVAILABLE',
    'INTERNAL_ERROR',
]


class ValidationIssueDto(Schema):
    path: str = Field(examples=['operations.0.durationMinutes'])
    message: str


class ErrorBody(Schema):
    code: ErrorCode
    message: str
    issues: list[ValidationIssueDto] | None = None


class ErrorResponse(Schema):
    error: ErrorBody
