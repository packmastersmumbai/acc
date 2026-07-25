/**
 * Mock google.script.run bridge injected into pages during testing.
 * Mirrors PackMastersQrAtt's harness: each call chain
 * (withSuccessHandler → withFailureHandler → method) is an isolated context so
 * concurrent calls don't stomp each other's handlers.
 *
 * Data is Zoho-Books-shaped, derived from live responses captured this session.
 * Amounts are in paise-free rupees (integers) using the Indian numbering system.
 */
const GAS_MOCK_SCRIPT = `
(function() {
  window.__gasDelay = 100;

  // Home dashboard rollup (getHomeData)
  var MOCK_HOME = {
    success: true,
    receivable: 24781400,
    payable: 13429050,
    overdue: 8912040,
    unreconciled: 517,
    attention: [
      { name: 'Yash Poly Plast',   gap: '34 bills unpaid',      amount: 7723056,  overdue: true,
        contact_id: '116000000618000', contact_ids: ['116000000618000'] },
      { name: 'Henkel Adhesives',  gap: '146 draft challans',   amount: 66625859, overdue: false,
        contact_id: '116000000618111', contact_ids: ['116000000618111'] },
      // no contact_id — a party Zoho gave us no id for; must render inert
      { name: 'Dorf Ketal',        gap: '3 void invoices carry balance', amount: 61236, overdue: false,
        contact_id: '', contact_ids: [] }
    ]
  };

  // Contact match by GSTIN (matchContactByGstin)
  var MOCK_MATCH = {
    contact_id: '116000000071027',
    contact_name: 'YARA FERTILISERS INDIA PVT. LTD.',
    contact_type: 'customer',
    gst_no: '27AABFY9773F1ZN',
    outstanding: 412300
  };

  // Uncategorized bank txns (uncategorized)
  var MOCK_UNCAT = [
    { transactionId: '116000000916029', date: '2026-04-14', amount: 174378, type: 'credit',
      narration: 'NEFT YASH POLY PLAST / IN42609256237396' },
    { transactionId: '116000000916030', date: '2026-04-15', amount: 500000, type: 'debit',
      narration: 'RTGS HENKEL ADHESIVES TECH' }
  ];

  // Suggested match for a txn (suggestMatch)
  var MOCK_SUGGEST = {
    type: 'invoice', id: '116000000618057', label: 'INV-002841', confidence: 'amount+date'
  };

  // Parsed bill from OCR (parseBill)
  var MOCK_PARSE = {
    supplier: 'Yash Poly Plast', gstin: '27AABFY9773F1ZN',
    invoiceNo: 'YPP/24-25/1182', amount: 174378, gstPct: 18
  };

  // Party ledger (getPartyLedger): open invoices for a customer.
  var MOCK_LEDGER = {
    contact_name: 'YARA FERTILISERS INDIA PVT. LTD.',
    outstanding: 412300,
    invoices: [
      { invoice_id: '116000000618057', invoice_number: 'INV-002841', date: '2026-03-31', balance: 195511, status: 'overdue' },
      { invoice_id: '116000000618099', invoice_number: 'INV-002902', date: '2026-04-20', balance: 216789, status: 'sent' }
    ]
  };

  // Per-test overrides: window.__gasOverride('parseBill', fn) makes the mock
  // return whatever fn(...args) returns for that method. Cleared on reload.
  window.__gasOverrides = window.__gasOverrides || {};
  window.__gasOverride = function(name, fn) { window.__gasOverrides[name] = fn; };

  function makeRunner(sh, fh) {
    function respond(value) { setTimeout(function() { if (sh) sh(value); }, window.__gasDelay || 100); }
    function fail(err)      { setTimeout(function() { if (fh) fh(err);  }, window.__gasDelay || 100); }
    // if a test overrode this method, use it; else the default below.
    function dispatch(name, args, dflt) {
      var o = window.__gasOverrides[name];
      if (!o) { respond(dflt); return; }
      // A server function that throws must reach withFailureHandler, exactly as
      // google.script.run does — not propagate out of the call.
      var v;
      try { v = o.apply(null, args); } catch (e) { fail(e); return; }
      respond(v);
    }

    return {
      withSuccessHandler: function(h) { return makeRunner(h, fh); },
      withFailureHandler: function(h) { return makeRunner(sh, h); },

      getHomeData:         function(force)       { dispatch('getHomeData', [force], MOCK_HOME); },
      ocrExtract:          function(b64, mime)   { dispatch('ocrExtract', [b64, mime], 'TAX INVOICE\\nGSTIN 27AABFY9773F1ZN\\nYash Poly Plast\\nYPP/24-25/1182\\nTotal 1,74,378'); },
      parseBill:           function(text)        { dispatch('parseBill', [text], MOCK_PARSE); },
      matchContactByGstin: function(gstin)       { dispatch('matchContactByGstin', [gstin], gstin === '27AABFY9773F1ZN' ? MOCK_MATCH : null); },
      createContact:       function(obj)         { dispatch('createContact', [obj], { success: true, contact_id: '116000000099999', contact_name: obj && obj.contact_name }); },
      postBill:            function(obj)         { dispatch('postBill', [obj], { success: true, bill_id: '116000000088888' }); },
      markInvoicePaid:     function(obj)         { dispatch('markInvoicePaid', [obj], { success: true, payment_id: '116000000077777', applied: true }); },
      payVendorBill:       function(obj)         { dispatch('payVendorBill', [obj], { success: true, payment_id: '116000000066666' }); },
      uncategorized:       function(acctId)      { dispatch('uncategorized', [acctId], MOCK_UNCAT); },
      suggestMatch:        function(txn)         { dispatch('suggestMatch', [txn], MOCK_SUGGEST); },
      acceptMatch:         function(txnId, m)    { dispatch('acceptMatch', [txnId, m], { success: true }); },
      attachToInvoice:     function(id, b64, n, mime) { dispatch('attachToInvoice', [id, b64, n, mime], { success: true, documentId: '116000000055555' }); },
      archiveScan:         function(b64, mime, sup) { dispatch('archiveScan', [b64, mime, sup], { fileId: '1ArCh1V3', url: 'https://drive.google.com/file/d/1ArCh1V3/view' }); },
      getExpenseAccounts:  function()            { dispatch('getExpenseAccounts', [], [
                             { id: '1161923000000034003', name: 'Cost of Goods Sold' },
                             { id: '1161923000000000460', name: 'Other Expenses' }]); },
      fileDocument:        function(b64, n, mime, folder) { dispatch('fileDocument', [b64, n, mime, folder], { fileId: 'drive-file-123', url: 'https://drive.google.com/file/d/drive-file-123' }); },
      backupNow:           function()            { dispatch('backupNow', [], { records: 5856, driveFileId: 'backup-2026-07-25' }); },
      getPartyLedger:      function(id)          { dispatch('getPartyLedger', [id], MOCK_LEDGER); }
    };
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);
})();
`;

module.exports = { GAS_MOCK_SCRIPT };
