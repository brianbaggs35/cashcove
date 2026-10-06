"""What an answer used, in tokens."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Tokens:
    """The tokens one answer used."""

    # Every token that went in, including any read from or written to the provider's cache.
    input: int = 0
    output: int = 0
    # Of the input, what was read back from the provider's cache, which costs less.
    cached: int = 0
    # Of the input, what was written to it, which some providers charge extra for.
    written: int = 0

    @property
    def used(self) -> bool:
        return bool(self.input or self.output)
