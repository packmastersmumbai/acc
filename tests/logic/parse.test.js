const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Load src/Parse.js as pure functions via a vm shim (no browser, no GAS).
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Parse.js'), 'utf8'), ctx);

test('parseGstin derives pan and state code', () => {
  const r = ctx.parseGstin('GSTIN 27AABFY9773F1ZN TAX INVOICE');
  expect(r.gstin).toBe('27AABFY9773F1ZN');
  expect(r.pan).toBe('AABFY9773F');
  expect(r.stateCode).toBe('27');
});

test('parseGstin returns null when no GSTIN present', () => {
  expect(ctx.parseGstin('just some text, no tax id here')).toBe(null);
  expect(ctx.parseGstin('')).toBe(null);
});

test('interStateFrom: 27 (Maharashtra) is intra, others inter', () => {
  expect(ctx.interStateFrom('27')).toBe(false);
  expect(ctx.interStateFrom('06')).toBe(true); // Haryana → IGST
  expect(ctx.interStateFrom('29')).toBe(true); // Karnataka → IGST
});

test('parseBill extracts supplier, gstin, invoice no, amount, gst%', () => {
  const ocr = [
    'Yash Poly Plast',
    'TAX INVOICE',
    'GSTIN 27AABFY9773F1ZN',
    'Invoice No: YPP/24-25/1182',
    'CGST 9% SGST 9% (GST 18%)',
    'Grand Total  1,74,378.00',
  ].join('\n');
  const b = ctx.parseBill(ocr);
  expect(b.gstin).toBe('27AABFY9773F1ZN');
  expect(b.invoiceNo).toBe('YPP/24-25/1182');
  expect(b.amount).toBe(174378);
  expect(b.gstPct).toBe(18);
  expect(b.supplier).toBe('Yash Poly Plast');
});

test('parseBill prefers a labelled total over a larger stray figure', () => {
  const b = ctx.parseBill('Qty 5\nRate 200\nSubtotal 1,000\nGST 18%\nTotal 1,180');
  expect(b.amount).toBe(1180);
  expect(b.gstPct).toBe(18);
});

// A real bill is full of long digit strings that dwarf the total. Largest-wins
// picks the HSN code or the PIN, silently posting a wrong amount to Zoho.
test('parseBill ignores HSN codes, PIN codes and phone numbers', () => {
  const ocr = [
    'Yash Poly Plast',
    'Plot 44, MIDC Andheri, Mumbai 400093',
    'Phone 9820044556',
    'GSTIN 27AABFY9773F1ZN',
    'Invoice No: YPP/24-25/1182',
    'HSN 39231010   Qty 500   Rate 24.50',
    'Grand Total  12,250.00',
  ].join('\n');
  const b = ctx.parseBill(ocr);
  expect(b.amount).toBe(12250);
});

test('parseBill takes the grand total, not the larger subtotal line', () => {
  // "Taxable value" can exceed the grand total on a credit-note-adjusted bill.
  const b = ctx.parseBill('Taxable Value 99,000.00\nRound Off -0.40\nGrand Total 8,500.00');
  expect(b.amount).toBe(8500);
});

test('parseBill reads an amount written in the Indian lakh grouping', () => {
  const b = ctx.parseBill('Invoice No: A/1\nAmount Payable  1,74,378.00');
  expect(b.amount).toBe(174378);
});

test('parseBill returns null amount when no figure is labelled', () => {
  // Better to make the user type it than to guess and post a wrong bill.
  expect(ctx.parseBill('HSN 39231010\nPIN 400093').amount).toBe(null);
});

// Real Amazon/Aerol tax invoice (OCR'd via Drive). A table puts the TOTAL:
// label on its own line and the figures on the NEXT line, and the document
// opens with a "Sold By :" label rather than the supplier name.
const AEROL = [
  'Sold By : ',
  'AEROL FORMULATIONS PRIVATE LIMITED  * Rect/Killa Nos. 38//8/2 min, Village - Binola, Tehsil - Manesar Gurgaon, Haryana, 122413 ',
  'IN ',
  'PAN No: AAACA0009N ',
  'GST Registration No: 06AAACA0009N1Z2 ',
  'Tax Invoice/Bill of Supply/Cash Memo (Original for Recipient) ',
  'Billing Address : ',
  'Pack Masters ',
  'Order Number: 404-9381093-8110713 Invoice Number : DEL5-2627 Order Date: 15.08.2024 ',
  '\tDescription ',
  '\t1 ',
  '\tAerol Combo Silicone Lubricant Spray (300g) | B0BGS3QG28 ',
  'HSN:34039900',
  '\t₹521.19 ',
  '\t1 ',
  '\t₹521.19 ',
  '\t18% ',
  '\tIGST ',
  '\t₹93.81 ',
  '\t₹615.00',
  '\tTOTAL: ',
  '\t',
  '',
  '\t₹93.81 ₹615.00',
  '\tAmount in Words: ',
  'Six Hundred Fifteen only',
].join('\n');

test('parseBill reads a TOTAL: that sits on a later line (table layout)', () => {
  expect(ctx.parseBill(AEROL).amount).toBe(615);
});

test('parseBill takes the supplier name, not the "Sold By :" label', () => {
  expect(ctx.parseBill(AEROL).supplier).toBe('AEROL FORMULATIONS PRIVATE LIMITED');
});

test('parseBill reads the SELLER gstin, not our own billing-address gstin', () => {
  const b = ctx.parseBill(AEROL);
  expect(b.gstin).toBe('06AAACA0009N1Z2');
  expect(ctx.interStateFrom(b.gstin.slice(0, 2))).toBe(true); // Haryana → IGST
});

test('parseBill gets the invoice number from an inline "Invoice Number :"', () => {
  expect(ctx.parseBill(AEROL).invoiceNo).toBe('DEL5-2627');
});

// Real photographed RBQ Enterprises bill. Intra-state (both parties 27), so tax
// is split CGST 9% + SGST 9%, and OUR OWN gstin appears in the receiver block
// BEFORE the seller's.
const RBQ = [
  'RBQ ENTERPRISES',
  'Digital & Offset Print Solution',
  'TAX INVOICE',
  'Details of Receiver :',
  'PACK MASTERS',
  'INVOICE NO.:  RBQ/2026-27/142',
  'INVOICE DATE :  04-07-2026',
  'Consignor Name & Address :',
  'RBQ ENTERPRISES',
  'STATE CODE : 27',
  'GSTIN  : 27AFGPM0888K1ZY',
  'GSTIN  : 27PPEPS9516F1Z6',
  '1  BUGSEAL Labels for 2170   2170   20.00   43400.00',
  'Total Amount Before Tax',
  '43,400.00',
  'Add : SGST   9%',
  '3,906.00',
  'Add : CGST   9%',
  '3,906.00',
  'Total Tax Amount  GST',
  '7,812.00',
  'Total Invoice Amount After GST Tax',
  '51,212.00',
].join('\n');

test('parseBill takes the SELLER gstin even when ours appears first', () => {
  // 27AFGPM0888K1ZY is Pack Masters' own — posting a bill against it would
  // book the purchase to ourselves.
  expect(ctx.parseBill(RBQ).gstin).toBe('27PPEPS9516F1Z6');
});

test('parseBill sums CGST + SGST into one rate for an intra-state bill', () => {
  expect(ctx.parseBill(RBQ).gstPct).toBe(18);
});

test('parseBill reads the after-tax total, not the taxable value', () => {
  expect(ctx.parseBill(RBQ).amount).toBe(51212);
  expect(ctx.parseBill(RBQ).supplier).toBe('RBQ ENTERPRISES');
  expect(ctx.parseBill(RBQ).invoiceNo).toBe('RBQ/2026-27/142');
});

test('an intra-state bill is not flagged inter-state', () => {
  expect(ctx.interStateFrom(ctx.parseBill(RBQ).gstin.slice(0, 2))).toBe(false);
});

// VERBATIM Drive OCR output of the photographed RBQ bill (WhatsApp jpeg, 215KB).
// Note how little structure survives: the invoice number appears BEFORE its
// label, and every total is separated from its label by the whole terms block.
const RBQ_OCR = [
  '________________',
  '',
  'LLL231 131/UD',
  'RBQ ENTERPRISES',
  'Digital & Offset Print Solution',
  'Nichem',
  'PM26/07',
  'OFFICE: 5120, Ganesh Nagar-02, Karanja Road,',
  'Details of Receiver:',
  'TAX INVOICE',
  'RBQ/2026-27/142',
  'INVOICE NO.:',
  'PACK MASTERS',
  'INVOICE DATE:',
  '04-07-2026',
  'STATE CODE: 27',
  'GSTIN',
  ':27AFGPM0888K1ZY',
  'Consignor Name & Address:',
  'RBQ ENTERPRISES',
  'STATE CODE: 27',
  'GSTIN',
  'QUANTITY',
  ': 27PPEPS9516F1Z6',
  'RATE',
  'TAXABLE VALUE',
  '4821',
  '1',
  'LABEL',
  'BUGSEAL Labels as per approved batch numbers for 2170',
  '2170',
  '20.00',
  '43400.00',
  'TOTAL INVOICE AMOUNT IN WORDS',
  'Rupees FiftyOne Thousand Two Hundred Twelve Only',
  'Less Discount',
  'Total Amount Before Tax',
  'Total After Discount',
  'Add: SGST',
  'Add: CGST',
  'Add: IGST',
  'Total Tax Amount GST',
  'Transport Charges',
  '1) Payment to be made by account payee cheque in favour of "RBQ ENTERPRISES"',
  '4 working days from the date of recd. date. No changes will be entertained thereafter.',
  'Total Invoice Amount After GST Tax',
  'ROUND OFF',
  'SALES ROUNDOFF',
  '43,400.00 0.00',
  '43,400.00',
  '9%',
  '3,906.00',
  '9%',
  '3,906.00',
  '7,812.00',
  '51,212.00',
  '0.00 51,212.00',
  'THIS IS COMPUTERIZED GENERATED INVOICE',
].join('\n');

test('RBQ photo: takes the seller gstin, never our own', () => {
  expect(ctx.parseBill(RBQ_OCR).gstin).toBe('27PPEPS9516F1Z6');
});

test('RBQ photo: supplier is the company, not a scan-edge artifact', () => {
  expect(ctx.parseBill(RBQ_OCR).supplier).toBe('RBQ ENTERPRISES');
});

test('RBQ photo: invoice number found even though it PRECEDES its label', () => {
  expect(ctx.parseBill(RBQ_OCR).invoiceNo).toBe('RBQ/2026-27/142');
});

test('RBQ photo: amount is the largest total in the trailing figure block', () => {
  expect(ctx.parseBill(RBQ_OCR).amount).toBe(51212);
});

test('RBQ photo: bare 9% + 9% is recognised as an 18% intra-state bill', () => {
  // OCR detached every rate from its "Add: SGST"/"Add: CGST" label.
  expect(ctx.parseBill(RBQ_OCR).gstPct).toBe(18);
});

test('mixed percentages are refused rather than guessed', () => {
  // 9% and 6% cannot be a CGST/SGST pair — better null than a wrong tax slab.
  expect(ctx.parseBill('Total 1,000.00\nfoo 9%\nbar 6%')).toHaveProperty('gstPct', null);
});

// Shubh Propack invoice (clean digital screenshot). Two traps this bill adds:
// OUR gstin appears TWICE (Bill To + Ship To), and a "Sub Total" sits below the
// real "Total" — taking the wrong one under-posts the bill by the tax amount.
const SHUBH = [
  'SHUBH PROPACK PRIVATE LIMITED',
  'Above SBI Bank, Shilaj Ahmedabad, Gujarat-380059,India',
  'GSTIN : 24ABECS3222L1ZF',
  'Phone : 9638949869 PAN:ABECS3222L IEC:ABECS3222L',
  'TAX INVOICE',
  'Invoice# INV-2627/0298',
  'Invoice Date',
  ': 06/07/2026',
  'Place Of Supply',
  ': Maharashtra (27)',
  'Bill To',
  'Ship To',
  'PACK MASTERS',
  'Mumbai- 400701',
  'GSTIN : 27AFGPM0888K1ZY',
  'Phone : 9167155573',
  'GSTIN : 27AFGPM0888K1ZY',
  'Phone : 9167155573',
  '1  28mm Black Trigger Pumps',
  'TS0028B03',
  '96161020',
  '7,500.00',
  '7.50',
  '10,125.00',
  '56,250.00',
  'Total In Words',
  'Indian Rupee Sixty-Six Thousand Three Hundred Seventy-Five Only',
  'Sub Total',
  '56,250.00',
  'IGST18 (18%)',
  '10,125.00',
  'Total',
  '66,375.00',
].join('\n');

test('Shubh: seller gstin wins over OUR gstin appearing twice', () => {
  expect(ctx.parseBill(SHUBH).gstin).toBe('24ABECS3222L1ZF');
});

test('Shubh: Total beats Sub Total (under-posting is the costly error)', () => {
  expect(ctx.parseBill(SHUBH).amount).toBe(66375);
});

// VERBATIM Drive OCR of the Shubh screenshot. The logo splits across two lines
// ("SHUBH" / "PROPACK PVT. LTD.") ABOVE the real company name, so a
// first-qualifying-line read returns the logo fragment.
const SHUBH_OCR = [
  '________________',
  '',
  'SHUBH',
  'PROPACK PVT. LTD.',
  'Invoice Date',
  'Terms',
  'e-Way Bill#',
  'Bill To',
  'PACK MASTERS',
  'SHUBH PROPACK PRIVATE LIMITED',
  'FF/6 A-Square, Kaveri Sangam, Near Shilaj Circle, Above SBI Bank, Shilaj Ahmedabad, Gujarat-380059,India GSTIN 24ABECS3222L1ZF',
  'Phone: 9638949869 PAN:ABECS3222L IEC:ABECS3222L',
  ': 06/07/2026',
  'GSTIN 27AFGPM0888K1ZY',
  'TAX INVOICE',
  'Invoice# INV-2627/0298',
  'GSTIN 27AFGPM0888K1ZY',
  'Sub Total IGST18 (18%)',
  '56,250.00',
  '10,125.00',
  'Total',
  '66,375.00',
].join('\n');

test('Shubh OCR: supplier is the full legal name, not the split logo text', () => {
  expect(ctx.parseBill(SHUBH_OCR).supplier).toBe('SHUBH PROPACK PRIVATE LIMITED');
});

test('Shubh OCR: the other four fields survive the real OCR', () => {
  const b = ctx.parseBill(SHUBH_OCR);
  expect(b.gstin).toBe('24ABECS3222L1ZF');
  expect(b.invoiceNo).toBe('INV-2627/0298');
  expect(b.amount).toBe(66375);
  expect(b.gstPct).toBe(18);
});

test('Shubh: supplier, invoice number and IGST rate', () => {
  const b = ctx.parseBill(SHUBH);
  expect(b.supplier).toBe('SHUBH PROPACK PRIVATE LIMITED');
  expect(b.invoiceNo).toBe('INV-2627/0298');
  expect(b.gstPct).toBe(18);
});

test('Shubh: Gujarat seller to Maharashtra buyer is inter-state (IGST)', () => {
  expect(ctx.interStateFrom(ctx.parseBill(SHUBH).gstin.slice(0, 2))).toBe(true);
});

// VERBATIM Drive OCR of two Tally e-invoices. Tally prints the grand total in
// the ITEM table ("₹ 12,272.000") with no "Total:" label beside it, while the
// trailing HSN summary repeats only the taxable value and the tax — so the
// trailing-block fallback picks the TAXABLE VALUE and under-posts the bill.
const RAJKAMAL_OCR = [
  '________________',
  '',
  'TAX INVOICE',
  '(ORIGINAL FOR RECIPIENT)',
  'IRN',
  ': fe7eb3b657b9464da62e0025a4705a3574415114-',
  'Ack No. : 122632339952283',
  'e-Invoice',
  'RAJKAMAL BAR-SCAN SYSTEMS PVT. LTD. A-17, GALA NO.03, PRITESH COMPLEX, OWALI VILLAGE, DAPODA ROAD, BHIWANDI, MAHARASHTRA-421302 Mob No.+919321868705',
  'Mr.Manesh Shinde',
  'GSTIN/UIN: 27AAACR6721N1Z2',
  'State Name: Maharashtra, Code: 27 CIN: U86202MH1997PTC107776',
  'E-Mail: warehouse@rajkamalbarscan.com Buyer (Bill to)',
  'PACK MASTERS',
  'GSTIN/UIN',
  '27AFGPM0888K1ZY',
  'Invoice No.',
  'RBLB/0247/26-27 Delivery Note',
  'CGST @ 9.00% -OUTPUT SGST @ 9.00% -OUTPUT',
  '10,400.000',
  '9% 9%',
  '936.000 936.000',
  '20,000.000 no',
  '12,272.000',
  'E.&O.E',
  'CGST',
  'Total 10,400.000',
  'Taxable Value Rate Amount Rate Amount Tax Amount 10,400.000 9% 936.000 9% 936.000 1,872.000 936.000 936.000',
  'Total',
  '1,872.000',
  'Total',
  'INR Twelve Thousand Two Hundred Seventy Two Only',
].join('\n');

const RUKSON_OCR = [
  '________________',
  '',
  '222231 101709',
  'TAX INVOICE CUM DELIVERY CHALLAN (ORIGINAL FOR RECIPIENT)',
  'e-Invoice',
  'IRN',
  'RP',
  'Rukson Packaging Pvt.Ltd R-273, TTC Industrial Area Rabale Navi Mumbai 400701 GSTIN/UIN: 27AAACJ4374M1Z7 State Name: Maharashtra, Code: 27 CIN: U28990MH1986PTC040643 E-Mail: accounts@rukson.in',
  'Consignee (Ship to)',
  'Pack Masters',
  'GSTIN/UIN',
  'Pack Masters',
  '27AFGPM0888K1ZY',
  'Buyer (Bill to)',
  'GSTIN/UIN',
  ':27AFGPM0888K1ZY',
  'Invoice No. 701/26-27 Delivery Note',
  '48192020 5,820.00 Nos',
  '12.00 Nos',
  '69,840.00',
  'CGST SGST',
  '1,746.00 1,746.00',
  'Amount Chargeable (in words)',
  'Total',
  'Rs. Seventy Three Thousand Three Hundred Thirty Two Only',
  'Taxable Value',
  'Total',
  'Rate 69,840.00 2.50% 69,840.00',
  '5,820.00 Nos',
  '73,332.00 E.&O.E',
  'Amount Rate 1,746.00 2.50% 1,746.00',
  '3,492.00 3,492.00',
].join('\n');

test('Tally: grand total wins over the taxable value (under-posting is costly)', () => {
  expect(ctx.parseBill(RAJKAMAL_OCR).amount).toBe(12272);
  expect(ctx.parseBill(RUKSON_OCR).amount).toBe(73332);
});

test('Tally: invoice number is not OUR gstin', () => {
  expect(ctx.parseBill(RAJKAMAL_OCR).invoiceNo).toBe('RBLB/0247/26-27');
  expect(ctx.parseBill(RUKSON_OCR).invoiceNo).toBe('701/26-27');
});

test('Tally: supplier is the vendor, not a document banner', () => {
  // "(ORIGINAL FOR RECIPIENT)" and "e-Invoice" used to win here.
  expect(ctx.parseBill(RAJKAMAL_OCR).supplier).toBe('RAJKAMAL BAR-SCAN SYSTEMS PVT. LTD.');
  expect(ctx.parseBill(RUKSON_OCR).supplier).toBe('Rukson Packaging Pvt.Ltd');
});

test('supplier name is cut after the LAST legal suffix, not the first', () => {
  // "Rukson Packaging Pvt.Ltd" holds two matches; cutting at "Packaging"
  // would drop the legal form and weaken any name-based lookup.
  expect(ctx._trimAfterEntitySuffix_('Rukson Packaging Pvt.Ltd R-273, TTC Area'))
    .toBe('Rukson Packaging Pvt.Ltd');
});

test('Tally: seller gstin, and the rate comes from the CGST/SGST lines', () => {
  expect(ctx.parseBill(RAJKAMAL_OCR).gstin).toBe('27AAACR6721N1Z2');
  expect(ctx.parseBill(RAJKAMAL_OCR).gstPct).toBe(18);
  expect(ctx.parseBill(RUKSON_OCR).gstin).toBe('27AAACJ4374M1Z7');
});

test('parseBill degrades gracefully on sparse text', () => {
  const b = ctx.parseBill('handwritten note');
  expect(b.gstin).toBe(null);
  expect(b.supplier).toBe('handwritten note');
});
