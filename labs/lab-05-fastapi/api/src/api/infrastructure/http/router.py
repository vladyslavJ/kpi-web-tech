from fastapi import APIRouter

from api.infrastructure.http.routes import operation_types, parts, process_cards, system


def api_router() -> APIRouter:
    router = APIRouter(prefix='/api')
    for child in (parts.router, operation_types.router, process_cards.router, system.router):
        router.include_router(child)
    return router
