"""Dataset loading and in-memory storage.

The dataset is read from disk exactly once (at app startup) and validated into
typed models. Requests then read from memory — nothing touches the filesystem or
a model on the hot path.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import organizations as organizations_loader
from .schemas import InstitutionsFile, LanguagesResponse, Organization


class DataStore:
    """Holds the validated dataset(s) for the lifetime of the process."""

    def __init__(
        self, data_path: Path, institutions_path: Path, organizations_path: Path | None = None
    ) -> None:
        self._path = data_path
        self._institutions_path = institutions_path
        self._organizations_path = organizations_path
        self._dataset: LanguagesResponse | None = None
        self._institutions: InstitutionsFile | None = None
        self._organizations: list[Organization] = []

    def load(self) -> None:
        """Read and validate both datasets. Raises if missing or malformed."""
        if not self._path.exists():
            raise RuntimeError(
                f"Dataset not found at {self._path}. "
                "Run `python scripts/build_data.py` to generate it."
            )
        raw = json.loads(self._path.read_text(encoding="utf-8"))
        self._dataset = LanguagesResponse.model_validate(raw)

        if not self._institutions_path.exists():
            raise RuntimeError(f"Institutions seed data not found at {self._institutions_path}.")
        raw_inst = json.loads(self._institutions_path.read_text(encoding="utf-8"))
        self._institutions = InstitutionsFile.model_validate(raw_inst)

        # Organizations are an optional enrichment — a missing file yields an
        # empty list (load_organizations handles that) and never blocks startup.
        if self._organizations_path is not None:
            self._organizations = organizations_loader.load_organizations(self._organizations_path)

    @property
    def dataset(self) -> LanguagesResponse:
        if self._dataset is None:
            raise RuntimeError("DataStore.load() has not been called.")
        return self._dataset

    @property
    def institutions(self) -> InstitutionsFile:
        if self._institutions is None:
            raise RuntimeError("DataStore.load() has not been called.")
        return self._institutions

    @property
    def organizations(self) -> list[Organization]:
        return self._organizations
