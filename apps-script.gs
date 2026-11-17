/**
 * BGI anonymous event log → this Google Sheet.
 *
 * Setup (5 min):
 * 1. Make a Google Sheet. Extensions → Apps Script. Paste this whole file.
 * 2. Deploy → New deployment → type "Web app".
 *    Execute as: Me.  Who has access: Anyone.
 * 3. Copy the web-app URL into config.js → logUrl (and bump the ?v= tag in index.html).
 * 4. Back here, pick "makeSummaryTabs" in the function menu and press ▶ Run once.
 *
 * Each row: time, event, src (which card batch), zone (rough area), detail.
 * zone is a compass direction + distance band from the garden, e.g. "NE · ½–1 mi".
 * The site never sends coordinates, names or device IDs.
 */
var ALLOWED = ['scan', 'seek_start', 'location', 'arrow_shown', 'map_drawn', 'route_shown', 'opened_maps',
  'landmarks_view', 'near_gate', 'gate_scan', 'visit', 'rating', 'remind_me'];

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (ALLOWED.indexOf(p.e) < 0) return out_('ignored');
    var detail = {};
    Object.keys(p).forEach(function (k) {
      if (['e', 'src', 't', 'zone'].indexOf(k) < 0) detail[k] = String(p[k]).slice(0, 60);
    });
    var sheet = SpreadsheetApp.getActive().getSheetByName('events') || SpreadsheetApp.getActive().insertSheet('events');
    if (sheet.getLastRow() === 0) sheet.appendRow(['received', 'event', 'src', 'zone', 'detail']);
    sheet.appendRow([new Date(), p.e, String(p.src || 'direct').slice(0, 40), String(p.zone || '').slice(0, 20), JSON.stringify(detail)]);
    return out_('ok');
  } catch (err) {
    return out_('error');
  }
}

function out_(s) { return ContentService.createTextOutput(s); }

/**
 * Run once. Adds two tabs that update by themselves:
 *  funnel — per card spot: scans → tapped "Show me the way" → map drawn → near gate → stamp visits
 *  zones  — where maps were drawn from (direction + distance), most first
 */
function makeSummaryTabs() {
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('events')) ss.insertSheet('events').appendRow(['received', 'event', 'src', 'zone', 'detail']);

  var f = ss.getSheetByName('funnel') || ss.insertSheet('funnel');
  f.clear();
  f.getRange('A1:G1').setValues([['card spot (src)', 'scans', 'tapped Show me the way', 'maps drawn', 'near the entrance', 'stamp visits (came from this card)', 'quiet ratings']]);
  f.getRange('A2').setFormula('=UNIQUE(FILTER(events!C2:C, events!C2:C<>""))');
  var col = function (c, ev) { f.getRange(c + '2').setFormula('=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(events!C:C,A2:A,events!B:B,"' + ev + '")))'); };
  col('B', 'scan'); col('C', 'seek_start'); col('D', 'map_drawn'); col('E', 'near_gate'); col('G', 'rating');
  f.getRange('F2').setFormula('=ARRAYFORMULA(IF(A2:A="",,COUNTIFS(events!B:B,"visit",events!E:E,"*\\"first_src\\":\\""&A2:A&"\\"*")))');
  f.setFrozenRows(1);

  var z = ss.getSheetByName('zones') || ss.insertSheet('zones');
  z.clear();
  z.getRange('A1').setFormula("=QUERY(events!A:E, \"select D, count(B) where B = 'map_drawn' and D <> '' group by D order by count(B) desc label D 'where from (direction · distance)', count(B) 'maps drawn'\", 1)");
  z.getRange('D1').setFormula("=QUERY(events!A:E, \"select C, D, count(B) where B = 'map_drawn' and D <> '' group by C, D order by C, count(B) desc label C 'card spot', D 'where from', count(B) 'maps drawn'\", 1)");
  z.setFrozenRows(1);
}
