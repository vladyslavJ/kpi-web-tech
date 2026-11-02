from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.infrastructure.http.dependencies import StatisticsDep, StorageDep
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_statistics_response
from api.infrastructure.http.schemas import HealthResponse, StatisticsResponse

router = APIRouter()


@router.get(
    '/statistics',
    tags=['Статистика'],
    summary='Статистика й трудомісткість',
    description='Кількість записів і сумарна тривалість операцій за кожним видом обробки, '
    'яку рахує конвеєр агрегації MongoDB.',
    responses=error_responses(),
)
async def get_statistics(service: StatisticsDep) -> StatisticsResponse:
    return to_statistics_response(await service.collect())


@router.get(
    '/health',
    tags=['Стан'],
    summary='Стан сервера й бази даних',
    response_model=HealthResponse,
    responses={503: {'model': HealthResponse, 'description': 'База даних недоступна'}},
)
async def get_health(storage: StorageDep) -> HealthResponse | JSONResponse:
    if await storage.is_available():
        return HealthResponse(status='ok', database='up')
    body = HealthResponse(status='degraded', database='down')
    return JSONResponse(body.model_dump(mode='json'), status_code=503)
