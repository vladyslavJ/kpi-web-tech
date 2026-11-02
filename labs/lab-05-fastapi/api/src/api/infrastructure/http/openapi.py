from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute

OPENAPI_URL = '/api/openapi.json'

TITLE = 'Технологічні карти'
VERSION = '1.0.0'
DESCRIPTION = """
REST API лабораторної роботи №5 (варіант 11): база даних технологічних карт деталей
з видом обробки й тривалістю кожної операції.

* **Деталі** — позначення, найменування й матеріал.
* **Види обробки** — довідник операцій: токарна, фрезерна, шліфувальна тощо.
* **Технологічні карти** — маршрут обробки деталі: операції з видом обробки, обладнанням
  і тривалістю у хвилинах.

Усі помилки мають єдиний формат `{"error": {"code", "message", "issues"}}`. Поле `issues`
є лише в помилках валідації (код 400) і вказує конкретні поля.
"""

TAGS = [
    {'name': 'Деталі', 'description': 'CRUD деталей, для яких складаються технологічні карти'},
    {'name': 'Види обробки', 'description': 'CRUD довідника видів обробки'},
    {
        'name': 'Технологічні карти',
        'description': 'CRUD технологічних карт: одна карта на деталь, від 1 до 30 операцій',
    },
    {'name': 'Статистика', 'description': 'Зведені показники та трудомісткість'},
    {'name': 'Стан', 'description': 'Перевірка роботи сервера й підключення до MongoDB'},
]

_DEFAULT_VALIDATION_SCHEMAS = ('HTTPValidationError', 'ValidationError')


def operation_id(route: APIRoute) -> str:
    head, *rest = route.name.split('_')
    return head + ''.join(word.capitalize() for word in rest)


class DocumentedApi(FastAPI):
    def openapi(self) -> dict[str, Any]:
        if self.openapi_schema:
            return self.openapi_schema
        schema = get_openapi(
            title=self.title,
            version=self.version,
            description=self.description,
            routes=self.routes,
            tags=self.openapi_tags,
        )
        for path_item in schema.get('paths', {}).values():
            for operation in path_item.values():
                responses = operation.get('responses', {})
                if responses.get('422', {}).get('description') == 'Validation Error':
                    del responses['422']
        components = schema.get('components', {}).get('schemas', {})
        for name in _DEFAULT_VALIDATION_SCHEMAS:
            components.pop(name, None)
        self.openapi_schema = schema
        return schema
