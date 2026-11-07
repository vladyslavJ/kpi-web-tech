import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.collation import Collation
from pymongo.errors import ConnectionFailure, PyMongoError

from process_cards_mcp.catalog.formatting import (
    format_duration,
    local_time,
    operation_number,
    round_minutes,
    share_percent,
)
from process_cards_mcp.catalog.models import (
    OperationMatch,
    OperationRow,
    OperationTypeList,
    OperationTypeMatch,
    OperationTypeRow,
    Overview,
    PartList,
    PartRow,
    ProcessCardDetail,
    ProcessCardFilters,
    ProcessCardList,
    ProcessCardRow,
    SearchResult,
    WorkloadRow,
)
from process_cards_mcp.catalog.ports import (
    CatalogUnavailableError,
    OperationTypeQuery,
    PartQuery,
    ProcessCardNotFoundError,
    ProcessCardQuery,
)

type Document = dict[str, Any]
type Pipeline = list[Document]

DEFAULT_DATABASE = 'lab05'
UKRAINIAN = Collation(locale='uk', numericOrdering=True)

PART_SORT = {
    'designation': 'designation',
    'name': 'name',
    'material': 'material',
    'created_at': 'createdAt',
}
OPERATION_TYPE_SORT = {
    'name': 'name',
    'operations': 'operations',
    'total_duration': 'total_duration_minutes',
}
PROCESS_CARD_SORT = {
    'designation': 'part.designation',
    'name': 'part.name',
    'operations': 'operations_count',
    'total_duration': 'total_duration_minutes',
    'updated_at': 'updatedAt',
}


def contains(text: str) -> Document:
    return {'$regex': re.escape(text.strip()), '$options': 'i'}


def _direction(order: str) -> int:
    return -1 if order == 'desc' else 1


def _type_name(operation: str) -> Document:
    return {
        '$getField': {
            'field': 'name',
            'input': {
                '$first': {
                    '$filter': {
                        'input': '$types',
                        'as': 'type',
                        'cond': {'$eq': ['$$type._id', f'{operation}.operationType']},
                    }
                }
            },
        }
    }


_WITH_PART_AND_TYPES: Pipeline = [
    {'$lookup': {'from': 'parts', 'localField': 'part', 'foreignField': '_id', 'as': 'part'}},
    {'$unwind': '$part'},
    {
        '$lookup': {
            'from': 'operation_types',
            'localField': 'operations.operationType',
            'foreignField': '_id',
            'as': 'types',
        }
    },
    {
        '$addFields': {
            'total_duration_minutes': {'$sum': '$operations.durationMinutes'},
            'operations_count': {'$size': '$operations'},
            'steps': {
                '$map': {
                    'input': '$operations',
                    'as': 'operation',
                    'in': {
                        'operation_type': _type_name('$$operation'),
                        'equipment': '$$operation.equipment',
                        'duration_minutes': '$$operation.durationMinutes',
                    },
                }
            },
        }
    },
]

_TYPE_USAGE: Pipeline = [
    {'$match': {'$expr': {'$in': ['$$typeId', '$operations.operationType']}}},
    {'$unwind': '$operations'},
    {'$match': {'$expr': {'$eq': ['$operations.operationType', '$$typeId']}}},
    {
        '$group': {
            '_id': None,
            'operations': {'$sum': 1},
            'minutes': {'$sum': '$operations.durationMinutes'},
        }
    },
]

_PARTS_WITH_CARD_FLAG: Pipeline = [
    {
        '$lookup': {
            'from': 'process_cards',
            'localField': '_id',
            'foreignField': 'part',
            'pipeline': [{'$project': {'_id': 1}}],
            'as': 'cards',
        }
    },
    {'$addFields': {'has_process_card': {'$gt': [{'$size': '$cards'}, 0]}}},
]


def _part_row(document: Mapping[str, Any]) -> PartRow:
    return PartRow(
        designation=document['designation'],
        name=document['name'],
        material=document.get('material'),
        has_process_card=document['has_process_card'],
    )


def _card_row(document: Mapping[str, Any]) -> ProcessCardRow:
    minutes = round_minutes(document['total_duration_minutes'])
    return ProcessCardRow(
        designation=document['part']['designation'],
        part_name=document['part']['name'],
        material=document['part'].get('material'),
        operations=document['operations_count'],
        route=[step['operation_type'] for step in document['steps']],
        total_duration_minutes=minutes,
        total_duration=format_duration(minutes),
        updated_at=local_time(document['updatedAt']),
    )


def _filters(query: ProcessCardQuery) -> ProcessCardFilters | None:
    filters = ProcessCardFilters(
        operation_type=query.operation_type,
        material=query.material,
        min_total_minutes=query.min_total_minutes,
        max_total_minutes=query.max_total_minutes,
    )
    return filters if filters.model_dump(exclude_none=True) else None


@contextmanager
def _available() -> Iterator[None]:
    try:
        yield
    except ConnectionFailure as error:
        raise CatalogUnavailableError('MongoDB is unavailable') from error


class MongoCatalog:
    def __init__(self, uri: str, *, timeout_ms: int) -> None:
        self._client: AsyncMongoClient[Document] = AsyncMongoClient(
            uri, serverSelectionTimeoutMS=timeout_ms, tz_aware=True, appname='lab-06-mcp'
        )
        self._database: AsyncDatabase[Document] = self._client.get_default_database(
            default=DEFAULT_DATABASE
        )

    @property
    def database_name(self) -> str:
        return self._database.name

    async def is_available(self) -> bool:
        try:
            await self._client.admin.command('ping')
        except PyMongoError:
            return False
        return True

    async def close(self) -> None:
        await self._client.close()

    async def overview(self) -> Overview:
        with _available():
            parts = await self._database['parts'].count_documents({})
            types = await self._database['operation_types'].count_documents({})
            cards = await self._database['process_cards'].count_documents({})
            workload = await self._aggregate(
                'process_cards',
                [
                    {'$unwind': '$operations'},
                    {
                        '$group': {
                            '_id': '$operations.operationType',
                            'operations': {'$sum': 1},
                            'minutes': {'$sum': '$operations.durationMinutes'},
                        }
                    },
                    {
                        '$lookup': {
                            'from': 'operation_types',
                            'localField': '_id',
                            'foreignField': '_id',
                            'as': 'type',
                        }
                    },
                    {'$unwind': '$type'},
                    {'$sort': {'minutes': -1, 'type.name': 1}},
                ],
            )
            without_card = await self._aggregate(
                'parts',
                [
                    *_PARTS_WITH_CARD_FLAG,
                    {'$match': {'has_process_card': False}},
                    {'$sort': {'designation': 1}},
                ],
            )

        total = round_minutes(sum(row['minutes'] for row in workload))
        return Overview(
            parts=parts,
            operation_types=types,
            process_cards=cards,
            operations=sum(row['operations'] for row in workload),
            total_duration_minutes=total,
            total_duration=format_duration(total),
            parts_without_card=[row['designation'] for row in without_card],
            workload=[
                WorkloadRow(
                    operation_type=row['type']['name'],
                    operations=row['operations'],
                    total_duration_minutes=round_minutes(row['minutes']),
                    share_percent=share_percent(row['minutes'], total),
                )
                for row in workload
            ],
        )

    async def list_parts(self, query: PartQuery) -> PartList:
        with _available():
            total = await self._database['parts'].count_documents({})
            rows = await self._aggregate(
                'parts',
                [
                    *_PARTS_WITH_CARD_FLAG,
                    {
                        '$sort': {
                            PART_SORT[query.sort_by]: _direction(query.order),
                            'designation': 1,
                        }
                    },
                    {'$limit': query.limit},
                ],
            )
        return PartList(
            total=total,
            sorted_by=query.sort_by,
            order=query.order,
            items=[_part_row(row) for row in rows],
        )

    async def list_operation_types(self, query: OperationTypeQuery) -> OperationTypeList:
        with _available():
            rows = await self._aggregate(
                'operation_types',
                [
                    {
                        '$lookup': {
                            'from': 'process_cards',
                            'let': {'typeId': '$_id'},
                            'pipeline': _TYPE_USAGE,
                            'as': 'usage',
                        }
                    },
                    {
                        '$addFields': {
                            'operations': {'$ifNull': [{'$first': '$usage.operations'}, 0]},
                            'total_duration_minutes': {
                                '$ifNull': [{'$first': '$usage.minutes'}, 0]
                            },
                        }
                    },
                    {
                        '$sort': {
                            OPERATION_TYPE_SORT[query.sort_by]: _direction(query.order),
                            'name': 1,
                        }
                    },
                ],
            )
        return OperationTypeList(
            sorted_by=query.sort_by,
            order=query.order,
            items=[
                OperationTypeRow(
                    name=row['name'],
                    description=row.get('description'),
                    operations=row['operations'],
                    total_duration_minutes=round_minutes(row['total_duration_minutes']),
                    total_duration=format_duration(row['total_duration_minutes']),
                )
                for row in rows
            ],
        )

    async def list_process_cards(self, query: ProcessCardQuery) -> ProcessCardList:
        match: Document = {}
        if query.operation_type:
            match['steps.operation_type'] = contains(query.operation_type)
        if query.material:
            match['part.material'] = contains(query.material)
        duration: Document = {}
        if query.min_total_minutes is not None:
            duration['$gte'] = query.min_total_minutes
        if query.max_total_minutes is not None:
            duration['$lte'] = query.max_total_minutes
        if duration:
            match['total_duration_minutes'] = duration

        with _available():
            [result] = await self._aggregate(
                'process_cards',
                [
                    *_WITH_PART_AND_TYPES,
                    {'$match': match},
                    {
                        '$facet': {
                            'total': [{'$count': 'value'}],
                            'items': [
                                {
                                    '$sort': {
                                        PROCESS_CARD_SORT[query.sort_by]: _direction(query.order),
                                        'part.designation': 1,
                                    }
                                },
                                {'$limit': query.limit},
                            ],
                        }
                    },
                ],
            )
        return ProcessCardList(
            total=result['total'][0]['value'] if result['total'] else 0,
            sorted_by=query.sort_by,
            order=query.order,
            filters=_filters(query),
            items=[_card_row(row) for row in result['items']],
        )

    async def get_process_card(self, designation: str) -> ProcessCardDetail:
        normalized = designation.strip().upper()
        with _available():
            rows = await self._aggregate(
                'process_cards',
                [*_WITH_PART_AND_TYPES, {'$match': {'part.designation': normalized}}],
            )
            if not rows:
                part = await self._database['parts'].find_one({'designation': normalized})
                known = await self._aggregate(
                    'process_cards',
                    [*_WITH_PART_AND_TYPES[:2], {'$sort': {'part.designation': 1}}],
                )
                raise ProcessCardNotFoundError(
                    normalized,
                    part_exists=part is not None,
                    known=[row['part']['designation'] for row in known],
                )

        [card] = rows
        total = round_minutes(card['total_duration_minutes'])
        return ProcessCardDetail(
            designation=card['part']['designation'],
            part_name=card['part']['name'],
            material=card['part'].get('material'),
            operations=[
                OperationRow(
                    number=operation_number(index),
                    operation_type=step['operation_type'],
                    equipment=step.get('equipment'),
                    duration_minutes=round_minutes(step['duration_minutes']),
                    share_percent=share_percent(step['duration_minutes'], total),
                )
                for index, step in enumerate(card['steps'])
            ],
            total_duration_minutes=total,
            total_duration=format_duration(total),
            created_at=local_time(card['createdAt']),
            updated_at=local_time(card['updatedAt']),
        )

    async def search(self, text: str, limit: int) -> SearchResult:
        pattern = contains(text)
        with _available():
            parts = await self._aggregate(
                'parts',
                [
                    {
                        '$match': {
                            '$or': [
                                {'designation': pattern},
                                {'name': pattern},
                                {'material': pattern},
                            ]
                        }
                    },
                    *_PARTS_WITH_CARD_FLAG,
                    {'$sort': {'designation': 1}},
                    {'$limit': limit},
                ],
            )
            types = await self._aggregate(
                'operation_types',
                [
                    {'$match': {'$or': [{'name': pattern}, {'description': pattern}]}},
                    {'$sort': {'name': 1}},
                    {'$limit': limit},
                ],
            )
            operations = await self._aggregate(
                'process_cards',
                [
                    *_WITH_PART_AND_TYPES,
                    {'$unwind': {'path': '$steps', 'includeArrayIndex': 'index'}},
                    {
                        '$match': {
                            '$or': [
                                {'steps.equipment': pattern},
                                {'steps.operation_type': pattern},
                            ]
                        }
                    },
                    {'$sort': {'part.designation': 1, 'index': 1}},
                    {'$limit': limit},
                ],
            )
        return SearchResult(
            query=text.strip(),
            parts=[_part_row(row) for row in parts],
            operation_types=[
                OperationTypeMatch(name=row['name'], description=row.get('description'))
                for row in types
            ],
            operations=[
                OperationMatch(
                    designation=row['part']['designation'],
                    part_name=row['part']['name'],
                    number=operation_number(row['index']),
                    operation_type=row['steps']['operation_type'],
                    equipment=row['steps'].get('equipment'),
                    duration_minutes=round_minutes(row['steps']['duration_minutes']),
                )
                for row in operations
            ],
        )

    async def _aggregate(self, collection: str, pipeline: Sequence[Document]) -> list[Document]:
        cursor = await self._database[collection].aggregate(list(pipeline), collation=UKRAINIAN)
        return [document async for document in cursor]
