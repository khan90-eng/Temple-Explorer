# Turning on automatic saving

Right now every finished session **downloads as a file** to whatever computer
the participant used. That always works, even with no internet. But collecting
files off a dozen machines is a nuisance, so this sets up the other half:
every session also lands as a **row in one Google Sheet that you own**, the
moment the participant clicks Finish.

## What this actually is

The walkthrough is just files — there is no server behind it, and a web page
on its own cannot write to a spreadsheet. So we borrow one from Google.

A Google Sheet can have a small program attached to it (Google calls this
Apps Script). You can publish that program as a **web address**. Anything sent
to that address gets handed to your program, which writes a row in your sheet.

So the chain is: participant clicks Finish → the walkthrough sends the session
data to that web address → your program writes it into your sheet. Free, no
account needed by the participant, and nobody but you can read the sheet.

Setting it up is about five minutes and you only do it once.

## Step 1 — make the sheet

1. Go to <https://sheets.new> and give it a name, e.g. *Temple Explorer sessions*.

## Step 2 — add the program

1. In that sheet: **Extensions → Apps Script**.
2. Delete whatever is in the editor and paste all of this in:

```javascript
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);                     // two people finishing at once
  try {
    var book  = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = book.getSheetByName('Sessions') || book.insertSheet('Sessions');

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'received', 'started', 'role', 'student id',
        'duration s', 'active s', 'end reason',
        'furthest z', 'reached sanctuary', 'walked m',
        'scrolls opened', 'unique scrolls', 'reading s', 'torch lit',
        'approach s', 'court s', 'hypostyle s', 'inner court s', 'sanctuary s',
        'seen plan before', 'visited temple', 'understands sequence',
        'light mattered', 'torch mattered', 'plan vs walking', 'movement ease',
        'beyond the plan', 'comments',
        'fps avg', 'fps min', 'screen', 'browser', 'full record'
      ]);
      sheet.setFrozenRows(1);
    }

    var d = JSON.parse(e.postData.contents);
    var p = d.participant || {};
    var s = d.summary || {};
    var z = d.zoneSeconds || {};
    var v = d.device || {};
    var q = d.questionnaire || {};

    sheet.appendRow([
      new Date(), d.session.startedAt, p.role || '', p.studentId || '',
      d.session.durationSec, d.session.activeSec, d.session.endReason,
      s.furthestZ, s.reachedSanctuary, s.distanceWalkedM,
      s.scrollsOpened, s.uniqueScrollsOpened, s.scrollReadSec, s.torchLitCount,
      z['approach'], z['court'], z['hypostyle'], z['inner-court'], z['sanctuary'],
      q.seen_plan_before, q.visited_temple, q.understands_sequence,
      q.light_mattered, q.torch_mattered, q.plan_vs_walking, q.movement_ease,
      q.beyond_the_plan, q.comments,
      v.fpsAvg, v.fpsMin, v.screen, v.userAgent,
      JSON.stringify(d)
    ]);

    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}
```

3. Save it (the disk icon).

## Step 3 — publish it and copy the address

1. **Deploy → New deployment**.
2. Click the gear next to *Select type* and choose **Web app**.
3. Set:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
4. **Deploy**. Google will ask you to authorise it — that is it asking your
   permission to let your own script write to your own sheet. Accept.
5. Copy the **Web app URL** it gives you. It looks like
   `https://script.google.com/macros/s/AKfycb..../exec`

"Anyone" sounds alarming but only means *anyone who knows this address can
send data to it*. Nobody can read your sheet through it, and the address is
not published anywhere.

## Step 4 — tell the walkthrough about it

Open `study.js` and put the address in the line near the top:

```javascript
export const ENDPOINT = 'https://script.google.com/macros/s/AKfycb..../exec';
```

Then bump `study.js?v=1` to `?v=2` in `main.js` (the cache-busting rule — the
browser will keep the old copy otherwise).

## Step 5 — test it once

Run the walkthrough, sign in as "Other", walk for twenty seconds, press Esc,
click **Finish and save my session**, answer a question or two and press
**Submit and finish**. A row should appear in your sheet within a few seconds,
and a `.json` file should land in your Downloads. Do this before the real
session, not on the day.

## If a row doesn't appear

The walkthrough cannot tell whether the send worked — Google's reply is
blocked from being read by the browser for security reasons, which is normal
and not a fault. The file download is your guarantee, which is exactly why it
always happens too. Things to check, in order:

- Did you redeploy after editing the script? Edits do **not** go live until
  **Deploy → Manage deployments → edit → Version: New version → Deploy**.
- Is *Who has access* set to **Anyone** and not *Anyone with Google account*?
- Is the address in `study.js` the one ending in `/exec` (not `/dev`)?
- Did you bump the `?v=` number after editing `study.js`?

## What gets recorded

Everything is in the downloaded file, and the important parts are also spread
across the sheet's columns:

- **Who** — student or other, and the student ID if they gave one. No names,
  no email. The consent wording and the moment it was ticked are stored with
  the record.
- **Where they went** — position twice a second, which totals up into seconds
  spent in the approach, court, hypostyle hall, inner court and sanctuary, and
  can be drawn as a path over your plan.
- **What they read** — which scrolls they opened, in what order, and for how
  long each stayed open.
- **The torch** — every time it was lit or went out, and where. This is the
  behavioural test of the light argument: do people reach for light exactly
  where the plan tells you nothing?
- **Their answers** — the nine questionnaire questions they are asked at the
  end, each in its own column, sitting on the same row as their behaviour. The
  wording lives in `questionnaire.js` and is a draft to settle with Prof.
  Joarder; if you change a question's `id` there, change the matching column
  in the script above too.
- **Conditions** — how long, how far, whether they reached the sanctuary,
  frame rate, screen size, browser. This is what lets you state the conditions
  the study actually ran under.

One session is about 6 KB. A hundred participants is under a megabyte.
