"""Round-trip serialization of ib_async ContractDetails to/from JSON-able dicts.

The instruments table caches full contract details; the job engine rebuilds
Contract and ContractDetails objects from that cache so jobs can be created and
resumed without a live IB connection.
"""

import dataclasses
from typing import Any

from ib_async import ComboLeg, Contract, ContractDetails, TagValue


def to_jsonable(obj: Any) -> Any:
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: to_jsonable(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if hasattr(obj, "_asdict"):  # NamedTuple (e.g. TagValue) -> keep field names
        return {key: to_jsonable(value) for key, value in obj._asdict().items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(item) for item in obj]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)


_CONTRACT_FIELDS = {f.name for f in dataclasses.fields(Contract)}
_DETAILS_FIELDS = {f.name for f in dataclasses.fields(ContractDetails)}
_COMBO_LEG_FIELDS = {f.name for f in dataclasses.fields(ComboLeg)}


def contract_from_jsonable(data: dict[str, Any]) -> Contract:
    kwargs = {key: value for key, value in data.items() if key in _CONTRACT_FIELDS}
    combo_legs = kwargs.pop("comboLegs", None) or []
    kwargs.pop("deltaNeutralContract", None)  # not needed for data requests
    contract = Contract(**kwargs)
    contract.comboLegs = [
        ComboLeg(**{k: v for k, v in leg.items() if k in _COMBO_LEG_FIELDS}) for leg in combo_legs
    ]
    return contract


def details_from_jsonable(data: dict[str, Any]) -> ContractDetails:
    kwargs = {key: value for key, value in data.items() if key in _DETAILS_FIELDS}
    contract_data = kwargs.pop("contract", None) or {}
    sec_id_list = kwargs.pop("secIdList", None) or []
    details = ContractDetails(**kwargs)
    details.contract = contract_from_jsonable(contract_data)
    details.secIdList = [TagValue(item["tag"], item["value"]) for item in sec_id_list]
    return details
