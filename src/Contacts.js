/**
 * Contacts: match an existing party by GSTIN, or build a create body.
 * Create shape verified live via _contact_schema.py: gst_treatment 'business_gst',
 * place_of_contact is the 2-letter state (e.g. 'MH'), pan_no derivable from GSTIN,
 * nested billing_address + contact_persons. Depends on zohoGet/zohoPost.
 *
 * WRITE PATH (createContact) is NOT exercised against live Zoho during dev
 * (user constraint). Only the READ side (matchContactByGstin) is contract-tested.
 */

// GSTIN numeric state code → Zoho place_of_contact 2-letter code.
var GST_STATE_CODE = {
  '01':'JK','02':'HP','03':'PB','04':'CH','05':'UT','06':'HR','07':'DL','08':'RJ',
  '09':'UP','10':'BR','11':'SK','12':'AR','13':'NL','14':'MN','15':'MZ','16':'TR',
  '17':'ML','18':'AS','19':'WB','20':'JH','21':'OD','22':'CG','23':'MP','24':'GJ',
  '26':'DN','27':'MH','29':'KA','30':'GA','31':'LD','32':'KL','33':'TN','34':'PY',
  '35':'AN','36':'TS','37':'AP','38':'LA'
};

function placeOfContact_(stateCode) { return GST_STATE_CODE[stateCode] || 'MH'; }

/**
 * Find a contact whose gst_no matches (case-insensitive), paging the list.
 * The LIST endpoint carries gst_no (verified) — no per-contact fetch needed.
 * @return {{contact_id, contact_name, contact_type, gst_no, outstanding}|null}
 */
function matchContactByGstin(gstin) {
  if (!gstin) return null;
  var want = String(gstin).toUpperCase();
  var page = 1;
  while (true) {
    var r = zohoGet('contacts', { per_page: 200, page: page });
    var list = r.contacts || [];
    for (var i = 0; i < list.length; i++) {
      if ((list[i].gst_no || '').toUpperCase() === want) {
        var c = list[i];
        return {
          contact_id: c.contact_id,
          contact_name: c.contact_name,
          contact_type: c.contact_type,
          gst_no: c.gst_no,
          outstanding: parseFloat(c.outstanding_payable_amount || 0) +
                       parseFloat(c.outstanding_receivable_amount || 0)
        };
      }
    }
    if (!r.page_context || !r.page_context.has_more_page) break;
    page++;
  }
  return null;
}

/**
 * Build the create-contact request body from parsed fields, then POST it.
 * obj: {name, gstin, contactType?, phone?, email?, address?, city?, zip?, person?}
 * contactType defaults to 'vendor' (bill capture is the primary flow).
 */
function buildContactBody(obj) {
  var stateCode = (obj.gstin || '').slice(0, 2);
  var pan = (obj.gstin || '').slice(2, 12) || undefined;
  var body = {
    contact_name: obj.name,
    company_name: obj.name,
    contact_type: obj.contactType || 'vendor',
    customer_sub_type: 'business',
    currency_code: 'INR'
  };
  if (obj.gstin) {
    body.gst_treatment = 'business_gst';
    body.gst_no = obj.gstin;
    body.pan_no = pan;
    body.place_of_contact = placeOfContact_(stateCode);
  } else {
    body.gst_treatment = 'consumer';
  }
  if (obj.address || obj.city || obj.zip || obj.phone) {
    body.billing_address = {
      address: obj.address || '', city: obj.city || '',
      zip: obj.zip || '', state_code: stateCode || '',
      country: 'India', phone: obj.phone || ''
    };
  }
  if (obj.person || obj.phone || obj.email) {
    body.contact_persons = [{
      first_name: (obj.person || obj.name || '').split(' ')[0] || obj.name,
      last_name: '', email: obj.email || '',
      mobile: obj.phone || '', is_primary_contact: true
    }];
  }
  return body;
}

function createContact(obj) {
  var res = zohoPost('contacts', buildContactBody(obj));
  return { success: true, contact_id: res.contact.contact_id, contact_name: res.contact.contact_name };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildContactBody: buildContactBody, placeOfContact_: placeOfContact_ };
}
