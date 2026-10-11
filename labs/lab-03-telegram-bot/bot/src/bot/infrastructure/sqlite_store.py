import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from bot.domain.conversation import ChatMessage, Role

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat_id, id);
CREATE TABLE IF NOT EXISTS processed_updates (
    update_id INTEGER PRIMARY KEY,
    received_at TEXT NOT NULL
);
"""


class SqliteDatabase:
    def __init__(self, path: Path) -> None:
        self._path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(mode=0o600, exist_ok=True)
        with self.transaction() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec='seconds')


class SqliteConversationRepository:
    def __init__(self, database: SqliteDatabase, *, keep_per_chat: int = 50) -> None:
        self._database = database
        self._keep_per_chat = keep_per_chat

    def recent(self, chat_id: int, limit: int) -> list[ChatMessage]:
        if limit <= 0:
            return []
        with self._database.transaction() as connection:
            rows = connection.execute(
                'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?',
                (chat_id, limit),
            ).fetchall()
        return [ChatMessage(Role(role), content) for role, content in reversed(rows)]

    def append(self, chat_id: int, messages: Sequence[ChatMessage]) -> None:
        created_at = _now()
        with self._database.transaction() as connection:
            connection.executemany(
                'INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)',
                [
                    (chat_id, message.role.value, message.content, created_at)
                    for message in messages
                ],
            )
            connection.execute(
                'DELETE FROM messages WHERE chat_id = ? AND id NOT IN '
                '(SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?)',
                (chat_id, chat_id, self._keep_per_chat),
            )

    def clear(self, chat_id: int) -> None:
        with self._database.transaction() as connection:
            connection.execute('DELETE FROM messages WHERE chat_id = ?', (chat_id,))


class SqliteUpdateJournal:
    def __init__(self, database: SqliteDatabase, *, keep: int = 1000) -> None:
        self._database = database
        self._keep = keep

    def first_seen(self, update_id: int) -> bool:
        with self._database.transaction() as connection:
            inserted = connection.execute(
                'INSERT OR IGNORE INTO processed_updates (update_id, received_at) VALUES (?, ?)',
                (update_id, _now()),
            ).rowcount
            connection.execute(
                'DELETE FROM processed_updates WHERE update_id NOT IN '
                '(SELECT update_id FROM processed_updates ORDER BY update_id DESC LIMIT ?)',
                (self._keep,),
            )
        return inserted == 1
