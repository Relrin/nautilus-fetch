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

from nautilus_trader.model.data import Bar, OrderBookDepth10, QuoteTick, TradeTick
from nautilus_trader.model.instruments import Instrument
from nautilus_trader.persistence.catalog.parquet import ParquetDataCatalog

logger = logging.getLogger(__name__)

# catalog class-directory name -> data class (as written by this app)
_DATA_CLASSES: dict[str, type] = {
    "bar": Bar,
    "trade_tick": TradeTick,
    "quote_tick": QuoteTick,
    "order_book_depth10": OrderBookDepth10,
}


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

    async def summary(self) -> dict:
        return await asyncio.to_thread(self._summary_sync)

    def _summary_sync(self) -> dict:
        data_dir = self._path / "data"
        classes = []
        total_bytes = 0
        if data_dir.is_dir():
            for class_dir in sorted(data_dir.iterdir()):
                if not class_dir.is_dir():
                    continue
                identifiers = []
                for ident_dir in sorted(class_dir.iterdir()):
                    if not ident_dir.is_dir():
                        continue
                    files = sorted(ident_dir.glob("*.parquet"))
                    if not files:
                        continue
                    size = sum(f.stat().st_size for f in files)
                    total_bytes += size
                    # filenames are "{startISO}_{endISO}.parquet": lexically sortable
                    identifiers.append(
                        {
                            "identifier": ident_dir.name,
                            "files": len(files),
                            "bytes": size,
                            "start": files[0].stem.split("_")[0],
                            "end": files[-1].stem.split("_")[-1],
                        }
                    )
                if identifiers:
                    classes.append({"data_type": class_dir.name, "identifiers": identifiers})
        return {"path": str(self._path), "total_bytes": total_bytes, "classes": classes}

    async def consolidate(
        self,
        *,
        data_type: str | None = None,
        identifier: str | None = None,
        ensure_contiguous_files: bool = False,
        deduplicate: bool = False,
    ) -> None:
        """Merge the many small per-chunk files. Serialized with chunk writes."""
        async with self._lock:
            await asyncio.to_thread(
                self._consolidate_sync, data_type, identifier, ensure_contiguous_files, deduplicate
            )

    def _consolidate_sync(
        self,
        data_type: str | None,
        identifier: str | None,
        ensure_contiguous_files: bool,
        deduplicate: bool,
    ) -> None:
        if data_type is None:
            self._catalog.consolidate_catalog(
                ensure_contiguous_files=ensure_contiguous_files, deduplicate=deduplicate
            )
            return
        data_cls = _DATA_CLASSES.get(data_type)
        if data_cls is None:
            raise ValueError(
                f"Unknown data_type {data_type!r}; expected one of {sorted(_DATA_CLASSES)}"
            )
        if identifier is not None:
            identifiers = [identifier]
        else:  # consolidate_data(identifier=None) is a silent no-op: enumerate
            class_dir = self._path / "data" / data_type
            identifiers = (
                [d.name for d in sorted(class_dir.iterdir()) if d.is_dir()]
                if class_dir.is_dir()
                else []
            )
        for ident in identifiers:
            self._catalog.consolidate_data(
                data_cls=data_cls,
                identifier=ident,
                ensure_contiguous_files=ensure_contiguous_files,
                deduplicate=deduplicate,
            )

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
