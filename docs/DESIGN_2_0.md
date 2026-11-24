# MK Sports 2.0 "Matchday": design system

The 2.0 overhaul makes the app lively and game-like while keeping every feature of 1.8.

## Look

- **Type:** Barlow Condensed (SIL Open Font License) is the display face. It is used for titles, headings, labels, scores and big numbers, through the `hero`, `score`, `display`, `title`, `h2` and `label` text variants. Body text stays on the system font.
  - Only three weights are bundled (about 315 KB).
  - Display variants drop any `fontWeight` passed to them, because Android cannot combine a custom font family with a weight.
- **Colour:**
  - Base: the existing dark navy and electric green.
  - Expressive accents: `hot`, `violet` and `gold`, in both themes.
  - Teams' own colours drive the match cards, probability bars and match header. `readable()` lifts very dark kits on the dark theme and tones very light ones on the light theme. `matchColors()` swaps a clashing away colour for a contrasting palette colour.
- **Surfaces:** glass cards remain. Hero moments use bold gradients:
  - Quick Picks: green → cyan → violet;
  - results: gold → pink;
  - level: violet → pink;
  - match header: a diagonal split in the two teams' colours with a "VS" watermark.

## Motion and feel (`src/components/motion.tsx`)

Built on React Native's own Animated API, with no extra native library. Transforms and opacity run on the native driver.

| Piece | Used for |
|---|---|
| `PressableScale` | every card, button and chip dips and springs back, with a light haptic tap |
| `FadeIn` + `stagger(i)` | lists and sections rise into place |
| `Pop` | badges, toasts, celebration cards |
| `Float` | idle bob on crests and empty-state icons |
| `CountUp` | percentages, points, you-vs-AI score |
| `useGrow` | probability bars and the level ring fill in |
| `PulseDot` | live matches |
| `Skeleton` / `BouncingBall` | loading (no spinners) |
| `Confetti` | results that came in, badges, the end of a Quick Picks deck |
| `haptic` | tap, select, thud, success, warning |

- Settings has **Animations** and **Vibration** switches.
- The system's reduce-motion setting is also respected.
- With motion off, everything appears in its final state.

## The game

- **Quick Picks** (`/play`): a deck of upcoming matches with a prediction.
  - Swipe left for the home team, right for the away team, up for a draw, down to skip; buttons do the same.
  - After each call the AI's call is revealed, with a 5-second undo.
  - Picks go through the same free-to-play pick API as the match page.
- **Levels:** Rookie (0 points), Amateur (10), Semi-pro (25), Pro (50), Star (90), Captain (140), Legend (210), Icon (300), GOAT (420).
- **You vs the AI:** every settled pick where the AI had a call. It counts how often each was right, and how often one was right when the other was wrong.
- **Results are in:** settled picks the player has not seen yet are celebrated once on Home, with confetti when any were right. Dismissing it, or opening My game from it, marks them seen.
- **My game** (`/leaderboard` in device mode): level ring, you vs the AI, streak, accuracy, exact scores, the badge cabinet, recent results and points by week.

Still free to play: no money, no prizes, and predictions are for entertainment only. The responsible-use notice is unchanged on onboarding and in the footers.

## Previewing

`npx expo export --platform web` builds a web version. It can be screenshotted at phone size in headless Chromium. Android was checked on an emulator before release.
