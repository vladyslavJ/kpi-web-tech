import logging
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from api.application.errors import AppError, AppErrorCode, StorageUnavailableError
from api.domain.errors import DomainError
from api.infrastructure.http.schemas import (
    ErrorBody,
    ErrorCode,
    ErrorResponse,
    ValidationIssueDto,
)

logger = logging.getLogger('api.http')

STATUS_BY_APP_ERROR: Mapping[AppErrorCode, int] = {
    'NOT_FOUND': 404,
    'PART_DESIGNATION_TAKEN': 409,
    'OPERATION_TYPE_NAME_TAKEN': 409,
    'PART_ALREADY_HAS_CARD': 409,
    'PART_IN_USE': 409,
    'OPERATION_TYPE_IN_USE': 409,
    'UNKNOWN_PART': 422,
    'UNKNOWN_OPERATION_TYPE': 422,
}

ERROR_DESCRIPTIONS: Mapping[int, str] = {
    400: 'Некоректні дані запиту',
    404: 'Запис не знайдено',
    409: 'Конфлікт з наявними даними',
    422: 'Посилання на неіснуючу деталь чи вид обробки',
    503: 'База даних тимчасово недоступна',
}


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    return {
        status: {'model': ErrorResponse, 'description': ERROR_DESCRIPTIONS[status]}
        for status in (*statuses, 503)
    }


def error_response(
    status_code: int,
    code: ErrorCode,
    message: str,
    *,
    issues: Sequence[ValidationIssueDto] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, issues=issues))
    return JSONResponse(
        body.model_dump(mode='json', by_alias=True, exclude_none=True),
        status_code=status_code,
        headers=headers,
    )


def _issue_path(location: Sequence[int | str]) -> str:
    parts = [str(part) for part in location[1:]] if location[:1] in (('body',), ('path',)) else []
    return '.'.join(parts) or 'body'


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, error: AppError) -> JSONResponse:
        return error_response(STATUS_BY_APP_ERROR[error.code], error.code, error.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, error: RequestValidationError
    ) -> JSONResponse:
        details = error.errors()
        if any(detail['type'] == 'json_invalid' for detail in details):
            return error_response(400, 'VALIDATION_ERROR', 'The request body is not valid JSON')
        issues = [
            ValidationIssueDto(path=_issue_path(detail['loc']), message=detail['msg'])
            for detail in details
        ]
        message = '; '.join(f'{issue.path}: {issue.message}' for issue in issues)
        return error_response(400, 'VALIDATION_ERROR', message, issues=issues)

    @app.exception_handler(DomainError)
    async def handle_domain_error(_request: Request, error: DomainError) -> JSONResponse:
        return error_response(400, 'VALIDATION_ERROR', str(error))

    @app.exception_handler(StorageUnavailableError)
    async def handle_storage_unavailable(
        request: Request, _error: StorageUnavailableError
    ) -> JSONResponse:
        logger.warning(
            'Database is unavailable', extra={'method': request.method, 'url': request.url.path}
        )
        return error_response(
            503,
            'DATABASE_UNAVAILABLE',
            'The database is temporarily unavailable',
            headers={'Retry-After': '5'},
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, error: HTTPException) -> JSONResponse:
        route = f'{request.method} {request.url.path}'
        if error.status_code == 404:
            return error_response(404, 'NOT_FOUND', f'Route {route} not found')
        if error.status_code == 405:
            return error_response(
                405, 'METHOD_NOT_ALLOWED', f'Route {route} is not allowed', headers=error.headers
            )
        if error.status_code < 500:
            return error_response(error.status_code, 'VALIDATION_ERROR', str(error.detail))
        return error_response(error.status_code, 'INTERNAL_ERROR', 'Internal server error')
