# MK Sports 2.5

## Opening animation

- **What you see:** for about 1.5 seconds after the system splash screen:
  - the MK mark gathers and pops, with a green and cyan shockwave;
  - the ball over the K hops and bounces;
  - the mark lifts while "MK SPORTS" and "Scores · Predictions · Play" rise underneath;
  - then everything zooms through into the app.
- **No jump from the system splash:** the animation starts from exactly the system splash screen, with the same navy and the logo at the same size and place.
  - On the emulator, a frame captured during the animation's first move was the splash logo scaled by 0.9 about the screen centre, to within a few pixels. That is the "gather" step, so the two line up.
  - The system splash is hidden only after the animation's first frame has been drawn, so a slow phone never shows a blank screen in between.
- **It never makes you wait longer than needed:**
  - it plays while the app loads its settings and fonts;
  - it leaves as soon as the app is ready and the animation has played;
  - it plays once per launch, not when you come back to the app from the background.
- **Accessibility:** with Animations off in Settings, or the phone's reduce-motion setting on, the splash simply fades out.
- **Code:** `mobile/src/components/intro.tsx`. It is built from the logo's own shapes (`branding/mark.svg`), so it stays sharp on every screen.

## Light mode

**Before:** the headers faded dark colours into the light background, which gave muddy grey-blue and lavender washes. White text in the player, team and match headers faded out towards their bottom edge. Some accent text was too pale to read comfortably.

**Now:**
- **Cleaner backgrounds:** the top of each screen has a soft tint of the competition's colour on a cool off-white, so dark text stays crisp.
- **White cards with soft shadows:** the light cards are now solid white with a gentle shadow, instead of see-through glass. On Android a see-through card would show its own shadow through it. The shadow was checked on the emulator.
- **Deep headers keep white text readable:**
  - the Stats and competition headers, the player page and the team page stay deep in the competition's or team's colour;
  - the match page header keeps its colour to the bottom edge;
  - the content inside these headers (tabs, chips, buttons) uses the dark-mode colours, so it reads on them;
  - the status bar icons turn light on the player page.
- **Team headers for white or light-blue kits** (Fulham, Coventry, Manchester City) are darkened just enough for white text in both modes.
- **Readable colours:** every text colour in light mode reaches at least 4.5:1 contrast (WCAG AA) on the background and on white cards. A new test checks this. The greens, blues, golds and reds were darkened slightly; for example, green links went from 3.0:1 to 4.8:1.
- **Bright action cards:** "Call it" and Quick Picks keep their bright green-to-cyan look with dark text in light mode too. Before, light mode put dark text on dark green or purple.

**Both themes:** a faint line across every screen about 420 points down, where the background tint ended, is gone. The tint now fades out fully.

## Checks

- **Tests:**
  - app: 107 passed, including the new light-mode contrast test;
  - type check passes;
  - lint gives 0 errors and 10 style warnings.
- **Checked in a browser (web build, phone size):**
  - Home, Scores, Stats, News, the player page, the team page, a match page, My Team and Quick Picks, in light mode before and after the change;
  - the main screens in dark mode, to make sure nothing changed there apart from the fixed line;
  - the opening animation, recorded at 10 frames a second.
- **Checked on the Android emulator (Android 10, software graphics):**
  - the animation starts from the system splash in the same place and size;
  - the app opens to Home afterwards;
  - in light mode, Home shows white cards with clean shadows.
- **Limits of that check:** the emulator has no graphics acceleration and runs at a few frames a second, so it could not judge how smooth the animation is. That needs a real phone.
