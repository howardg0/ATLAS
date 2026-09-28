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
| `logs` | keyed `"week-day"`, each with `ex[slotIndex] = [sets]`; a set is `{kg, reps, t, name, uni?, timed?}` (for timed sets `reps` holds seconds); `mins` is a session length typed on the summary |
| `metrics` | body check-ins `{id, date, kg, waist, photos:[ids], t}`; photo data lives in IndexedDB under `photo:<id>`, never in this object, so it is not synced to Drive |
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

### 8.1
**Session time**
- Session length adds up the gaps between sets and leaves out any gap over 30 minutes, so a set logged the next morning can no longer turn an hour into 1,200 minutes. It's worked out when shown, so old sessions correct themselves.
- Tap the minutes on a summary to type the real length; clear the box to go back to the timed figure. The typed figure survives Drive sync.

**Calendar**
- Stats → Calendar: a month grid, Monday first, with a dot in the day's colour for every session from every block, placed on the day of its first set. Tap a day to open it. Sessions from archived blocks open a read-only summary, because their week-day keys also exist in the current block.

**Lift screen**
- Recent sessions: the last six sessions of that lift with dates, sets and estimated 1RM, and the change from the one before. Tap one to open that session (not while you're mid-session).

**Coach**
- If a set falls under the rep range, the next one is offered lighter: the weight with the same estimated 1RM at the bottom of the range, on the lift's grid and at least one step down. The rest screen shows that weight.
- If a lift has been stuck at the same weight for two or more weeks, the first set suggests a reset to about 90% and aims for the top of the range. The Progress tip names the same weight.
- A stall now means the same top weight without beating the week before. A load change in either direction restarts the count: more weight for fewer reps is progress, and a lighter week is a reset.
- Assisted machines (where more weight means more help) are left out of both.

**Body (Progress → Body)**
- Check-ins: bodyweight, waist and up to four photos. There's a 7-day average, a weekly rate (least squares over the last four weeks, needing four or more weigh-ins across 14 days), 12-week charts, a photo grid and a full-screen viewer that can show a photo beside your first one in the same position.
- The Nutrition screen compares that rate with the goal's band and offers the guide's own step (150 kcal more when behind, 100 less when ahead) as a one-tap change. After a change it waits for two weeks of new weigh-ins before suggesting another. Changing goal clears it.
- Logging a weigh-in updates the Nutrition screen's bodyweight to your 7-day average.
- Photos are downscaled to about 1280 px and stored in IndexedDB on the phone only. They're never in the synced log. "Back up everything" includes them and Erase removes them. Check-ins merge by id when Drive sync merges two copies.

### 8.0
A review release. A 16-lens sweep of the codebase produced 290 findings; 66 bugs were confirmed by two independent refuters each and 135 proposals passed a three-judge panel. This release fixes every confirmed bug that did not need an owner decision and ships the highest-value proposals.

**Data safety**
- Sync merges instead of overwriting. When both this phone and Drive have logged since the last sync (two devices, a download deferred during a session, the installed app plus a browser tab), `mergeDb` keeps the newer copy's structure and the **union of logged sets** from both, matched by timestamp; archived blocks are unioned by block number, and a copy that was still on the old block is folded into the matching archive entry. Merge is also offered on first connect ("Merge both") and dismissing that sheet connects nothing.
- A failed Drive read is an error, never "no remote file" (which uploaded over it). Token popups that never call back time out after 90 s. Background syncs skip the download when Drive's file is unchanged.
- Two browsing contexts on one phone: a `storage` event from the other context merges its write in.
- Reset programme archives the current block first (sets stayed attached to a different slot layout). Restoring a backup keeps this phone's Drive link and refreshes the screen and theme. Mirror adoption at boot is a quiet save so a stale mirror can't out-rank Drive.
- Empty log entries (Start tapped, time budget set) no longer count as logged weeks; the session's date is the day of its first set; entries with nothing in them are pruned on exit.

**Session**
- Bodyweight lifts log at 0 kg without typing it. `+` on an empty barbell lift starts at the bar. Stepping from off-grid values lands on the grid (62.5 + 5 → 65, not 70). The edit-set sheet steps by the lift's own increment and labels seconds correctly.
- Finishing a session stamps it done; reviewing a finished day just shows the summary (no re-sync, no re-stamp). Unfinished lifts on the summary are tappable and drop you back into the session at that lift; the session map offers "Log another set" beyond the plan.
- Skip on the last lift asks before ending the session, and Skip shows what it skipped. Deleting a set asks first.
- Rest: logging while peeked no longer leaks the old clock; the target readout follows weight changes made while peeking; the hint hides when it duplicates the target; rest end shows a toast and, where there is no vibration (iPhone), a short tone. Notification permission is no longer requested on the first rest — it is an opt-in under Training → Rest alerts.
- Warm-up ramp shows on the first set of every compound. Form cues stay open across sets of the same lift. The session map scrolls the current lift into view.
- Coach: "add weight" now fires when all but one set hit the top of the range (and none fell below the bottom); a cut-short previous session no longer triggers it; when most sets fell under the range it suggests a 5% back-off. A rep PR that beats your best estimated 1RM is celebrated too.

**Plan and progression**
- Streak carry ends when a past week of the new plan has a missed session (both plans); block rollover now carries streaks. A session counts as done when finished in the app, fully logged, or at 80%+ of its sets, so editing the programme no longer turns finished weeks into "Missed".
- Hero says Missed / Upcoming for past and future weeks. Verdict baseline skips light weeks; a load jump with fewer reps reads as progress, not a regression; the week average is weighted by tonnage; stall detection ignores light weeks; empty programme days are not "never logged".
- Volume view lists every major muscle (untrained ones at 0), keeps the 8–20 band for majors only and lists smaller muscles separately. Sparklines have a floor so noise reads as flat.
- Move-session no longer offers weeks it then refuses. A scheduled switch or Drive adoption never leaves a preview of a day that no longer exists.

**Library, settings, misc**
- Library and picker search match every word ("incline dumbbell"). Permanent swap lists require a shared primary muscle; the Permanently list highlights the programme's choice; a permanent swap across seconds/reps rewrites the slot range so edits stick.
- Lift screen rest default follows the slot the lift sits in. Bulk rep-range shortcuts skip timed slots and the field accepts a dash on iPhone.
- Reminders: block plans get a weekday picker; empty programmes are guarded; calendar UIDs are stable so re-adding updates the events. CSV export includes the set time.
- Appearance: text size (Smaller/Default/Larger/Largest) as the accessibility control while zoom stays locked; theme applies before first paint. iPhone users get an install hint on Home. The problem report includes storage size, last save error and last sync.
- Exercise database: 14 new lifts (151 total), 12 new curated swap lists (37 total), Rack Pull re-mapped to the hip extensors, honest Wide-Grip Pulldown text, Cable Lateral Raise flagged per-side, "only lift" claims softened; landmine, safety-bar, trap-bar and T-bar lifts leave the barbell plate calculator.
- Performance: one IndexedDB connection, one save per logged set, the tonnage counter cancels its previous animation.

### 7.3.1
- "Move this session to another week…" is also on the Done screen, which is where a finished session opens.

### 7.3
- Fix: swapping a timed slot for a reps lift (Plank → Machine Crunch) showed the seconds range as reps. The rep range now follows the lift actually in the slot: across the timed/reps line it falls back to 10–15 reps or 30–45 s (`slotRange`), everywhere the range is shown or used for coaching.
- Fix: "Switch now" to an open plan on a Sunday made the week ending that day week 1 (so Monday was week 2 and week 1 read as missed). Sunday switches now start week 1 on the coming Monday, and nothing is due before the start date.
- Programme → Open-ended plan has an editable **Week 1 started** date, for when the weeks are labelled wrong.
- Session preview has **Move this session to another week…** (only for sessions with logged sets; target weeks that already have that day logged aren't offered).

### 7.2
- Plan migration. Settings → Start from a template now shows what carries over (how many of the new plan's lifts already have history) and, for open-ended plans, offers **Start on Monday**: the current plan runs until Sunday, a card on Home shows the scheduled switch (Switch now / Cancel), and the first open on or after that Monday archives the old block, applies the template with that Monday as week 1, and counts any days already missed. Stored as `db.pending = {template, startOn}`.
- Streaks carry across a switch (`db.streakCarry = {s, w}`): the carried value is added until the new plan has a missed session (session streak) or an incomplete past week (week streak), after which it is dropped for good.
- Records, progression charts, previous-session lookups (by lift name, 7.0) and per-lift settings already carried across; this release makes the switch itself seamless.
- ATLAS Physique template tuned for size over strength: Incline Barbell Press, Overhead Press and Romanian Deadlift move to 8–12; Pendlay Row becomes T-Bar Row 8–12 (less lower-back load two days after RDLs); Friday's Weighted Sit-Up removed (abs 12 direct sets over 4 days). Weekly total 140 sets.

### 7.1.2
- Fix: Progression screen threw on open (the 7.0 rename of its local summary variable missed the `weekTips` call).

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
