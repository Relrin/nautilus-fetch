"""Bridge ib_async contract objects into Nautilus instrument definitions.

ib_async mirrors the official ibapi field names, and Nautilus's
``IBContractDetails.from_contract_details`` reads plain ``__dict__`` attributes
and filters to known fields — so ib_async ``ContractDetails`` converts without a
field-by-field mapping. Venue derivation mirrors the default behavior of
``InteractiveBrokersInstrumentProvider.determine_venue_from_contract`` (no MIC
conversion, no symbol overrides) so our catalog symbology matches what a live
Nautilus IB deployment would produce.
"""

import copy
from typing import Any

from nautilus_trader.adapters.interactive_brokers.common import IBContractDetails
from nautilus_trader.adapters.interactive_brokers.parsing.instruments import (
    ib_contract_to_instrument_id,
    parse_instrument,
)
from nautilus_trader.model.instruments import Instrument


def to_ib_contract_details(details: Any) -> IBContractDetails:
    """Convert ib_async (or ibapi) ContractDetails into a Nautilus IBContractDetails."""
    # from_contract_details mutates its argument (replaces .contract with an
    # IBContract struct) — convert a shallow copy so callers keep the original
    return IBContractDetails.from_contract_details(copy.copy(details))


def derive_venue(details: IBContractDetails) -> str:
    contract = details.contract
    if contract.secType == "CFD":
        return "IBCFD"
    if contract.secType == "CMDTY":
        return "IBCMDTY"

    if contract.secType == "STK":
        if contract.primaryExchange and contract.primaryExchange != "SMART":
            return contract.primaryExchange
        return contract.exchange

    if contract.exchange == "SMART" and contract.primaryExchange and contract.primaryExchange != "SMART":
        return contract.primaryExchange
    if contract.exchange != "SMART":
        return contract.exchange

    if contract.secType == "OPT" and details.validExchanges:
        parts = [part.strip() for part in details.validExchanges.split(",") if part.strip()]
        chosen = next((part for part in parts if part != "SMART"), parts[0] if parts else None)
        if chosen:
            return chosen

    return contract.exchange


def details_to_instrument(details: Any) -> Instrument:
    """ib_async ContractDetails -> Nautilus Instrument (id, precisions, definitions)."""
    ib_details = to_ib_contract_details(details)
    return parse_instrument(ib_details, venue=derive_venue(ib_details))


def derive_instrument_id(details: Any) -> str:
    """Nautilus instrument id for the contract, tolerating partial details.

    Full instrument parsing can fail on incomplete details (e.g. equities
    without an ISIN in secIdList); the id itself never needs those fields.
    """
    ib_details = to_ib_contract_details(details)
    venue = derive_venue(ib_details)
    try:
        return str(parse_instrument(ib_details, venue=venue).id)
    except Exception:
        return str(ib_contract_to_instrument_id(ib_details.contract, venue))
