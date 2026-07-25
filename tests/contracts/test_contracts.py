"""
READ-ONLY contract tests: verify the live Zoho Books API shapes the app depends
on. Zero writes. Run via PowerShell after exporting Zoho creds:

    pytest tests/contracts -v

The app's server code (src/*.js) assumes these shapes; if Zoho changes them,
these tests fail before the app misbehaves.
"""
from conftest import PM

AXIS_ACCOUNT = "1161923000000540009"  # "PACK MASTERS" Axis bank (Global Constraints)


def test_contact_list_carries_gst_and_outstanding(zoho):
    """matchContactByGstin + home rollup read gst_no/outstanding off the LIST."""
    c = zoho.books("contacts", PM, per_page=1, contact_type="vendor")["contacts"][0]
    assert "gst_no" in c
    assert "outstanding_payable_amount" in c
    assert "contact_name" in c


def test_invoice_detail_has_balance_and_status(zoho):
    """markInvoicePaid reads balance/status live before applying money."""
    iid = zoho.books("invoices", PM, per_page=1)["invoices"][0]["invoice_id"]
    d = zoho.books(f"invoices/{iid}", PM)["invoice"]
    assert "balance" in d
    assert "status" in d


def test_uncategorized_endpoint_shape(zoho):
    """Reconcile uses base banktransactions + status=uncategorized (NOT the
    /uncategorized collection). Assert the shape works and returns rows; the
    exact count (517 at capture) may drift, so we don't hardcode it."""
    r = zoho.books(
        "banktransactions", PM,
        account_id=AXIS_ACCOUNT, status="uncategorized", per_page=200,
    )
    assert r["code"] == 0
    assert len(r["banktransactions"]) > 0
    assert all(t["status"] == "uncategorized" for t in r["banktransactions"])


def test_banktransactions_page_context_has_no_total(zoho):
    """Regression guard for the getHomeData bug: page_context has NO 'total' key,
    so the unreconciled count MUST be derived by paging, not read from it."""
    r = zoho.books(
        "banktransactions", PM,
        account_id=AXIS_ACCOUNT, status="uncategorized", per_page=1,
    )
    assert "total" not in r["page_context"]
    assert "has_more_page" in r["page_context"]


def test_all_six_tax_ids_resolve(zoho):
    """postBill needs a tax_id per line; these six ids are hardcoded in the app."""
    taxes = {
        t["tax_id"]: (t["tax_name"], t["tax_percentage"])
        for t in zoho.books("settings/taxes", PM)["taxes"]
    }
    assert taxes["1161923000000062145"] == ("GST18", 18)
    assert taxes["1161923000000062129"] == ("GST5", 5)
    assert taxes["1161923000000062115"] == ("GST0", 0)
    assert taxes["1161923000000062139"] == ("IGST18", 18)
    assert taxes["1161923000000062123"] == ("IGST5", 5)
    assert taxes["1161923000000062093"] == ("IGST0", 0)


def test_match_discovery_endpoint_returns_code_zero(zoho):
    """suggestMatch reads banktransactions/uncategorized/{id}/match — READ only;
    the POST accept body is a gated spike, never exercised here."""
    txns = zoho.books(
        "banktransactions", PM,
        account_id=AXIS_ACCOUNT, status="uncategorized", per_page=1,
    )["banktransactions"]
    tid = txns[0]["transaction_id"]
    m = zoho.books(f"banktransactions/uncategorized/{tid}/match", PM)
    assert m["code"] == 0
    assert "matching_transactions" in m
    assert "matching_documents" in m
