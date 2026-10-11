from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Student:
    full_name: str
    group: str
    variant: int
    university: str

    @property
    def short_name(self) -> str:
        surname, *names = self.full_name.split()
        initials = ''.join(f'{name[0]}.' for name in names)
        return f'{surname} {initials}' if initials else surname


@dataclass(frozen=True, slots=True)
class Contacts:
    phone: str | None = None
    email: str | None = None
    telegram: str | None = None
    github: str | None = None

    @property
    def is_empty(self) -> bool:
        return not any((self.phone, self.email, self.telegram, self.github))
