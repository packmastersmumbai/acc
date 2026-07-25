const { test, expect } = require('@playwright/test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// buildContactBody is a pure function — verify the create shape WITHOUT any live
// write (user constraint). The live create is exercised only by the user.
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/Contacts.js'), 'utf8'), ctx);

test('buildContactBody: GST vendor gets business_gst, pan, place_of_contact', () => {
  const b = ctx.buildContactBody({ name: 'Yash Poly Plast', gstin: '27AABFY9773F1ZN' });
  expect(b.contact_type).toBe('vendor');
  expect(b.gst_treatment).toBe('business_gst');
  expect(b.gst_no).toBe('27AABFY9773F1ZN');
  expect(b.pan_no).toBe('AABFY9773F');
  expect(b.place_of_contact).toBe('MH'); // state 27 → Maharashtra
  expect(b.currency_code).toBe('INR');
});

test('buildContactBody: out-of-state GSTIN maps place_of_contact correctly', () => {
  const b = ctx.buildContactBody({ name: 'Acme Haryana', gstin: '06AABCA1111A1Z5' });
  expect(b.place_of_contact).toBe('HR'); // state 06 → Haryana
});

test('buildContactBody: no GSTIN → consumer treatment, no pan', () => {
  const b = ctx.buildContactBody({ name: 'Cash Vendor' });
  expect(b.gst_treatment).toBe('consumer');
  expect(b.gst_no).toBeUndefined();
  expect(b.pan_no).toBeUndefined();
});

test('buildContactBody: customer type + contact person from phone/email', () => {
  const b = ctx.buildContactBody({
    name: 'Yara Fertilisers', gstin: '27AABFY9773F1ZN',
    contactType: 'customer', phone: '9876500001', email: 'ap@yara.com',
  });
  expect(b.contact_type).toBe('customer');
  expect(b.contact_persons[0].mobile).toBe('9876500001');
  expect(b.contact_persons[0].email).toBe('ap@yara.com');
  expect(b.contact_persons[0].is_primary_contact).toBe(true);
});
