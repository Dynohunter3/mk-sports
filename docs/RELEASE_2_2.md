# MK Sports 2.2

## Match centre: live win probability

- **What it shows:** a home / draw / away chart through the match, worked out on the phone from data the match page already has.
- **How it's worked out:**
  1. Take the model's pre-match expected goals for each team.
  2. Scale them to the minutes left: 95 minutes of playing time, goals equally likely in every minute.
  3. Adjust for red cards: the side with ten players scores at 0.70× its rate and its opponent at 1.25×. These are rough, research-informed figures.
  4. Start from the current score. A Poisson grid with the Dixon-Coles low-score adjustment gives the goals still to come.
- **The card:** the live numbers, the chart with goal and red-card markers, the biggest swing, and a "How it's worked out" note.
- **Not modelled:** tactics, injuries, substitutions, and goals coming more often late in matches. It is a transparent estimate, not a betting model.
- **Code:** `mobile/src/engine/winprob.ts` (with tests), `mobile/src/components/winprob.tsx`.

## Player expected goals

- **On the player page:** season xG, non-penalty xG, xG per 90, goals minus xG, shots and minutes, labelled as MK Sports' own estimate.
- **Where the figures come from:**
  - Each finished match's per-player figures are computed once from the match summary and saved on the phone (finished matches don't change).
  - Shooters are matched to the line-up by name, because the commentary feed gives no player ID.
  - Minutes come from the line-ups and substitutions.
  - Matches missing positions for more than a fifth of their open-play shots are left out, and the page says how many.
- **A fix found on the way:** goals recorded as subtypes such as `goal---free-kick` were not counted as shots. Liverpool's xG against Manchester United went from 2.42 to 2.49 with Szoboszlai's free-kick goal included.
  - Caveat: the xG model itself was fitted with the narrower list, so it has never seen free-kick goals. The effect is small.
- **Code:** `mobile/src/data/playerxg.ts` (with tests).

## Search

- **Where:** a search button on Home.
- **Competitions:** from the app's own list, on the phone.
- **Teams and players:** from ESPN's search (the same source as the app's other match data), limited to competitions the app covers, opening the app's team and player pages.
- **Code:** `mobile/src/data/search.ts`, `mobile/src/app/search.tsx`.

## Home-screen widget: My team

- **What it shows:** your team's live score; otherwise its next match and last result. Tapping it opens the match.
- **Adding it:** Settings > Notifications > Add the My team widget, or from the home screen's widget list.
- **Updates:**
  - Android refreshes it every 30 minutes (the system minimum).
  - The app also refreshes it on launch, when you change team, and on every live-tracking pass, about every 30 seconds while one of your matches is on.
- **Code:** `mobile/src/widget/`, with react-native-android-widget (MIT).

## Backup and restore

- **Back up my data:** writes a file with your profile, picks, points, badges, private leagues and settings, and offers to save it anywhere (Drive, email, a chat).
- **Restore from a backup:** picks that file, shows what it holds, and replaces this phone's data after you confirm. Files exported by 2.1 also work.
- **Android Auto Backup was not actually protecting anything:**
  - It was switched on, but the rules shipped by `expo-secure-store` back up only shared preferences.
  - All the app's data lives in AsyncStorage's SQLite database (`databases/RKStorage`), so a restore would have brought back nothing that matters.
  - New rules (`mobile/plugins/withBackupRules.js`) include that database and still exclude the secure store.
  - See the release check below for what was tested on the emulator.

## Game

- **Banker:** one pick a week (by kick-off date) worth double points.
  - Switch it on from the pick screen.
  - It can move to another match until its current match kicks off.
  - My game shows this week's banker.
- **Season archive:** My game lists every season (July to June) with points, accuracy, exact scores, best streak and bankers won. It is worked out from your saved picks.

## Private leagues

- **Reminder:** after the kick-off of your last pick of the week (about two and a half hours later), a reminder to "Share & update", because league tables only change when members share.
  - It goes only to players who are in a league, and only with "Pick results" alerts on.
  - Tapping it opens Private leagues.
- **Automatic syncing:** not built yet. It needs a free Supabase project in the owner's account; the plan is below.

## Accessibility

- **Text on team colours:** badges, crests and shirt numbers pick black or white text by WCAG contrast ratio. Yellow, orange and light kits now get dark text.
- **White headlines on team colours:** the match header and the Quick Picks card darken the team colour just enough for white text to stay readable.
- **The Quick Picks card:** it now has a fixed dark base, so it is readable in the light theme too.
- **TalkBack in Quick Picks:**
  - Every button has a clear label and is announced as a button.
  - The card describes the match.
  - After a pick, the AI's call is read out.

## Model and accuracy page

- **Nine more leagues on the published model** ([Step 10](audit/STEP10_MORE_LEAGUES.md)): League One, League Two, Scottish Premiership, 2. Bundesliga, Serie B, LaLiga 2, Ligue 2, Belgian Pro League, Greek Super League.
  - The model beats the on-device engine in every one of them, in both test seasons.
  - The existing leagues did not get worse.
- **Ranked probability score (RPS):** 0.2035 for the model against 0.2023 for the bookmakers' closing odds on the same 14,205 matches, plus the live figure.
- **Calibration chart:** calls grouped by the chance given, against how often they won. 70–80% calls won 76.5% (average given 74.4%).
- **Live record vs testing:**
  - The live hit rate is drawn against the tested hit rate and the 95% range chance allows.
  - It shows "too early to judge" under 100 matches. After that, a record outside the range is flagged in the app and raised as a warning in the pipeline's health check.
- **The track record shown with each call:** now measured on all 20 competitions.
  - Strong calls right 75.6%; all calls 50.4% (bookmakers 51.0%); safer calls 78.2%.
  - The overall hit rate is lower than before (52.5%) because lower leagues are harder to call, not because the model got worse.

## Release check

- **Tests:**
  - app 80, including the new win probability, player xG, search, backup, banker, archive, contrast, league reminder and widget tests;
  - pipeline 72.
- **Web previews:** win probability on Liverpool 4–0 Manchester United, Szoboszlai's season xG, search, the accuracy page, My game and the Quick Picks card.
- **Emulator** (x86 build of 2.2.0, Android 10):
  - **Widget:** the provider is registered; "Add the My team widget" in Settings pins it, and it rendered on the home screen.
  - **Auto Backup round trip** (Android's local backup transport): with a profile, picks and settings saved, back up, uninstall, reinstall with restore. The game and settings came back byte-for-byte identical, and the app opened straight to Home.
  - **2.1 for comparison:** the same round trip with the 2.1 APK restored nothing (the database was not in the backup).
  - **Back up my data:** opened the share sheet with `mk-sports-backup-2026-11-25.json`.
  - **Restore from a backup:** after clearing the app's data, restoring that file brought back the profile ("Restore Test 🦁") and the private league ("Restore league").

## Not done, and why

- **Automatic league syncing (Supabase):**
  - Needs a free Supabase project created in the owner's account (URL and public anon key; no payment).
  - Plan:
    - a `league_cards` table (league code, member ID, card JSON, updated at), with row-level security allowing inserts and updates only for a member's own card;
    - the app upserts its card after each settled pick and reads the league's cards when the table opens;
    - links stay as the fallback.
- **New-league fixtures arrive late:** only 2–4 days ahead, because openfootball has no 2026-27 files for those leagues. Further out the app shows its on-device estimate.
