import re
from pathlib import Path, PurePosixPath

from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

HASHED_ASSET = re.compile(r'-[A-Z0-9]{8,}\.[a-z0-9]+$')
IMMUTABLE = 'public, max-age=31536000, immutable'


class ClientFiles(StaticFiles):
    def __init__(self, directory: Path) -> None:
        if not (directory / 'index.html').is_file():
            raise RuntimeError(f'STATIC_DIR does not contain index.html: {directory}')
        super().__init__(directory=directory, html=True)

    async def get_response(self, path: str, scope: Scope) -> Response:
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(status_code=404)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            is_page = scope['method'] in {'GET', 'HEAD'} and not PurePosixPath(path).suffix
            if error.status_code != 404 or not is_page:
                raise
            response = await super().get_response('index.html', scope)
            response.headers['Cache-Control'] = 'no-cache'
            return response
        response.headers['Cache-Control'] = IMMUTABLE if HASHED_ASSET.search(path) else 'no-cache'
        return response
