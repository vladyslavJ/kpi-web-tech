import re
from html import escape

CHUNK_LIMIT = 3800
FENCE = '```'

HEADING = re.compile(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$')
BULLET = re.compile(r'^(\s*)[-*+]\s+(.*)$')
RULE = re.compile(r'^\s*([-*_])(\s*\1){2,}\s*$')
INLINE_CODE = re.compile(r'`([^`\n]+)`')
LINK = re.compile(r'\[([^\]\n]+)\]\((https?://[^\s)]+)\)')
BOLD = re.compile(r'\*\*(?=\S)(.+?)(?<=\S)\*\*')
ITALIC = re.compile(r'(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])')
STRIKE = re.compile(r'~~(?=\S)(.+?)(?<=\S)~~')
LANGUAGE = re.compile(r'[A-Za-z0-9_+#-]{1,20}')
PLACEHOLDER = re.compile('(\\d+)')


def markdown_to_html(markdown: str) -> str:
    output: list[str] = []
    code: list[str] | None = None
    language = ''
    for line in markdown.split('\n'):
        stripped = line.strip()
        if stripped.startswith(FENCE):
            if code is None:
                code, language = [], stripped.removeprefix(FENCE).strip()
            else:
                output.append(_code_block(code, language))
                code = None
        elif code is not None:
            code.append(line)
        else:
            output.append(_format_line(line))
    if code is not None:
        output.append(_code_block(code, language))
    return '\n'.join(output)


def split_markdown(markdown: str, limit: int = CHUNK_LIMIT) -> list[str]:
    splitter = _Splitter(limit)
    for line in markdown.split('\n'):
        splitter.add(line)
    return splitter.finish()


class _Splitter:
    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._chunks: list[str] = []
        self._lines: list[str] = []
        self._size = 0
        self._fresh = True
        self._open_fence: str | None = None

    def add(self, line: str) -> None:
        rest = line
        while len(rest) > self._room():
            if not self._fresh:
                self._flush()
                continue
            piece, rest = rest[: self._room()], rest[self._room() :]
            self._append(piece)
            self._flush()
        self._append(rest)
        if line.strip().startswith(FENCE):
            self._open_fence = line.strip() if self._open_fence is None else None

    def finish(self) -> list[str]:
        if not self._fresh:
            self._chunks.append('\n'.join(self._lines))
        return self._chunks or ['']

    def _room(self) -> int:
        separator = 1 if self._lines else 0
        reserve = len(FENCE) + 1 if self._open_fence is not None else 0
        return max(1, self._limit - self._size - separator - reserve)

    def _append(self, text: str) -> None:
        self._size += len(text) + (1 if self._lines else 0)
        self._lines.append(text)
        self._fresh = False

    def _flush(self) -> None:
        if self._open_fence is not None:
            self._lines.append(FENCE)
        self._chunks.append('\n'.join(self._lines))
        self._lines = [self._open_fence] if self._open_fence is not None else []
        self._size = len(self._open_fence) if self._open_fence is not None else 0
        self._fresh = True


def _code_block(lines: list[str], language: str) -> str:
    body = escape('\n'.join(lines), quote=False)
    if LANGUAGE.fullmatch(language):
        return f'<pre><code class="language-{language}">{body}</code></pre>'
    return f'<pre>{body}</pre>'


def _format_line(line: str) -> str:
    if RULE.match(line):
        return '──────────'
    if heading := HEADING.match(line):
        return f'<b>{_inline(heading.group(1))}</b>'
    if bullet := BULLET.match(line):
        return f'{bullet.group(1)}• {_inline(bullet.group(2))}'
    return _inline(line)


def _inline(text: str) -> str:
    parts = INLINE_CODE.split(text)
    return ''.join(
        f'<code>{escape(part, quote=False)}</code>' if index % 2 else _emphasis(part)
        for index, part in enumerate(parts)
    )


def _emphasis(text: str) -> str:
    links: list[str] = []

    def keep_link(match: re.Match[str]) -> str:
        label = escape(match.group(1), quote=False)
        links.append(f'<a href="{escape(match.group(2))}">{label}</a>')
        return f'{len(links) - 1}'

    text = escape(LINK.sub(keep_link, text), quote=False)
    text = BOLD.sub(r'<b>\1</b>', text)
    text = STRIKE.sub(r'<s>\1</s>', text)
    text = ITALIC.sub(r'<i>\1</i>', text)
    return PLACEHOLDER.sub(lambda match: links[int(match.group(1))], text)
