import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.application.errors import StorageUnavailableError
from api.application.ports import Storage
from api.application.seed_demo_data import SeedDemoData
from api.config import BODY_LIMIT_BYTES, Settings, load_settings_or_exit
from api.infrastructure.http.dependencies import Services
from api.infrastructure.http.errors import register_error_handlers
from api.infrastructure.http.middleware import install_middleware
from api.infrastructure.http.openapi import (
    DESCRIPTION,
    OPENAPI_URL,
    TAGS,
    TITLE,
    VERSION,
    DocumentedApi,
    operation_id,
)
from api.infrastructure.http.router import api_router
from api.infrastructure.http.static import ClientFiles
from api.infrastructure.logging_setup import configure_logging
from api.infrastructure.mongo.storage import MongoStorage

logger = logging.getLogger('api')


def create_app(settings: Settings | None = None, *, storage: Storage | None = None) -> FastAPI:
    config = settings or load_settings_or_exit()
    configure_logging(level=config.effective_log_level, log_format=config.effective_log_format)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        active = storage or await _connect(config)
        app.state.services = Services.build(active)
        try:
            seeded = (
                config.should_seed
                and await SeedDemoData(
                    parts=active.parts,
                    operation_types=active.operation_types,
                    process_cards=active.process_cards,
                ).execute()
            )
            logger.info(
                'Process cards API ready',
                extra={
                    'environment': config.app_env,
                    'database': config.safe_mongodb_uri,
                    'demoDataSeeded': seeded,
                    'staticDir': str(config.static_dir) if config.static_dir else None,
                },
            )
            yield
        finally:
            await active.close()
            logger.info('Server stopped')

    app = DocumentedApi(
        title=TITLE,
        version=VERSION,
        description=DESCRIPTION,
        openapi_tags=TAGS,
        openapi_url=OPENAPI_URL,
        docs_url=None,
        redoc_url=None,
        generate_unique_id_function=operation_id,
        lifespan=lifespan,
    )
    install_middleware(app, body_limit_bytes=BODY_LIMIT_BYTES)
    register_error_handlers(app)
    app.include_router(api_router())
    if config.static_dir is not None:
        app.mount('/', ClientFiles(config.static_dir), name='client')
    return app


async def _connect(settings: Settings) -> Storage:
    try:
        return await MongoStorage.connect(
            uri=settings.mongodb_uri, timeout_ms=settings.mongodb_timeout_ms
        )
    except StorageUnavailableError:
        logger.error(
            'Cannot connect to MongoDB, check that the database is running',
            extra={'database': settings.safe_mongodb_uri},
        )
        raise
