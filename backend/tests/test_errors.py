import pytest

from nautilus_fetch.ib.errors import ErrorClass, classify


@pytest.mark.parametrize(
    ("code", "message", "expected"),
    [
        (162, "Historical Market Data Service error message:HMDS query returned no data", ErrorClass.EMPTY),
        (162, "API historical data query cancelled: pacing violation", ErrorClass.PACING),
        (162, "Historical Market Data Service error message:something else", ErrorClass.TRANSIENT),
        (165, "Historical Market Data Service query message", ErrorClass.INFO),
        (200, "No security definition has been found for the request", ErrorClass.PERMANENT),
        (354, "Requested market data is not subscribed", ErrorClass.PERMANENT),
        (504, "Not connected", ErrorClass.CONNECTIVITY),
        (1100, "Connectivity between IB and TWS has been lost", ErrorClass.CONNECTIVITY),
        (1102, "Connectivity between IB and TWS has been restored", ErrorClass.INFO),
        (2105, "HMDS data farm connection is broken", ErrorClass.CONNECTIVITY),
        (2106, "HMDS data farm connection is OK", ErrorClass.INFO),
        (10167, "Requested market data is not subscribed. Displaying delayed data", ErrorClass.PERMANENT),
        (99999, "Unknown mystery error", ErrorClass.TRANSIENT),
    ],
)
def test_classification_table(code: int, message: str, expected: ErrorClass):
    assert classify(code, message) is expected
