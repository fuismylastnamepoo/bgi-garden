/**
 * BGI anonymous event log → this Google Sheet.
 *
 * Setup (5 min):
 * 1. Make a Google Sheet. Extensions → Apps Script. Paste this whole file.
 * 2. Deploy → New deployment → type "Web app".
 *    Execute as: Me.  Who has access: Anyone.
 * 3. Copy the web-app URL into config.js → logUrl.
 *
 * Each row: time, event, src (which card batch), detail.
 * The site never sends coordinates, names or device IDs.
 */
var ALLOWED = ['scan', 'location', 'route_shown', 'opened_maps', 'landmarks_view', 'near_gate', 'gate_scan', 'visit', 'rating', 'remind_me'];

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (ALLOWED.indexOf(p.e) < 0) return out_('ignored');
    var detail = {};
    Object.keys(p).forEach(function (k) {
      if (['e', 'src', 't'].indexOf(k) < 0) detail[k] = String(p[k]).slice(0, 60);
    });
    var sheet = SpreadsheetApp.getActive().getSheetByName('events') || SpreadsheetApp.getActive().insertSheet('events');
    if (sheet.getLastRow() === 0) sheet.appendRow(['received', 'event', 'src', 'detail']);
    sheet.appendRow([new Date(), p.e, String(p.src || 'direct').slice(0, 40), JSON.stringify(detail)]);
    return out_('ok');
  } catch (err) {
    return out_('error');
  }
}

function out_(s) { return ContentService.createTextOutput(s); }

/**
 * Optional: run this once (▶ in the editor) to add a "funnel" tab that counts
 * scans → routes → near gate → visits for each card batch.
 */
function makeFunnel() {
  var ss = SpreadsheetApp.getActive();
  var f = ss.getSheetByName('funnel') || ss.insertSheet('funnel');
  f.clear();
  f.getRange('A1:F1').setValues([['src', 'scans', 'routes shown', 'near gate', 'visits (first src)', 'ratings']]);
  f.getRange('A2').setFormula('=UNIQUE(FILTER(events!C2:C, events!C2:C<>""))');
  f.getRange('B2').setFormula('=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(events!C:C,A2:A,events!B:B,"scan")))');
  f.getRange('C2').setFormula('=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(events!C:C,A2:A,events!B:B,"route_shown")))');
  f.getRange('D2').setFormula('=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(events!C:C,A2:A,events!B:B,"near_gate")))');
  f.getRange('E2').setFormula('=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(events!B:B,"visit",events!D:D,"*\\"first_src\\":\\""&A2:A&"\\"*")))');
  f.getRange('F2').setFormula('=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(events!C:C,A2:A,events!B:B,"rating")))');
}
