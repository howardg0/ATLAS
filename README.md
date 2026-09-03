# ATLAS — Training Log

Offline-first strength training log. A static Progressive Web App: no build step, no framework, no dependencies. Six-week periodised blocks, double progression, a 130-lift encyclopedia with muscle maps, week-by-week progression readouts and coaching.

## Layout

```
index.html        markup for every screen + service worker registration
css/atlas.css     all styles (embedded fonts, tokens, screens)
js/config.js      deployment config (Google OAuth client ID, optional)
js/data.js        programme template, block plan presets, lift encyclopedia, substitution table, defaults
js/core.js        pure logic: migration, rep ranges, scoring, plates, supersets, block plans, sync decision
js/share.js       session share card (canvas → PNG → share sheet)
js/drive.js       Google Drive sync (appDataFolder)
js/app.js         state, storage, navigation, rendering, session flow
sw.js             service worker (offline cache)
manifest.json     PWA manifest
tests/            node:test suites: core logic, encyclopedia integrity, release consistency
```

Scripts are classic `<script>` tags sharing one global scope, loaded in the order config → data → core → share → drive → app. `js/data.js` and `js/core.js` also export via `module.exports` when run under Node so the tests can `require()` them.

## Running

Any static file server works. For example:

```bash
python -m http.server 8000
```

The service worker only registers over **HTTPS** (or `localhost`), so offline caching and the "update ready" pill need a real host such as GitHub Pages.

## Tests

Requires Node 18 or newer. No install step.

```bash
npm test
```

- `tests/core.test.js` covers the pure functions in `js/core.js`: rep-range parsing, Epley e1RM, per-side tonnage, per-lift overrides, plate loading, superset pairing, slot remapping (the code that keeps history attached to the right lift when the programme is edited), stall detection and save migration.
- `tests/data.test.js` validates the lift encyclopedia: groups, patterns, equipment, muscle keys, cue counts, and that every substitution and default-programme entry points at a real lift.
- `tests/version.test.js` checks that the three version stamps agree and that every file the service worker precaches exists.

## Releasing a new version

Three stamps must match, and the test suite fails if they do not:

1. `CACHE` in `sw.js` (for example `atlas-v6.1`)
2. `APP_VERSION` in `js/app.js`
3. the `?v=` query on the css and js tags in `index.html`

The page itself is fetched network-first, so a new release is picked up on the next open. Assets are cache-first and matched on their exact versioned URL, so a new `index.html` always pulls matching css and js rather than a stale mix.

## Google Drive sync

Drive holds the master copy of the log in the app's private app-data folder (invisible in your Drive UI, removable from Drive → Settings → Manage apps). The phone keeps a working cache so logging never waits on a network. Sync runs on open, after each finished session, when the app goes to the background, when the network comes back, and from Settings → Sync now. The newer copy wins by timestamp; a phone with nothing on it always adopts Drive; on first connect you choose which copy to keep.

You need a Google OAuth client ID once. It is public, so committing it is fine.

1. Go to https://console.cloud.google.com and create a project (any name).
2. APIs & Services → Library → enable **Google Drive API**.
3. APIs & Services → OAuth consent screen → External → fill in the app name and your email. Add the scope `.../auth/drive.appdata`. Under Test users add your own Google account. Leave it in Testing; you are the only user.
4. Credentials → Create credentials → **OAuth client ID** → Web application. Under Authorised JavaScript origins add where ATLAS is served, for example `https://yourname.github.io`. No redirect URIs are needed.
5. Copy the client ID into `js/config.js` as `GOOGLE_CLIENT_ID`, or paste it into Settings → Sync on the phone.

Then Settings → Sync → Connect Google Drive. Google's sign-in popup appears once; after that tokens are refreshed silently while you stay signed in to Google. If Chrome blocks the silent refresh, the status line says so and Sync now reconnects.

## Data model

Everything lives in one object under the localStorage key `block-log-v2` (the key must never change) and is mirrored to IndexedDB for durability. `migrate()` in `js/core.js` upgrades any older save on load and on restore.

Key fields:

| Field | Purpose |
|---|---|
| `plan` | a block: `{name, weeks:[{phase, comp, acc, rir}]}` with 2 to 12 weeks; or open-ended: `{name, open:true, every, lightOffset, startDate, weeks:[hard, light]}` where weeks count up from `startDate` (Monday-based calendar weeks) forever |
| `programme` | editable copy of the default days; each exercise is `[name, repRange, isCompound, options?]` with options `{ss:1}` (superset with next) and `{sets:n}` (pinned set count) |
| `logs` | keyed `"week-day"`, each with `ex[slotIndex] = [sets]`; a set is `{kg, reps, t, name, uni?, timed?}` (for timed sets `reps` holds seconds) |
| `swaps` | per-slot substitutions for the current block |
| `archive` | previous blocks, each carrying its own programme, swaps and plan |
| `settings` | `bar`, `plates[]`, `rest{comp, acc, super}`, `theme` (dark, light or auto) |
| `lifts` | per-lift overrides keyed by name: `{inc, rest, uni, timed}` |
| `updatedAt`, `sync` | last local change and Drive bookkeeping (`enabled`, `clientId`, `fileId`, `lastSync`) |
| `notes` | free-text per lift |
| `seenIntro`, `hideInstall` | one-time UI flags for the first-run card and the install prompt |

Every set is stamped with the lift name (plus `uni: 1` when per side and `timed: 1` when measured in seconds) at the moment it is logged, so later swaps, programme edits or settings changes never rewrite history.

## Giving it to other people

The app is a public static site: anyone with the link gets their own independent copy. Their log lives in their browser and, if they connect it, their own Google Drive. Nothing is shared between users and nothing is stored on a server.

- **Android**: open the link in Chrome → menu → Install app.
- **iPhone**: open the link in Safari → Share → Add to Home Screen. iOS never prompts, so this step is manual.
- On first run they choose a starting point: ATLAS full body (3 days), Upper / Lower (4), Push / Pull / Legs (6), or Build my own. Settings → Start from a template switches later.
- Drive sync needs their Google account added under Test users on the OAuth consent screen while it is in Testing.

## Changelog

### 7.1.1
- Viewport scale locked again (`maximum-scale=1, user-scalable=no`): unlocking it in 7.1 let the page creep into a slight zoom on Android, which shrank the fixed dock. `touch-action: manipulation` stays.

### 7.1
- Plate bar is interactive: tap a plate size to add one to each side, tap a loaded plate to take it off. Plates carry IPF colours.
- Guide and Swap moved from the top-right of the lift header into the dock, in thumb reach.
- Rest veil shows the next set's target weight and reps large, offers "Peek at the cues" (or swipe down) which collapses it to a bar at the top with the clock; tap the bar or swipe up to expand, "I'm ready" still ends it.
- Toast: the whole pill triggers Undo, and a finger resting on it keeps it visible.
- Week swipes ignore the outer 32 px so the Android back gesture no longer flips the week.
- Sheets dismiss with a swipe down from the handle area.
- Tap targets: editor mini buttons and pills extend to 44 px+ hit areas without changing size; pips are 9 px.
- Appearance: True black option for OLED screens (`settings.oled`).

### 7.0
- Time-boxed sessions: on the session preview, "Short on time?" offers 30 / 45 / 60 minute budgets. Accessories are skipped from the end of the session backwards; compounds and lifts you have already started are never dropped. Skips live on that day's log entry (`logs[key].skip`), show struck through in the preview and session map, can be tapped to bring back, and the done screen lists them separately from "Not done".
- Nutrition guide (Settings → Help): a calculator (Mifflin-St Jeor, step-count activity, per-training-day allowance, goal shift) giving calories, protein, carbs and fat, plus plain-English guidance on rate of change, protein, carbs and fat, gaining, cutting and the basics. Inputs persist in `settings.nutri`.
- Fix: `migrate()` rebuilt `settings` from a fixed list of keys, so the reminder time was lost on every reload. Unknown settings keys are now preserved.
- Review fixes (data): deleting a set now splices it out instead of leaving a null hole that the next logged set overwrote; leaving a session with the system back gesture clears the live session (Drive downloads were deferred forever and the wake lock re-acquired on every foreground); the IndexedDB mirror is adopted when it is newer than localStorage, not only when localStorage is empty; a corrupt save no longer blanks the app (it is stashed under a sibling key and the app boots clean with a toast); `migrate()` repairs malformed programme/archive/logs shapes; `remapSlots` moves today-only swaps and time skips with their slot.
- Review fixes (logic): previous-session lookup falls back to the lift by name on any slot or day, so a template switch or reorder no longer resets the coach; open-plan streaks ignore the days before a mid-week start; block-plan streaks no longer change when you browse the week strip; next-set and Skip never land on a finished or time-skipped slot; log dates and the "new PR" window use local dates; the week strip clamps the selected week before drawing; coaching tip no longer prints "-Infinity kg" for empty slots.
- Service worker: page fetch races a 3 s timeout before serving the cached shell, page and precache fetches bypass the HTTP cache, and a failed asset fetch returns a network error rather than HTML.
- Drive: the file list is ordered newest-first and the file we last wrote is preferred; a deferred download no longer stamps "synced just now".
- Performance: `save()` serialises once and mirrors to IndexedDB at most every 0.8 s (flushed on hide/pagehide).
- Polish: long-press tolerates 8 px of finger movement; edit-set steppers have labels; long toasts truncate; day titles are escaped everywhere; Nutrition lights the Plan tab; `betterSet` and `sessionDuration` moved to core with tests.

### 6.11
- Swap sheet now has "Just today" (default) and "Permanently". A just-today swap lives on that session's log entry (`logs[key].once[exIdx]`), lists lifts sharing the same primary muscles, and leaves the plan and permanent swaps untouched. Sets are stamped with the lift actually done, as before.

### 6.10
- Programme editor: "Set reps for several lifts" applies one rep range to any selection of lifts (All / Compounds / Accessories shortcuts). Sets and other options are untouched.

### 6.9.1
- Fix: the "Logged / New PR" toast no longer overlaps the rest timer's ±15 s buttons; it drops to the bottom edge while the rest veil is showing.

### 6.9

- **Streaks** under the Home hero: session streak, week streak and percentage of planned sessions kept. Calendar-aware on open plans, so a session later today doesn't break the run.
- **Training reminders** as a calendar file: pick a time in Settings and the app builds one repeating weekly event per training day, with an alert, to add to Google Calendar or iOS Calendar. Chosen over web notifications because it works with the app closed and on iPhone.
- **Equipment filter chips** in the lift library and the exercise picker.
- **Report a problem** in Settings: shares or copies a report with the app version, phone, screen, theme, plan and the last five captured errors. `REPORT_URL` in `js/config.js` adds an "Open a GitHub issue" option.
- **Session map**: tapping a finished lift lists its sets to change or delete without leaving the session.

### 6.8

- **Muscle diagram rebuilt.** Two redrawn figures with gradient-shaded muscle bellies and striations sit on the faces of a 3D card: drag to spin, tap to flip, tilt follows your thumb, it snaps to the nearest face and sways gently when idle. Active muscles glow and pulse. The lift screen opens on whichever side the lift's primary muscles are on. Calves now show on the front figure too.

### 6.7

- **ATLAS Physique revised** after review: biceps cut to 12 direct sets on two days (Hammer, Reverse and Cable Curl dropped), rear delts up to 12 across three days, more vertical pulling with a new Wide-Grip Lat Pulldown lift and a third set of straight-arm pulldowns, Saturday arm work reduced to the overhead triceps extension so elbows get two days off.
- **Ramp-in weeks** for open-ended plans: the first N weeks (2 for Physique) run at about two-thirds of the sets, then full volume. Adjustable in the plan editor.

### 6.6

- **Open-ended plans.** A plan can be `open`: weeks are calendar weeks from a start date and never reset. A light week (weights held, sets cut) lands every N weeks and can be postponed from the Plan screen. Strips and charts show a rolling eight-week window; today's session leads the Home screen; past undone days show as missed. No rollover, no block end.
- **ATLAS Physique template.** Six days, Mon to Sat, push / pull / legs twice through, biased to chest, shoulders, arms and back, every set 0 to 1 RIR, light week every sixth week. Built from the current evidence on volume, proximity to failure and long-muscle-length training.
- **Pinned set counts per slot** (`{sets:n}` in the programme editor), so a lift can run 4 sets while the plan default is 3. Light weeks scale pinned counts to about 60 percent.
- Switching between an open plan and fixed blocks, or between templates with logs present, archives the current block first so history stays intact.

### 6.5

- **Template chooser on first run**: ATLAS full body, Upper / Lower, Push / Pull / Legs, or an empty programme that opens the editor. Settings → Programme → Start from a template switches later, with a warning if the current block already has sets logged.
- Home copy reflects the loaded programme and day count instead of the fixed ATLAS description. Days D to H get their own accent colours.
- Empty programmes are handled: the hero points to the editor, empty days say "No lifts yet", and a week with no lifts is never marked complete.

### 6.4

- **Configurable block length and phases.** Programme → Block structure: 2 to 12 weeks, each with phase, compound sets, accessory sets and RIR. Presets for 4, 5 (no deload), 6 and 8 weeks. Everything that used to assume six weeks now reads the plan, and archived blocks keep the plan they ran under. Weeks with sets logged cannot be removed.
- **Timed sets.** Plank, Suitcase Carry, Farmer's Carry and Dead Hang are measured in seconds; any lift can be switched on its lift screen. The session dock gets a stopwatch, labels say seconds, tonnage ignores timed sets, and records and progression use a seconds-based score instead of e1RM.
- **Session share card.** Done screen → Share card renders a 1080×1350 image of the day (stats, every set, PR badges) into the share sheet, or downloads it.
- **Google Drive sync** with the phone as a working cache. See the section above.
- CSV export gains `timed` and renames `reps` to `reps_or_seconds` and `e1rm` to `score_e1rm`.

### 6.3 · design pass

- **Session screen rebuilt around the input.** Weight, reps and Log set live in a dock pinned to the bottom of the screen; coaching, warm-up and cues scroll above it. A live tonnage counter and set count sit under the progress bar. On screens wider than 700px the dock becomes a sticky side column.
- **Numeric pad.** Tapping a value opens a bottom-sheet keypad with quick chips (same as last set, last time, empty bar, top of range). No system keyboard in the gym.
- **Rest takeover.** Solid full-screen rest with the next lift, what to load, equal-sized adjust buttons and a primary "I'm ready".
- **Logging feedback.** Pip pop, tonnage count-up, button press, distinct haptics for log, PR, rest end and error, and a gold flash on a PR.
- **Persistent last-set row** in the dock: edit or delete the set you just logged without leaving the session.
- **Home**: richer hero (first lift and its last top set), compact week strip, swipe left or right to change week, first-run "How ATLAS works" card, install prompt when running in a browser tab, tappable backup nudges (also on the Done screen after 7 days).
- **Progression**: summary strip with up, held, down and new counts that filter the list.
- **Stats**: unfinished weeks show a dashed projection instead of reading as a crash; the sets-per-muscle chart shades the 8 to 20 productive band; records are grouped by muscle with a "New PR" badge for the last 7 days and a "This week's PRs" section.
- **Gestures**: hold a logged set to delete it, hold a library lift to add it to a day.
- **Motion**: View Transitions for screen changes with the tapped day's title carried into the preview, rings and bars animate in. All honour reduced-motion.
- **Light theme** with Auto, Dark and Light in Settings. Android font-size setting is honoured; the largest headings clamp.
- **Weights snap to the lift's increment** on the stepper and display without trailing zeros.
- Manifest orientation is now `any` for tablets and landscape.

### 6.2

- **69 new lifts** across every group (134 total), with muscle maps, descriptions and form cues. Unilateral ones are flagged per side. Calves, core, glutes, chest isolation and upper back got the most attention.
- **Swap sheet** now offers every lift in the same group with the same movement pattern, after the curated substitutions, so any slot in an edited programme has swaps.
- **Exercise picker** is grouped by muscle group and no longer capped at 60 results.
- **Lift screen** lists similar lifts for browsing alternatives.
- **Bottom nav hides during a session** so a stray thumb cannot leave mid-set.
- **Launcher shortcut**: long-press the home-screen icon for "Start next session".
- New data-integrity test suite for the encyclopedia.

### 6.1

- **Bar and plate settings.** Settings → Training: bar weight and the set of plates available. The plate calculator and warm-up ramp use them. Barbell lifts are now identified by the encyclopedia's equipment field rather than a hard-coded list.
- **Rest time settings.** Global defaults for compound, accessory and superset transitions, plus a per-lift override on the lift screen.
- **Per-lift weight step.** Override the 2.5 kg / 5 kg increment per lift. Used by the +/− buttons in the session and by the coach's "add weight" recommendation.
- **Unilateral lifts.** Bulgarian Split Squat and Single-Arm DB Row are per side by default; any lift can be toggled on its lift screen. Per-side sets are labelled in the session and history, count both sides in tonnage, and export with a `per_side` column in the CSV.
- **Supersets.** In the programme editor, pair a lift with the one below it. The session alternates between the pair with a short transition rest, then a full rest before the next round.
- **Split into files** (css, data, core, app) with a zero-dependency test suite for the pure logic.
- **Service worker** now fetches the page network-first and versions assets, so an update cannot leave the app running a stale mix of files.
- **Rep ranges** accept a hyphen, en dash or em dash on input and in restored backups.
- **Accessibility**: labelled progress rings and sparklines, `aria-pressed` on toggles, up/down/hold glyphs alongside colour in Progression, live-region toast.
