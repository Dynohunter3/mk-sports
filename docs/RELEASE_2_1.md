# MK Sports 2.1

## Sharing the app

- **Download page:** `https://dynohunter3.github.io/mk-sports/` (from `pages/index.html`). It has the Download for Android button, install steps, features, contact details and the responsible-use note.
  - The button points to `releases/latest/download/MKSports.apk` on GitHub.
  - It works once a release with that file is published.
- **In-app sharing:** Settings > Contact us > Share MK Sports sends that link.
- **Each phone has its own profile:** name and avatar (Settings, or the Private leagues screen), picks, points, badges and leagues. No account is needed and nothing is shared between phones unless the player shares a league link.
- **Compatibility:** Android 7 or newer, ARM phones (all real phones). There is no iPhone version.

## Private leagues (no server)

How it works:
- A league lives on each member's phone.
- "Share & update" sends a link (for example in a WhatsApp group) that carries the league and every score card the sender knows: name, avatar, points, this week's points, correct picks, streak, and the time of the card.
- Opening the link joins the league, or updates the table. The newest card for each member wins.
- The data sits in the part of the link after `#`, which browsers never send to the web server, so nothing is uploaded.
- The page `pages/l.html` forwards the link to the app (`mksports://pl?d=…`), or offers the download.
- Joining by code alone also works. The name and members arrive with the first link from a member.
- Tables: season or this week, medals for the top three, streaks, "updated 2h ago".

Limits, stated plainly:
- **Tables update only when members share,** so tap "Share & update" after each matchday.
- **A determined person could edit a link.** It's meant for friendly leagues with no prizes.
- **For automatic live tables** (no sharing step) the app needs a small server, for example a free Supabase or Firebase project. The player's own account would hold it.

Code: `mobile/src/data/pleagues.ts` (with tests), `mobile/src/app/private-leagues.tsx`, `mobile/src/app/pl.tsx`.

## Notifications: why they were late, and what changed

| Alert | Before | Now |
|---|---|---|
| Kick-off reminder (30 minutes before) | Scheduled ahead, but without the exact-alarm permission. Android 12+ treats such alarms as "roughly then", and battery savers stretch them | Exact alarm: `USE_EXACT_ALARM`, plus `SCHEDULE_EXACT_ALARM` on Android 12 |
| Kick-off | Found by a background check, at best every 15 minutes | Scheduled at the exact kick-off time |
| Goals, full time | Background check, at best every 15 minutes; battery savers delay or skip it | **Live tracking:** while one of your matches is live or within 15 minutes of kick-off, a foreground service shows a live-score notification and checks every 30 seconds |

**Starting and stopping live tracking:**
- Android only allows starting it while the app is open. So it starts when the app is opened during or just before a match (the kick-off alert is a handy way in).
- It then keeps running with the app closed, and stops by itself about 2 minutes after your last match ends (5-hour safety limit).
- It is declared as a data-sync foreground service (Android 14 rule). Code: `mobile/src/notify/live.ts`, using react-native-background-actions (MIT licence).

**Settings:**
- a switch for live tracking;
- **Test my alerts:** one alert now, and one exact-scheduled a minute later. It also briefly shows the live-tracking notification.
- **Alerts late or missing?** Guidance and a shortcut to the app's battery settings ("Unrestricted"; on Tecno, Infinix, itel and Xiaomi phones, Auto-start).

**What remains:**
- **Without a push server, alerts can't wake a phone that never had the app open during the match.** Live tracking covers matches during which the app was opened.
- **Truly instant alerts for every match, with the app never opened, need push notifications from a server** (Firebase Cloud Messaging). That needs a Firebase project and something to send the pushes.

## Line-ups

- **One team at a time on a full pitch,** with a team switcher (crest, name, formation), instead of both teams squeezed onto one pitch.
- **Bigger player bubbles** (52 px) and more space between lines.
- **That team's full substitutes list** below the pitch.
- **Player photos now come from Wikimedia Commons** (see below), with ESPN's photo and then the shirt number as fallbacks.

## Player photos (Wikimedia Commons)

**Why:** ESPN, the match data source, has photos for very few current players. Measured on 24 Nov 2026:
- 38 of the 605 players in Premier League squads (6%);
- 2 of the 40 players in the Liverpool v Manchester United squads.

**How it works:**
- **Server side (`pipeline/mkdata/photos.py`, in the data pipeline):**
  - Reads footballers' dates of birth, photos and ESPN IDs from Wikidata (CC0).
  - Reads each photo's author, licence and date from Wikimedia Commons.
  - Downloads a 500 px thumbnail, finds the face with OpenCV and saves a 160 px square crop.
  - Publishes the crops with an index by birth month and by ESPN ID, plus a credit for every photo, on GitHub Pages.
  - Only CC0, public domain, CC BY and CC BY-SA photos are used. When a player has several photos, the newest dated one with a usable face wins.
- **On the phone (`mobile/src/data/photos.ts`):**
  - Matches a player by ESPN ID where Wikidata has one, otherwise by date of birth and name.
  - The date of birth comes from the team's ESPN squad, which the app already loads.
  - The name rule: the full name, or the same surname with an overlapping first name. A tie between two players means no photo rather than a wrong one.
  - Used in line-ups, substitutes, squads, leader lists and the player page. The player page shows the photo credit.
  - Settings > About links to the credits page (`pages/photo-credits.html`).

**Rules followed:**
- The pipeline never fetches ESPN: the source registry records that ESPN's terms forbid automated extraction.
- Wikimedia's robot policy is followed:
  - a User-Agent with contact details;
  - the Action API one request at a time, 5 s apart;
  - media one at a time, standard thumbnail sizes only;
  - Retry-After honoured.
- The Wikidata query service is paced to one request a minute, its limit while it recovers from an outage.

**Limits:**
- **Not every player has a free photo.** Players without one keep the ESPN photo or the shirt number.
- **Photos are as current as Wikimedia's.** In the first 128 crops, the median year taken is 2025, and 81 are from 2024 or later. The newest photo of each player is preferred.

**Coverage, measured 24 Nov 2026** (players with a Wikimedia photo candidate; a little lower after face detection):
- **Premier League squads:** 388 of 605 (64%), against 38 (6%) with ESPN photos.
- **Liverpool v Manchester United squads:** 36 of 40, against 2 with ESPN photos.
- **Who is missed:** mostly young players with no Wikidata photo, and players whose Wikidata record has no club.
- **Wikidata's club memberships are often out of date,** which is why matching uses date of birth rather than club.
- **The first build takes a few pipeline runs** (about a day).
  - First run (24 Nov): the index (11,323 players, 11,639 photos described), then 128 crops in the time left.
  - Each later run crops up to about 4,000, at two downloads a second, which is within Wikimedia's media limits.
  - Photos appear gradually: players with an ESPN ID on Wikidata first, then the youngest.
- **Face detection misses some photos.** In the first pipeline run, 128 of 161 photos (79%) gave a usable crop. The rest (crowd shots, side-on faces) are skipped rather than badly cropped; another photo of the player is tried if there is one.
- **Professional face cards** (TheSportsDB cutouts, current for most players) need a paid plan: $9 a month, because the free key does not allow published apps. That is the owner's decision.

## Goals outlook (match page)

From the model's expected goals, using a Poisson score grid with the Dixon-Coles low-score adjustment:
- expected goals per team;
- the five most likely scorelines with their chances;
- over/under 2.5 (the published model's tested figure where it exists);
- each side's clean-sheet chance;
- a one-line read of the game.

It's labelled as a model estimate. Code: `mobile/src/engine/scorelines.ts` (with tests).

## Other fixes and touches

- **The match header score could be cut off** ("3–" instead of "3–2"), for example with large phone text sizes. It now shrinks to fit.
- **Your team's row in league tables** breathes in the team's own colour, with a pulsing dot, instead of a flat green highlight.
- **Contact us** in Settings: email, phone and WhatsApp, all tappable. These details also appear on the download page and are public in the repository.
- **Home:** "My game" and "Private leagues" shortcuts under Quick Picks.
