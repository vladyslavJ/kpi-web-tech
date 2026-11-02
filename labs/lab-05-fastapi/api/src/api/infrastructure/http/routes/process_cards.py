from fastapi import APIRouter, Request, Response

from api.domain.process_card import ProcessCardId
from api.infrastructure.http.dependencies import ProcessCardsDep, ResourceId
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_process_card_dto
from api.infrastructure.http.schemas import (
    ProcessCardRequest,
    ProcessCardResponse,
    ProcessCardsResponse,
)

router = APIRouter(prefix='/process-cards', tags=['Технологічні карти'])


@router.get(
    '',
    summary='Усі технологічні карти',
    description='Карти з деталлю, операціями й сумарною тривалістю, відсортовані за позначенням.',
    responses=error_responses(),
)
async def list_process_cards(service: ProcessCardsDep) -> ProcessCardsResponse:
    return ProcessCardsResponse(
        process_cards=[to_process_card_dto(view) for view in await service.list_all()]
    )


@router.get(
    '/{process_card_id}', summary='Одна технологічна карта', responses=error_responses(400, 404)
)
async def get_process_card(
    process_card_id: ResourceId, service: ProcessCardsDep
) -> ProcessCardResponse:
    view = await service.get(ProcessCardId(process_card_id))
    return ProcessCardResponse(process_card=to_process_card_dto(view))


@router.post(
    '',
    status_code=201,
    summary='Додати технологічну карту',
    description='Для кожної деталі може існувати лише одна карта. Деталь і види обробки '
    'мають існувати, інакше повертається код 422.',
    responses=error_responses(400, 409, 422),
)
async def create_process_card(
    body: ProcessCardRequest, service: ProcessCardsDep, request: Request, response: Response
) -> ProcessCardResponse:
    view = await service.create(body.to_input())
    response.headers['Location'] = request.app.url_path_for(
        'get_process_card', process_card_id=view.card.id
    )
    return ProcessCardResponse(process_card=to_process_card_dto(view))


@router.put(
    '/{process_card_id}',
    summary='Редагувати технологічну карту',
    description='Повністю замінює деталь і список операцій карти.',
    responses=error_responses(400, 404, 409, 422),
)
async def update_process_card(
    process_card_id: ResourceId, body: ProcessCardRequest, service: ProcessCardsDep
) -> ProcessCardResponse:
    view = await service.update(ProcessCardId(process_card_id), body.to_input())
    return ProcessCardResponse(process_card=to_process_card_dto(view))


@router.delete(
    '/{process_card_id}',
    status_code=204,
    summary='Видалити технологічну карту',
    responses=error_responses(400, 404),
)
async def delete_process_card(process_card_id: ResourceId, service: ProcessCardsDep) -> None:
    await service.delete(ProcessCardId(process_card_id))
