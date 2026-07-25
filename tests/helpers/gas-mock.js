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
      { name: 'Yash Poly Plast',   gap: '34 bills unpaid',      amount: 7723056,  overdue: true  },
      { name: 'Henkel Adhesives',  gap: '146 draft challans',   amount: 66625859, overdue: false },
      { name: 'Dorf Ketal',        gap: '3 void invoices carry balance', amount: 61236, overdue: false }
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

  function makeRunner(sh, fh) {
    function respond(value) { setTimeout(function() { if (sh) sh(value); }, window.__gasDelay || 100); }
    function fail(err)      { setTimeout(function() { if (fh) fh(err);  }, window.__gasDelay || 100); }

    return {
      withSuccessHandler: function(h) { return makeRunner(h, fh); },
      withFailureHandler: function(h) { return makeRunner(sh, h); },

      getHomeData:         function()            { respond(MOCK_HOME); },
      ocrExtract:          function(b64, mime)   { respond('TAX INVOICE\\nGSTIN 27AABFY9773F1ZN\\nYash Poly Plast\\nYPP/24-25/1182\\nTotal 1,74,378'); },
      parseBill:           function(text)        { respond(MOCK_PARSE); },
      matchContactByGstin: function(gstin)       { respond(gstin === '27AABFY9773F1ZN' ? MOCK_MATCH : null); },
      createContact:       function(obj)         { respond({ success: true, contact_id: '116000000099999', contact_name: obj && obj.contact_name }); },
      postBill:            function(obj)         { respond({ success: true, bill_id: '116000000088888' }); },
      markInvoicePaid:     function(obj)         { respond({ success: true, payment_id: '116000000077777', applied: true }); },
      payVendorBill:       function(obj)         { respond({ success: true, payment_id: '116000000066666' }); },
      uncategorized:       function(acctId)      { respond(MOCK_UNCAT); },
      suggestMatch:        function(txn)         { respond(MOCK_SUGGEST); },
      acceptMatch:         function(txnId, m)    { respond({ success: true }); },  // gated in UI until spike
      attachToInvoice:     function(id, b64, n, mime) { respond({ success: true, documentId: '116000000055555' }); },
      fileDocument:        function(b64, n, mime, folder) { respond({ fileId: 'drive-file-123', url: 'https://drive.google.com/file/d/drive-file-123' }); },
      backupNow:           function()            { respond({ records: 5856, driveFileId: 'backup-2026-07-25' }); }
    };
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);
})();
`;

module.exports = { GAS_MOCK_SCRIPT };
