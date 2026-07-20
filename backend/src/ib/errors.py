"""Classification of IB API error codes into engine-level failure classes.

The mapping lives in this single module on purpose: IB distinguishes some
conditions only by message text (notably error 162), and those strings are
calibrated against live paper-gateway fixtures. Keep every string match here.
"""

from enum import StrEnum


class ErrorClass(StrEnum):
    PACING = "pacing"  # global cooldown, requeue chunk without counting the attempt
    EMPTY = "empty"  # no data for the requested window: chunk succeeds as empty
    PERMANENT = "permanent"  # retrying cannot help (bad contract, no subscription)
    CONNECTIVITY = "connectivity"  # engine-level pause, not a chunk failure
    TRANSIENT = "transient"  # retry with backoff
    INFO = "info"  # log only


# Codes with an unambiguous class regardless of message text.
_CODE_TABLE: dict[int, ErrorClass] = {
    165: ErrorClass.INFO,  # historical data farm status
    200: ErrorClass.PERMANENT,  # no security definition found
    321: ErrorClass.PERMANENT,  # server error validating request
    354: ErrorClass.PERMANENT,  # not subscribed to requested market data
    366: ErrorClass.TRANSIENT,  # no historical data query found for ticker id
    504: ErrorClass.CONNECTIVITY,  # not connected
    1100: ErrorClass.CONNECTIVITY,  # connectivity between IB and TWS lost
    1101: ErrorClass.INFO,  # connectivity restored, data lost
    1102: ErrorClass.INFO,  # connectivity restored, data maintained
    2103: ErrorClass.CONNECTIVITY,  # market data farm connection broken
    2104: ErrorClass.INFO,  # market data farm connection OK
    2105: ErrorClass.CONNECTIVITY,  # HMDS data farm connection broken
    2106: ErrorClass.INFO,  # HMDS data farm connection OK
    2107: ErrorClass.INFO,  # HMDS data farm inactive but should be available
    2110: ErrorClass.CONNECTIVITY,  # connectivity between TWS and server broken
    2158: ErrorClass.INFO,  # sec-def data farm connection OK
    10167: ErrorClass.PERMANENT,  # requested market data not subscribed (delayed available)
    10197: ErrorClass.PERMANENT,  # no market data during competing live session
}

# Human-readable hints surfaced with PERMANENT failures.
HINTS: dict[int, str] = {
    200: "IB has no security definition for this contract; check symbol/exchange/secType.",
    354: "Missing market data subscription for this instrument/exchange.",
    10167: "Missing market data subscription (delayed data may be available).",
    10197: "A competing live session holds the market data; close other TWS/gateway sessions.",
}


def classify(code: int, message: str) -> ErrorClass:
    if code == 162:
        # IB overloads 162: pacing violations and empty result sets share a code
        # and differ only in message text.
        lowered = message.lower()
        if "pacing violation" in lowered:
            return ErrorClass.PACING
        if "no data" in lowered:  # "HMDS query returned no data", "query returned no data"
            return ErrorClass.EMPTY
        return ErrorClass.TRANSIENT
    return _CODE_TABLE.get(code, ErrorClass.TRANSIENT)
