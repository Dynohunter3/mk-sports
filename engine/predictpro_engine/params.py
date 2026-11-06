"""Helpers for merging per-league parameter overrides into frozen dataclasses."""

from __future__ import annotations

from dataclasses import fields, replace
from typing import Any, Mapping, TypeVar

T = TypeVar("T")


def merge_params(base: T, overrides: Mapping[str, Any] | None) -> T:
    """Return a copy of `base` with `overrides` applied. Unknown keys raise, to catch config typos."""
    if not overrides:
        return base
    names = {f.name for f in fields(base)}  # type: ignore[arg-type]
    unknown = set(overrides) - names
    if unknown:
        raise ValueError(f"unknown model parameter(s) for {type(base).__name__}: {sorted(unknown)}")
    return replace(base, **dict(overrides))  # type: ignore[type-var]
