from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId

from api.domain.operation_type import OperationType, OperationTypeDetails, OperationTypeId
from api.domain.part import Part, PartDetails, PartId
from api.domain.process_card import Operation, ProcessCard, ProcessCardDetails, ProcessCardId

type Document = dict[str, Any]


def object_id(value: str) -> ObjectId | None:
    return ObjectId(value) if ObjectId.is_valid(value) else None


def utc_now() -> datetime:
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def to_part(document: Mapping[str, Any]) -> Part:
    return Part(
        id=PartId(str(document['_id'])),
        designation=document['designation'],
        name=document['name'],
        material=document.get('material'),
        created_at=document['createdAt'],
        updated_at=document['updatedAt'],
    )


def part_document(details: PartDetails) -> Document:
    return {
        'designation': details.designation,
        'name': details.name,
        'material': details.material,
    }


def to_operation_type(document: Mapping[str, Any]) -> OperationType:
    return OperationType(
        id=OperationTypeId(str(document['_id'])),
        name=document['name'],
        description=document.get('description'),
        created_at=document['createdAt'],
        updated_at=document['updatedAt'],
    )


def operation_type_document(details: OperationTypeDetails) -> Document:
    return {'name': details.name, 'description': details.description}


def to_process_card(document: Mapping[str, Any]) -> ProcessCard:
    return ProcessCard(
        id=ProcessCardId(str(document['_id'])),
        part_id=PartId(str(document['part'])),
        operations=tuple(
            Operation(
                operation_type_id=OperationTypeId(str(operation['operationType'])),
                equipment=operation.get('equipment'),
                duration_minutes=float(operation['durationMinutes']),
            )
            for operation in document['operations']
        ),
        created_at=document['createdAt'],
        updated_at=document['updatedAt'],
    )


def process_card_document(details: ProcessCardDetails) -> Document:
    return {
        'part': ObjectId(details.part_id),
        'operations': [
            {
                'operationType': ObjectId(operation.operation_type_id),
                'equipment': operation.equipment,
                'durationMinutes': operation.duration_minutes,
            }
            for operation in details.operations
        ],
    }
