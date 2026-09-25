# Setting up the study server

Sessions are now saved to a small Express server (`server.js`) that keeps them
in a Redis database. Nothing downloads unless the save fails.

The server also serves the walkthrough itself, from the same address. That
matters: because the page and the API share an origin, the browser can read
the server's reply, so a participant is told truthfully whether their session
saved. The old arrangement could only hope.

## Before anything: Render must run this as a Web Service

Right now the site is a Render **Static Site**, which only hands out files and
cannot run `server.js`. It has to become a **Web Service** instead.

In the Render dashboard, create a new **Web Service** from the
`khan90-eng/Temple-Explorer` repo with:

| Setting | Value |
|---|---|
| Language / runtime | Node |
| Build command | `npm install` |
| Start command | `node server.js` |
| Instance type | Free is fine to begin with |

Delete the old static site afterwards, or leave it — but note the walkthrough
must be used at the **Web Service** address from now on, because the static
one has no database behind it.

## Step 1 — a Redis database

**Do not use Render's free Key Value instance for real study data.** Render's
own documentation says data persistence is not available on the free tier:
it lives in memory only and is wiped on every restart and every redeploy. It
is built for caches, where losing everything is merely inconvenient. Losing a
week of student sessions the first time Render restarts the instance is a
different matter.

Two options that do keep your data:

**Upstash (free, and what I would use).** Go to <https://upstash.com>, create
a Redis database, pick a region near you, and copy the connection string —
the one that starts `rediss://`. The free plan gives 256 MB and 500,000
commands a month. A session costs two or three commands, so that is far more
than a study will ever use.

**Render Key Value on a paid instance.** Same dashboard as everything else,
and the `REDIS_URL` is wired up for you, but it costs money each month.
Choose the `noeviction` policy if you go this way, so it never quietly throws
records away to free space.

## Step 2 — two environment variables

In the Web Service, open **Environment** and add:

| Key | Value |
|---|---|
| `REDIS_URL` | the connection string from step 1 |
| `ADMIN_TOKEN` | a long random string you invent — this is the password for reading the data back |

Make `ADMIN_TOKEN` genuinely random, not a word. Without it set, the reading
endpoints refuse to work at all, which is deliberate: it is better for them to
be switched off than to serve participant data to anyone who guesses the path.

Keep the token out of the repo. It belongs in Render's Environment panel only.

## Step 3 — check the wiring

Open `https://your-service.onrender.com/api/health`. You want:

```json
{"ok":true,"database":"up","adminEnabled":true}
```

If `database` says `down`, the `REDIS_URL` is wrong or the database is
unreachable. If `adminEnabled` is false, `ADMIN_TOKEN` is not set.

Then do one real run: sign in as "Other", walk a little, press Esc, Finish,
answer a question, Submit. You should see **"Thank you — your session has
been saved."** If you instead see "Saved on this computer only", the save
failed and the page will offer the file; check `/api/health`.

## Step 4 — getting the data out

Three addresses, all needing your token:

```
https://your-service.onrender.com/api/sessions?token=YOUR_TOKEN
https://your-service.onrender.com/api/export.csv?token=YOUR_TOKEN
https://your-service.onrender.com/api/export.json?token=YOUR_TOKEN
```

- **`/api/sessions`** — a quick look at who has been through, in the browser.
- **`/api/export.csv`** — one row per session, opens straight in Excel. This
  is the one for analysis: role, student ID, time in each zone, distance,
  scrolls read, torch use, and every questionnaire answer in its own column.
- **`/api/export.json`** — everything, including the position samples the path
  drawings need. This is the archive; keep a copy of it somewhere safe.

Export after every session day. Treat the database as working storage, not as
the only copy of your research.

## Things worth knowing

**The free service sleeps.** A free Render Web Service spins down after 15
minutes with no traffic, and the next visitor waits about a minute while it
wakes. Before a class session, open the site yourself a couple of minutes
early so it is already awake. If that is too fragile on the day, the paid
instance does not sleep.

**If the database is unreachable**, the walkthrough still runs normally and
the participant is told plainly, then offered their session as a file to hand
over. Nothing is silently lost.

**If a participant closes the tab** without finishing, the session so far is
sent anyway, marked `tab-closed` and with no questionnaire answers. That is
why the Finish button and the sanctuary prompt matter.

**What is stored about a person**: role, an optional student ID, and the
moment they ticked consent along with the wording they agreed to. No names, no
email addresses.
