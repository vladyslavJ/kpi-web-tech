from typing import Any

from pymongo import ASCENDING, IndexModel
from pymongo.collation import Collation

from api.domain.operation_type import OPERATION_TYPE_DESCRIPTION_LENGTH, OPERATION_TYPE_NAME_LENGTH
from api.domain.part import PART_DESIGNATION_LENGTH, PART_MATERIAL_LENGTH, PART_NAME_LENGTH
from api.domain.process_card import (
    DURATION_MAX_MINUTES,
    DURATION_MIN_MINUTES,
    EQUIPMENT_LENGTH,
    OPERATIONS_COUNT,
)
from api.domain.text import Limits

PARTS = 'parts'
OPERATION_TYPES = 'operation_types'
PROCESS_CARDS = 'process_cards'

UKRAINIAN_CASE_INSENSITIVE = Collation(locale='uk', strength=2)


def _text(limits: Limits) -> dict[str, Any]:
    return {'bsonType': 'string', 'minLength': limits.min, 'maxLength': limits.max}


def _optional_text(limits: Limits) -> dict[str, Any]:
    return {'bsonType': ['string', 'null'], 'maxLength': limits.max}


_TIMESTAMP = {'bsonType': 'date'}


def _record(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        '$jsonSchema': {
            'bsonType': 'object',
            'required': [*properties, 'createdAt', 'updatedAt'],
            'additionalProperties': False,
            'properties': {
                '_id': {'bsonType': 'objectId'},
                **properties,
                'createdAt': _TIMESTAMP,
                'updatedAt': _TIMESTAMP,
            },
        }
    }


VALIDATORS: dict[str, dict[str, Any]] = {
    PARTS: _record(
        {
            'designation': _text(PART_DESIGNATION_LENGTH),
            'name': _text(PART_NAME_LENGTH),
            'material': _optional_text(PART_MATERIAL_LENGTH),
        }
    ),
    OPERATION_TYPES: _record(
        {
            'name': _text(OPERATION_TYPE_NAME_LENGTH),
            'description': _optional_text(OPERATION_TYPE_DESCRIPTION_LENGTH),
        }
    ),
    PROCESS_CARDS: _record(
        {
            'part': {'bsonType': 'objectId'},
            'operations': {
                'bsonType': 'array',
                'minItems': OPERATIONS_COUNT.min,
                'maxItems': OPERATIONS_COUNT.max,
                'items': {
                    'bsonType': 'object',
                    'required': ['operationType', 'equipment', 'durationMinutes'],
                    'additionalProperties': False,
                    'properties': {
                        'operationType': {'bsonType': 'objectId'},
                        'equipment': _optional_text(EQUIPMENT_LENGTH),
                        'durationMinutes': {
                            'bsonType': ['double', 'int'],
                            'minimum': DURATION_MIN_MINUTES,
                            'maximum': DURATION_MAX_MINUTES,
                        },
                    },
                },
            },
        }
    ),
}

INDEXES: dict[str, list[IndexModel]] = {
    PARTS: [IndexModel([('designation', ASCENDING)], name='designation_1', unique=True)],
    OPERATION_TYPES: [
        IndexModel(
            [('name', ASCENDING)],
            name='name_1',
            unique=True,
            collation=UKRAINIAN_CASE_INSENSITIVE,
        )
    ],
    PROCESS_CARDS: [
        IndexModel([('part', ASCENDING)], name='part_1', unique=True),
        IndexModel([('operations.operationType', ASCENDING)], name='operations.operationType_1'),
    ],
}
