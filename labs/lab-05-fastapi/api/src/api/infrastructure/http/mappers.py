from api.application.process_cards_service import ProcessCardView
from api.application.statistics_service import Statistics
from api.domain.operation_type import OperationType
from api.domain.part import Part
from api.domain.process_card import operation_number, total_duration
from api.infrastructure.http.schemas import (
    OperationDto,
    OperationTypeDto,
    OperationTypeRefDto,
    PartDto,
    PartRefDto,
    ProcessCardDto,
    StatisticsResponse,
    WorkloadDto,
)


def to_part_dto(part: Part) -> PartDto:
    return PartDto(
        id=part.id,
        designation=part.designation,
        name=part.name,
        material=part.material,
        created_at=part.created_at,
        updated_at=part.updated_at,
    )


def to_operation_type_dto(operation_type: OperationType) -> OperationTypeDto:
    return OperationTypeDto(
        id=operation_type.id,
        name=operation_type.name,
        description=operation_type.description,
        created_at=operation_type.created_at,
        updated_at=operation_type.updated_at,
    )


def to_operation_type_ref(operation_type: OperationType) -> OperationTypeRefDto:
    return OperationTypeRefDto(id=operation_type.id, name=operation_type.name)


def to_process_card_dto(view: ProcessCardView) -> ProcessCardDto:
    card = view.card
    return ProcessCardDto(
        id=card.id,
        part=PartRefDto(
            id=view.part.id,
            designation=view.part.designation,
            name=view.part.name,
            material=view.part.material,
        ),
        operations=[
            OperationDto(
                number=operation_number(index),
                operation_type=to_operation_type_ref(
                    view.operation_types[operation.operation_type_id]
                ),
                equipment=operation.equipment,
                duration_minutes=operation.duration_minutes,
            )
            for index, operation in enumerate(card.operations)
        ],
        total_duration_minutes=total_duration(card),
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def to_statistics_response(statistics: Statistics) -> StatisticsResponse:
    return StatisticsResponse(
        parts=statistics.parts,
        operation_types=statistics.operation_types,
        process_cards=statistics.process_cards,
        operations=statistics.operations,
        total_duration_minutes=statistics.total_duration_minutes,
        workload=[
            WorkloadDto(
                operation_type=to_operation_type_ref(entry.operation_type),
                operations=entry.operations,
                total_duration_minutes=entry.total_duration_minutes,
            )
            for entry in statistics.workload
        ],
    )
