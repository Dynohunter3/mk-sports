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
- **Player photos still come from the match data source (ESPN).** It has photos for only some players, and some photos are old; players without one show their shirt number in the team colour. Current photos for every player would need a licensed photo provider, which is usually paid.

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
