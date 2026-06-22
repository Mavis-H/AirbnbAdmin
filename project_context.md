# Airbnb Turnover Coordination System — Project Spec / Implementation Handoff

> This doc is for Claude Code. Read "Goal" and "Current Phase Scope" first. Phase 1 implements only the parts that run locally with zero deployment dependencies.

---

## Goal

Solve a **coordination gap**: I (the owner) handle all of the Airbnb online work (guest communication, listing content), but all on-site work (cleaning, inspection, battery swaps, changing the smart-lock code) is done by my parents. My parents can't use complex software — Airbnb is too complex for them. Right now every guest request and check-in/checkout time has to be relayed to them manually, which is slow and error-prone.

This is **not a PMS**. It's an **operations coordination layer**: it automatically turns the Airbnb booking calendar into a dead-simple "this week's plan" for non-technical people. My parents open one screen (that behaves like an app) and immediately see what to do next — which day to clean, swap batteries, what to set the lock code to. Zero input, zero configuration on their end.

---

## Architecture

```
Inputs                Backend core                       Outputs (for parents)
─────────            ──────────────────────             ─────────────────────
Airbnb iCal  ──┐
               ├──> fetch+parse → logic engine → store ──┬──> This-week plan page (PWA)
Admin view ────┘                                          └──> WeCom (企业微信) push
(me)
```

- **fetch+parse**: periodically pull each property's Airbnb iCal (.ics), parse out check-in/checkout intervals. iCal contains **dates only — no guest name, no lock code**.
- **logic engine**: the brain. Combines the schedule with the fields I enter to produce a task plan with concrete actions and an assignee per task. All if/else rules live here.
- **store**: SQLite, a single file is enough.
- **This-week plan page**: the parents' only interface. PWA, "Add to Home Screen" so it behaves like an app. No login, large text, day-by-day cards.
- **Admin view**: my own minimal forms (enter code/name/notes, set takeover periods, reassign tasks).

### Routing & week window (no login — zero click)

Role is decided by **URL path**, not a login (logins confuse the parents). Each person installs the PWA from their own URL, so their home-screen icon always reopens the right view:

- **`/`** → member view (parents): the plan page only, no nav bar, nothing else to tap.
- **`/admin`** → admin view (owner): keeps an internal tab toggle between **This Week** (the plan) and **Management** (the forms) — both live on this one route. **Management** is further split by a **left side-nav** into **Bookings / Takeovers / Properties** (one section shown at a time).

The plan page's 7-day window is **anchored by role** (same `PlanView` component, `mode` prop):

- **member** → rolling next-7-days anchored on **today** (Wed Jun 17 → Jun 17–23; opening it Thu → Jun 18–24). Slides daily.
- **admin** → fixed **Monday–Sunday** calendar week (Jun 17 → Jun 15–21; ‹ › jumps Mon→Mon). Backend `getMondayOf` ([src/routes/plan.ts](src/routes/plan.ts)) provides the alignment. The week label between the arrows is also a **date picker**: pick any date and it snaps to that date's Mon–Sun week (for jumping to far-off weeks without clicking through).

Deployment note: serving `/admin` directly (or on refresh) needs the prod server to fall back to `index.html` for unknown paths. Vite dev already does this; the Fastify static-serving fallback is a Phase 3 (deployment) task — the server doesn't serve the frontend yet.
- **WeCom push**: one off-peak reminder per day to the parents. **Phase 1 uses a console stub — no real delivery yet (see below).**

---

## Tech Stack

**Confirmed (locked in):**

- Backend: Node.js + TypeScript, Fastify
- iCal parsing: `node-ical`
- Database: SQLite via `better-sqlite3`
- Scheduling: `node-cron` (only truly enabled after deployment)
- Frontend: Svelte + Vite; two views — the this-week plan page and the admin forms; `manifest.json` + service worker for PWA
- Notifications: abstracted behind a single `sendNotification()` interface; this phase = `console.log`; deployment phase = WeCom `qyapi.weixin.qq.com`

---

## Data Model

```
PERSON     (assignee)
  id              PK
  name
  role            admin | member
  notify_method   wecom_userid / none

PROPERTY
  id               PK
  name
  ical_url         Airbnb iCal link
  checkin_time     default check-in time (e.g. "15:00:00") — combined with iCal date to form full timestamp
  checkout_time    default check-out time (e.g. "11:00:00")
  default_passcode permanent Eufy admin passcode; lock falls back to this between bookings

BOOKING    (from iCal + manual fields)
  id              PK
  property_id     FK -> PROPERTY
  checkin_at      ISO 8601 timestamp (date from iCal + property.checkin_time)
  checkout_at     ISO 8601 timestamp (date from iCal + property.checkout_time)
  guest_name      (manual)
  lock_code       this stay's temp passcode — always manually entered by admin; never auto-generated
  notes
  ical_uid        dedup key from iCal

TASK       (generated by the logic engine)
  id              PK
  booking_id      FK -> BOOKING
  assignee_id     FK -> PERSON (effective assignee)
  date
  type            see task type enum
  status          pending / done
  override        bool — manually overridden
  note            per-task note (manual, optional); shown on the task card in both views

TAKEOVER   (takeover period)
  id              PK
  from_person_id  FK -> PERSON (e.g. parents)
  to_person_id    FK -> PERSON (e.g. me)
  start_date
  end_date
```

**Roles:**
- `admin` — the owner/manager. Full admin-view access. Gets assigned owner-only tasks (5-star review, checkin checklist).
- `member` — anyone doing on-site work (parents, or others added later). Gets on-site task assignments. Views the plan page.

Both roles can view the plan page (filterable by assignee). `is_app_user` flag removed — app access is not restricted by role.

**Cleaning responsibility:** if a `clean_inspect` task is assigned to a member, *how* it gets done (self-clean vs hiring) is their decision. The system doesn't track it.

---

## Business Logic (logic-engine core)

### For each CHECKOUT event, generate these tasks:

1. **Lock-code rule** (Eufy smartlock):
   - The lock always has a permanent **default admin passcode** stored on the property. Between bookings, no action needed — lock reverts to default automatically.
   - Each booking gets a **temporary passcode** that admin creates manually in the Eufy app; it auto-expires on checkout. `lock_code` on BOOKING is always manually entered — never auto-generated.
   - `lock_code_change` task (assigned to admin) is generated in **two scenarios**:
     - On the **checkout date** of the preceding booking, if a next booking exists (so admin knows to create the temp code before next guest arrives)
     - On the **sync date (today)** when a new booking is first detected by the daily iCal pull
   - No next booking = no task (lock falls back to default passcode).
   - Paired with each `lock_code_change` is a `fill_booking_info` task (assigned to admin): enter the upcoming booking's guest name / notes. Both are generated together in both scenarios above (preceding checkout date, and sync/detection date).
2. **Lockbox**: return the mailbox key + spare door key to the lockbox (assigned to member).
3. **Battery swap**: swap the smart-lock batteries on every checkout (assigned to member).
4. **Clean**: clean the unit — how it gets done (self or hired) is the member's decision (assigned to member).
5. **Inspect**: check furniture/fixtures for damage and conditions (assigned to member).
6. **Check supplies**: confirm consumables are stocked for ~one week (assigned to member).
7. **Five-star review**: remind admin to send the guest a 5-star review message (assigned to admin).

### For each CHECK-IN event, generate an owner-facing pre-arrival checklist:

- Send the guest a welcome message
- Confirm whether they have pets
- Tell them the lock code
- Parking guide
- Mail / package instructions
- Trash bin instructions

### Assignee resolution order (lowest → highest priority):

1. **Default**: on-site tasks default to `member`; admin-only tasks (e.g. five-star review, checkin checklist) default to `admin`.
2. **Takeover period**: if a task's date falls within a TAKEOVER range and the default assignee equals that record's `from_person`, switch the assignee to `to_person`.
3. **Manual override**: a per-task manual assignment wins over everything (`override=true`).

---

## Current Phase Scope (Phase 1 — fully local, zero deployment)

### In scope this phase (all implemented):
- [x] iCal parsing (support reading a local .ics file + a fixture set of fake data for testing)
- [x] Data model + SQLite table creation
- [x] Logic engine: lock-code rule, task generation, assignee resolution (incl. takeover periods + manual override)
- [x] This-week plan page (read-only; grouped by day, filterable by assignee). Member cards are stripped to essentials — no assignee line, no booking-level notes; per-task `note` (if set) is shown
- [x] Admin view: enter a booking's code/name/notes, set takeover periods, reassign tasks per row, add a per-task `note`. Booking detail loads **all** of a booking's tasks (not just the check-in week — long stays put checkout tasks weeks later)
- [x] `sendNotification(person, message)` interface; this phase's implementation = print to console / log
- [x] PWA basics (manifest + service worker); service workers are allowed on `localhost` without HTTPS, so "Add to Home Screen" can be verified locally

### Out of scope this phase:
- Real WeCom push (needs a public IP + trusted-IP whitelist — deferred to deployment)
- Real cron scheduling (manual trigger is fine locally)
- Any server / domain / HTTPS / VPS configuration

### Design constraint (important):
Keep a clean boundary between the logic layer and real delivery. `sendNotification()` only `console.log`s for now; at deployment it gets swapped for the WeCom API call. The **content and timing** logic of notifications is fully testable locally — only the last-mile real delivery is deferred to go-live.

---

## Phase 2 — PWA polish — ✅ Done

- **App icon**: generated, dependency-free, by [frontend/scripts/gen-icons.mjs](frontend/scripts/gen-icons.mjs) (`npm run icons`) — "162" in Airbnb-pink (#FF5A5F) on a white rounded square, rendered as vector strokes + supersampled AA, encoded to PNG via Node's `zlib`. Emits `icon-192/512`, `icon-maskable-512` (digits inside the ~80% safe zone), and `apple-touch-icon` (180, full-bleed for iOS's own rounding).
- **Full-screen standalone**: `display: standalone`, white `background_color` splash, `viewport-fit=cover` + `env(safe-area-inset-*)` padding for notch/home-indicator, plus iOS `apple-mobile-web-app-*` tags and `apple-touch-icon` link.
- **Per-role install**: `index.html` injects the manifest by path — `/manifest.json` (`start_url: /`) for members, `/manifest.admin.json` (`start_url: /admin`) for the owner — so each home-screen icon reopens its own view. Home-screen label = "162" / "162 Admin".
- **Offline app-shell**: [public/sw.js](frontend/public/sw.js) (`turnover-v2`) precaches the shell + icons; navigations = network-first → cached shell, `/api/*` = network-first → cache fallback, other GETs = stale-while-revalidate. SW still registers in PROD only.

## Later Phases (reference only — do NOT implement this phase)

- **Phase 3**: wire up the daily WeCom push + a minimal deployment to validate real on-device delivery
- **Phase 4**: task completion feedback, five-star review reminders, consumables inventory tracking, etc.

---

## Deployment Notes (for Phase 3 — ignore for now)

- Host: a US VPS (DigitalOcean / Vultr / Linode / Hetzner / Lightsail, ~$5/mo) with a **fixed public IP**
- WeCom self-built apps **require configuring a "trusted enterprise IP" (企业可信IP) whitelist** — add the VPS IP there. Serverless (rotating IPs) doesn't fit, hence a fixed-IP VPS.
- Before configuring the trusted IP, you must first set either a "trusted domain" (requires ICP filing / 备案) or a "message-receiving server URL"; using the latter avoids 备案.
- Parents are in the US → calling `qyapi.weixin.qq.com` has a few hundred ms of cross-border latency, irrelevant for a once-daily push.
- Reverse proxy + HTTPS: Caddy (automatic Let's Encrypt); PWA requires HTTPS in production.
- How parents receive: a one-time QR-scan bind via the WeCom "WeChat plugin" makes messages land directly in their regular WeChat — no need to install the WeCom client.

---

## Open Decisions

All Phase 1 decisions are resolved:

1. ~~Backend language~~ → **Node.js + TypeScript + Fastify** ✓
2. ~~Frontend framework~~ → **Svelte + Vite** ✓
3. ~~Role naming~~ → **`admin` / `member`** ✓
4. ~~Full enum naming for `TASK.type`~~ → **`lock_code_change | fill_booking_info | lockbox_return | battery_swap | clean | inspect | check_supplies | five_star_review | checkin_checklist`** ✓
5. ~~Random lock-code generation rule~~ → **dropped: `lock_code` is always manually entered by admin, never auto-generated** (see Business Logic) ✓
6. ~~Exact look of the members' this-week plan page~~ → **implemented in PlanView (day-grouped cards, assignee filter)** ✓