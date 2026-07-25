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

test('parseBill degrades gracefully on sparse text', () => {
  const b = ctx.parseBill('handwritten note');
  expect(b.gstin).toBe(null);
  expect(b.supplier).toBe('handwritten note');
});
