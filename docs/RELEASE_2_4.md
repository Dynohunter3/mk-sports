# MK Sports 2.4

2.4 is a polish release. It also includes 2.3.1 and 2.3.2, which were not published as separate releases.

## Player pages

### Facts from beyond ESPN: Wikidata

- **Why:** ESPN's player feed has no height for most footballers, and no place of birth or career history at all.
- **What's added:**
  - height;
  - place of birth;
  - senior club career, with loans marked;
  - current national team, with the year the player first played for it.
- **Source:** Wikidata, the free database behind Wikipedia. Its data is CC0 (free to reuse) and needs no key.
  - The photo pipeline already links each player to a Wikidata item, so no new matching is needed.
  - Queries follow Wikimedia's robot policy, the same as for photos: a User-Agent with contact details, one query a minute, and a few queries a run.
  - Each player is refreshed every two weeks.
  - Published as `photos/f/<wikidata id>.json` on GitHub Pages.
  - Credited on the player page.
- **Cleaned before publishing**, because Wikidata is edited by volunteers:
  - youth and under-21 sides are left out;
  - a club spell that runs past the start of the next permanent club ends when the next one starts (loans may overlap). This is a common slip, for example Salzburg 2018–2023 for a player who joined Leipzig in 2021;
  - a spell with no end date that is followed by another club shows "?" as its end, never "still there";
  - an end date recorded as "unknown" is shown as unknown;
  - the national team is shown only while its spell is open. For example, Szoboszlai's Hungary spell has an "unknown" end date on Wikidata, so it is left out rather than guessed;
  - heights outside 1.50–2.10 m are dropped, and a birthplace with two different values is left out;
  - "F.C." is dropped from club names ("Liverpool F.C." becomes "Liverpool").
- **Coverage (measured on 27 Nov 2026, the first 250 players in the published photo map, one query):**

  | Fact | Players with it |
  |---|---|
  | Height | 244 of 250 |
  | Place of birth | 247 |
  | Club career | 241 |
  | Current national team | 102 |

  Only players with a published photo get facts, because those are the players linked to Wikidata. That is about 7,000 footballers. Facts for all of them build up over the next pipeline runs.
- **Limits:**
  - Wikidata is checked for obvious slips but is not guaranteed. A recent transfer can take days or weeks to appear.
  - Heights from Wikidata are preferred over ESPN's; ESPN's are used when Wikidata has none.

### Tried and rejected

- **Captains:** Wikidata's captain statements (P634) were checked for a few big clubs. Liverpool had none, and Bayern still listed Philipp Lahm as captain with no end date, though he retired in 2017. They are too stale to show, so the app has no captain badge.
- **Player ratings (like 7.4 out of 10):** no free source permits them in a published app. The app still never invents ratings.

### New layout

- **Header:** a large photo with the player's number, a faded shirt number behind, the position, the club, and tiles for age, height, nation and place of birth.
- **Season:** goals and assists (saves and goals against for keepers) in large type first, then the other stats in plain words ("Starts", "Shots", "On target", "Yellow cards") instead of ESPN's codes ("STRT", "SOG", "YC").
- **This match:** adds the xG of the player's shots.
- **Recent form:** goal and assist chips only when there were any (no more "⚽0").
- **Career:** clubs newest first, the current one highlighted, loans marked.
- **All competitions:** a table of starts, goals, assists and yellow cards (saves and goals against for keepers), with the season year removed from competition names.

## News

- **Repeated headline prefixes removed:** "Transfer rumors, news:Transfer rumors, news: Nico Paz…" now reads "Transfer rumors, news: Nico Paz…".
- **Images that fail to load** show a card in the competition's colours with its name, instead of an empty box.

## Reliability

- **Error screens:** if a screen crashes, for example on unexpected data from a feed, only that screen shows "This screen hit a problem", with Try again and Go back. The rest of the app keeps working, and nothing is sent anywhere.
- **Code checks:** ESLint with Expo's rules (`npm run lint`). The checks for React hook mistakes found none. The cleanup removed unused code from Settings and other screens.
  - Three rules written for the React Compiler are switched off, because the app does not use it and they flag normal React Native patterns. The reason is noted in `mobile/eslint.config.js`.

## From 2.3.1 and 2.3.2

- **NBA predictions** use opponent-adjusted ratings, blended 70/30 with the previous model. On the 2025-26 test season, log loss improved from 0.6017 to 0.5981 and the hit rate from 67.9% to 68.5% ([Step 12](audit/STEP12_US_SPORTS.md)).
  - NHL and NFL were tested too. No candidate beat the current models on the test season, so they are unchanged.
- **NBA, NHL and NFL:** when ESPN lists a bookmaker line, 90% of the weight goes on it instead of two-thirds. This was better on both seasons in all three sports.
- **Line-ups:**
  - both teams on one pitch, with full markings;
  - player cards show the photo, or a shirt in the kit colours actually worn;
  - cards show the number, goals, assists, cards, substitution minute, saves and each player's xG;
  - substitutes are side by side, with who each one replaced.

## Checks

- **Tests:**
  - app: 106 passed;
  - pipeline: 81 passed;
  - engine: 37 passed;
  - backend: 71 passed and 2 skipped (they need Redis).
- **Type check and lint:** `tsc` passes, and lint gives 0 errors and 11 style warnings.
- **Checked in a browser (web build, phone size):**
  - player pages for Szoboszlai and Yoro with Wikidata facts;
  - news with images blocked;
  - an error screen forced by a test page that throws, removed afterwards.
- **Not checked on a phone or emulator in this release.**

Code:
- `pipeline/mkdata/wikifacts.py` with tests;
- `mobile/src/data/photos.ts` (`usePlayerFacts`);
- `mobile/src/app/player/[id].tsx`;
- `mobile/src/components/route-error.tsx`;
- `mobile/src/components/feed.tsx`;
- `mobile/src/data/more.ts` (`cleanHeadline`).
