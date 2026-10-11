import logging

from flask import Flask, Response, render_template, request
from flask.typing import ResponseReturnValue

from bot.config import WEBHOOK_PATH
from bot.domain.student import Student
from bot.infrastructure.telegram.webhook import (
    WEBHOOK_AUTH_HEADER,
    InvalidUpdateError,
    WebhookReceiver,
)
from bot.infrastructure.web.status import StatusReporter

MAX_BODY_BYTES = 1024 * 1024


def create_web_app(
    *,
    status: StatusReporter,
    student: Student,
    webhook: WebhookReceiver | None,
    logger: logging.Logger,
) -> Flask:
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = MAX_BODY_BYTES

    @app.get('/')
    def index() -> ResponseReturnValue:
        return render_template('status.html', status=status.snapshot(), student=student)

    @app.get('/health')
    def health() -> ResponseReturnValue:
        return {'status': 'ok'}

    if webhook is not None:
        receiver = webhook

        @app.post(WEBHOOK_PATH)
        def telegram_webhook() -> ResponseReturnValue:
            if not receiver.authorized(request.headers.get(WEBHOOK_AUTH_HEADER)):
                logger.warning('Rejected a webhook call with a wrong secret')
                return {'error': 'forbidden'}, 403
            try:
                receiver.receive(request.get_json(silent=True))
            except InvalidUpdateError:
                return {'error': 'invalid update'}, 400
            except Exception:
                logger.exception('Webhook update failed')
            return {'ok': True}

    @app.after_request
    def harden(response: Response) -> Response:
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('Referrer-Policy', 'no-referrer')
        if request.endpoint != 'static':
            response.headers.setdefault('Cache-Control', 'no-store')
        return response

    return app
