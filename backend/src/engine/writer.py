"""Idempotent writes into the Nautilus ParquetDataCatalog.

One catalog instance, writes serialized behind an asyncio lock and executed on
a worker thread (pyarrow writes are blocking). The caller supplies inclusive
file-label bounds chosen so adjacent chunks never collide with the catalog's
disjoint-interval check: bars cover (start, end] in close-timestamp terms so
labels are [start+1ns, end]; ticks cover [start, end) so labels are
[start, end-1ns]. A rewrite of the same chunk range trips the disjoint check,
deletes exactly its own range, and writes again — which is what makes chunk
downloads safely repeatable.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from nautilus_trader.model.instruments import Instrument
from nautilus_trader.persistence.catalog.parquet import ParquetDataCatalog

logger = logging.getLogger(__name__)


class CatalogWriter:
    def __init__(self, catalog_path: Path) -> None:
        catalog_path.mkdir(parents=True, exist_ok=True)
        self._catalog = ParquetDataCatalog(str(catalog_path))
        self._path = catalog_path
        self._lock = asyncio.Lock()

    @property
    def catalog(self) -> ParquetDataCatalog:
        return self._catalog

    async def ensure_instrument(self, instrument: Instrument) -> None:
        async with self._lock:
            await asyncio.to_thread(self._ensure_instrument_sync, instrument)

    def _ensure_instrument_sync(self, instrument: Instrument) -> None:
        existing = self._catalog.instruments(instrument_ids=[str(instrument.id)])
        if not existing:
            self._catalog.write_data([instrument])

    async def write_chunk(self, objs: list, *, label_start_ns: int, label_end_ns: int) -> int:
        """Write one chunk's objects; returns bytes added to the catalog."""
        if not objs:
            return 0
        async with self._lock:
            return await asyncio.to_thread(self._write_chunk_sync, objs, label_start_ns, label_end_ns)

    def _write_chunk_sync(self, objs: list, label_start_ns: int, label_end_ns: int) -> int:
        identifier = self._identifier_of(objs[0])
        size_before = self._identifier_size(identifier)
        start, end = label_start_ns, label_end_ns
        try:
            self._catalog.write_data(objs, start=start, end=end)
        except ValueError as exc:
            # Overlap with an earlier write of this same chunk (retry after a
            # partial failure, or a re-downloaded chunk): replace exactly our range.
            logger.info("Catalog overlap for %s [%d, %d]; rewriting (%s)", identifier, start, end, exc)
            self._catalog.delete_data_range(
                data_cls=type(objs[0]),
                identifier=identifier,
                start=start,
                end=end,
            )
            self._catalog.write_data(objs, start=start, end=end)
        return max(0, self._identifier_size(identifier) - size_before)

    @staticmethod
    def _identifier_of(obj) -> str:
        bar_type = getattr(obj, "bar_type", None)
        if bar_type is not None:
            return str(bar_type)
        return str(obj.instrument_id)

    def _identifier_size(self, identifier: str) -> int:
        data_dir = self._path / "data"
        if not data_dir.is_dir():
            return 0
        total = 0
        for class_dir in data_dir.iterdir():
            candidate = class_dir / identifier
            if candidate.is_dir():
                total += sum(f.stat().st_size for f in candidate.rglob("*.parquet"))
        return total
