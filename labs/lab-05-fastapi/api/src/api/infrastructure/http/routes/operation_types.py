from fastapi import APIRouter, Request, Response

from api.domain.operation_type import OperationTypeId
from api.infrastructure.http.dependencies import OperationTypesDep, ResourceId
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_operation_type_dto
from api.infrastructure.http.schemas import (
    OperationTypeRequest,
    OperationTypeResponse,
    OperationTypesResponse,
)

router = APIRouter(prefix='/operation-types', tags=['Види обробки'])


@router.get('', summary='Усі види обробки', responses=error_responses())
async def list_operation_types(service: OperationTypesDep) -> OperationTypesResponse:
    return OperationTypesResponse(
        operation_types=[to_operation_type_dto(item) for item in await service.list_all()]
    )


@router.get('/{operation_type_id}', summary='Один вид обробки', responses=error_responses(400, 404))
async def get_operation_type(
    operation_type_id: ResourceId, service: OperationTypesDep
) -> OperationTypeResponse:
    operation_type = await service.get(OperationTypeId(operation_type_id))
    return OperationTypeResponse(operation_type=to_operation_type_dto(operation_type))


@router.post(
    '',
    status_code=201,
    summary='Додати вид обробки',
    description='Перша літера назви стає великою, назва унікальна без урахування регістру.',
    responses=error_responses(400, 409),
)
async def create_operation_type(
    body: OperationTypeRequest, service: OperationTypesDep, request: Request, response: Response
) -> OperationTypeResponse:
    operation_type = await service.create(body.to_input())
    response.headers['Location'] = request.app.url_path_for(
        'get_operation_type', operation_type_id=operation_type.id
    )
    return OperationTypeResponse(operation_type=to_operation_type_dto(operation_type))


@router.put(
    '/{operation_type_id}',
    summary='Редагувати вид обробки',
    responses=error_responses(400, 404, 409),
)
async def update_operation_type(
    operation_type_id: ResourceId, body: OperationTypeRequest, service: OperationTypesDep
) -> OperationTypeResponse:
    operation_type = await service.update(OperationTypeId(operation_type_id), body.to_input())
    return OperationTypeResponse(operation_type=to_operation_type_dto(operation_type))


@router.delete(
    '/{operation_type_id}',
    status_code=204,
    summary='Видалити вид обробки',
    description='Вид обробки, що використовується в операціях карт, видалити не можна (код 409).',
    responses=error_responses(400, 404, 409),
)
async def delete_operation_type(operation_type_id: ResourceId, service: OperationTypesDep) -> None:
    await service.delete(OperationTypeId(operation_type_id))
