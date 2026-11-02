from fastapi import APIRouter, Request, Response

from api.domain.part import PartId
from api.infrastructure.http.dependencies import PartsDep, ResourceId
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_part_dto
from api.infrastructure.http.schemas import PartRequest, PartResponse, PartsResponse

router = APIRouter(prefix='/parts', tags=['Деталі'])


@router.get('', summary='Усі деталі', responses=error_responses())
async def list_parts(service: PartsDep) -> PartsResponse:
    return PartsResponse(parts=[to_part_dto(part) for part in await service.list_all()])


@router.get('/{part_id}', summary='Одна деталь', responses=error_responses(400, 404))
async def get_part(part_id: ResourceId, service: PartsDep) -> PartResponse:
    return PartResponse(part=to_part_dto(await service.get(PartId(part_id))))


@router.post(
    '',
    status_code=201,
    summary='Додати деталь',
    description='Позначення переводиться у верхній регістр і має бути унікальним. '
    'У заголовку Location повертається адреса створеного запису.',
    responses=error_responses(400, 409),
)
async def create_part(
    body: PartRequest, service: PartsDep, request: Request, response: Response
) -> PartResponse:
    part = await service.create(body.to_input())
    response.headers['Location'] = request.app.url_path_for('get_part', part_id=part.id)
    return PartResponse(part=to_part_dto(part))


@router.put(
    '/{part_id}',
    summary='Редагувати деталь',
    description='Повністю замінює дані деталі.',
    responses=error_responses(400, 404, 409),
)
async def update_part(part_id: ResourceId, body: PartRequest, service: PartsDep) -> PartResponse:
    return PartResponse(part=to_part_dto(await service.update(PartId(part_id), body.to_input())))


@router.delete(
    '/{part_id}',
    status_code=204,
    summary='Видалити деталь',
    description='Деталь, для якої існує технологічна карта, видалити не можна (код 409).',
    responses=error_responses(400, 404, 409),
)
async def delete_part(part_id: ResourceId, service: PartsDep) -> None:
    await service.delete(PartId(part_id))
