import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from api.infrastructure.http.errors import error_response

API_PREFIX = '/api'

logger = logging.getLogger('api.http')


def _too_large(request: Request, limit: int) -> bool:
    length = request.headers.get('content-length', '')
    return length.isdigit() and int(length) > limit


def install_middleware(app: FastAPI, *, body_limit_bytes: int) -> None:
    @app.middleware('http')
    async def handle_request(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        path = request.url.path
        try:
            if _too_large(request, body_limit_bytes):
                response: Response = error_response(
                    413, 'VALIDATION_ERROR', 'The request body is too large'
                )
            else:
                response = await call_next(request)
        except Exception:
            logger.exception('Request failed', extra={'method': request.method, 'url': path})
            response = error_response(500, 'INTERNAL_ERROR', 'Internal server error')

        response.headers['X-Content-Type-Options'] = 'nosniff'
        is_api = path == API_PREFIX or path.startswith(f'{API_PREFIX}/')
        if is_api:
            response.headers['Cache-Control'] = 'no-store'
        logger.log(
            logging.INFO if is_api else logging.DEBUG,
            'Request completed',
            extra={
                'method': request.method,
                'url': path,
                'statusCode': response.status_code,
                'durationMs': round((time.perf_counter() - started) * 1000),
            },
        )
        return response
