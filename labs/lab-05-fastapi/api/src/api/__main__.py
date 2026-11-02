import uvicorn

from api.config import API_ROOT, load_settings_or_exit
from api.infrastructure.logging_setup import configure_logging


def main() -> None:
    settings = load_settings_or_exit()
    configure_logging(level=settings.effective_log_level, log_format=settings.effective_log_format)
    uvicorn.run(
        'api.app:create_app',
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=settings.is_development,
        reload_dirs=[str(API_ROOT / 'src')] if settings.is_development else None,
        log_config=None,
        access_log=False,
        server_header=False,
        timeout_graceful_shutdown=10,
    )


if __name__ == '__main__':
    main()
