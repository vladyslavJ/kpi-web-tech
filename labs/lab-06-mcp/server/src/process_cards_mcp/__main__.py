import argparse
import logging
from typing import Literal

import anyio
import uvicorn

from process_cards_mcp.config import Settings, load_settings_or_exit
from process_cards_mcp.infrastructure.logging_setup import configure_logging
from process_cards_mcp.infrastructure.mongo_catalog import MongoCatalog
from process_cards_mcp.server import create_server

logger = logging.getLogger('process_cards_mcp')

Transport = Literal['stdio', 'http']


async def serve(settings: Settings, transport: Transport) -> None:
    catalog = MongoCatalog(settings.mongodb_uri, timeout_ms=settings.mongodb_timeout_ms)
    server = create_server(catalog)
    database = {'database': settings.safe_mongodb_uri}
    if await catalog.is_available():
        logger.info('Connected to MongoDB', extra=database)
    else:
        logger.warning(
            'MongoDB is not reachable, tools will report it until it starts', extra=database
        )
    try:
        if transport == 'stdio':
            logger.info('Serving MCP over stdio')
            await server.run_stdio_async()
        else:
            logger.info(
                'Serving MCP over Streamable HTTP',
                extra={'url': f'http://{settings.mcp_host}:{settings.mcp_port}/mcp'},
            )
            config = uvicorn.Config(
                server.streamable_http_app(),
                host=settings.mcp_host,
                port=settings.mcp_port,
                log_config=None,
                access_log=False,
                server_header=False,
            )
            await uvicorn.Server(config).serve()
    finally:
        await catalog.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        prog='python -m process_cards_mcp',
        description='MCP server with read-only tools for the process cards database',
    )
    parser.add_argument('--transport', choices=('stdio', 'http'), default='stdio')
    transport: Transport = parser.parse_args().transport
    settings = load_settings_or_exit()
    configure_logging(level=settings.log_level, log_format=settings.log_format)
    anyio.run(serve, settings, transport)


if __name__ == '__main__':
    main()
