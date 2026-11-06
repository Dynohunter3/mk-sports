Engine: MK Sports engine v2.1 (as shipped in app 1.4.1). Predictions scored: 21,176. Determinism hash: `69eecdefb137c36f`.


### By sport: current engine vs benchmarks (all matches)

| | Matches | Model acc | Model log loss | Model Brier | Always-home acc | Home-rate LL | Simple Elo acc | Simple Elo LL | Simple Elo Brier |
|---|---|---|---|---|---|---|---|---|---|
| football | 10,208 | 50.8% | 1.008 | 0.603 | 44.5% | 1.074 | 50.8% | 1.010 | 0.604 |
| basketball | 2,650 | 67.4% | 0.605 | 0.418 | 55.1% | 0.688 | 64.8% | 0.626 | 0.436 |
| american-football | 571 | 65.7% | 0.621 | 0.431 | 54.1% | 0.693 | 63.2% | 0.643 | 0.452 |
| ice-hockey | 2,799 | 56.4% | 0.679 | 0.486 | 54.1% | 0.690 | 56.6% | 0.684 | 0.490 |
| baseball | 4,948 | 56.2% | 0.682 | 0.489 | 53.6% | 0.691 | 54.8% | 0.690 | 0.497 |

### By sport: current engine vs bookmaker closing odds (same matches)

| | Matches with odds | Coverage | Model acc | Bookmaker acc | Model LL | Bookmaker LL | LL gap | Model Brier | Bookmaker Brier | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| football | 10,078 | 98.7% | 50.8% | 54.5% | 1.008 | 0.959 | 0.050 | 0.603 | 0.570 | ESPN (ESPN BET); Pinnacle closing |
| basketball | 2,645 | 99.8% | 67.4% | 68.7% | 0.605 | 0.581 | 0.024 | 0.417 | 0.398 | ESPN (ESPN BET); ESPN (DraftKings) |
| american-football | 568 | 99.5% | 65.5% | 68.0% | 0.621 | 0.599 | 0.022 | 0.432 | 0.413 | ESPN (ESPN BET); ESPN (DraftKings) |
| ice-hockey | 2,799 | 100.0% | 56.4% | 58.3% | 0.679 | 0.669 | 0.010 | 0.486 | 0.476 | ESPN (ESPN BET); ESPN (DraftKings) |
| baseball | 4,948 | 100.0% | 56.2% | 57.0% | 0.682 | 0.678 | 0.004 | 0.489 | 0.485 | ESPN (ESPN BET); ESPN (DraftKings) |

### By league: current engine vs benchmarks (all matches)

| | Matches | Model acc | Model log loss | Model Brier | Always-home acc | Home-rate LL | Simple Elo acc | Simple Elo LL | Simple Elo Brier |
|---|---|---|---|---|---|---|---|---|---|
| Premier League | 760 | 49.5% | 1.022 | 0.613 | 41.7% | 1.085 | 48.8% | 1.034 | 0.621 |
| LaLiga | 760 | 52.0% | 0.998 | 0.595 | 46.7% | 1.062 | 52.9% | 0.997 | 0.592 |
| Champions League | 378 | 58.2% | 0.940 | 0.553 | 50.5% | 1.014 | 55.0% | 0.938 | 0.552 |
| Europa League | 378 | 52.4% | 1.011 | 0.604 | 50.3% | 1.033 | 51.6% | 1.005 | 0.601 |
| Conference League | 306 | 51.0% | 1.027 | 0.616 | 50.0% | 1.040 | 52.0% | 1.011 | 0.605 |
| Serie A | 760 | 51.6% | 1.001 | 0.599 | 39.3% | 1.091 | 51.4% | 1.007 | 0.603 |
| Bundesliga | 612 | 51.1% | 1.014 | 0.606 | 41.2% | 1.084 | 51.8% | 1.010 | 0.602 |
| Ligue 1 | 611 | 52.0% | 0.995 | 0.594 | 46.5% | 1.060 | 52.2% | 0.994 | 0.592 |
| Eredivisie | 618 | 51.3% | 0.994 | 0.592 | 45.3% | 1.070 | 52.1% | 0.992 | 0.591 |
| Liga Portugal | 612 | 55.6% | 0.966 | 0.574 | 42.2% | 1.084 | 53.6% | 0.974 | 0.581 |
| Süper Lig | 648 | 52.9% | 0.987 | 0.587 | 45.5% | 1.074 | 54.8% | 0.989 | 0.589 |
| Saudi Pro League | 612 | 53.9% | 0.946 | 0.560 | 44.0% | 1.061 | 56.0% | 0.947 | 0.561 |
| MLS | 1,064 | 47.2% | 1.052 | 0.634 | 44.6% | 1.072 | 48.5% | 1.050 | 0.630 |
| Championship | 1,114 | 44.8% | 1.059 | 0.640 | 43.6% | 1.079 | 44.8% | 1.057 | 0.638 |
| FA Cup | 246 | 48.8% | 1.026 | 0.615 | 45.1% | 1.020 | 50.0% | 0.993 | 0.599 |
| EFL Cup | 186 | 46.2% | 1.020 | 0.612 | 44.1% | 1.056 | 47.3% | 1.033 | 0.621 |
| CAF Champions League | 124 | 48.4% | 1.022 | 0.615 | 49.2% | 1.044 | 44.4% | 1.035 | 0.628 |
| AFCON | 104 | 51.0% | 1.018 | 0.609 | 41.3% | 1.678 | 50.0% | 1.100 | 0.657 |
| World Cup 2026 | 104 | 51.0% | 1.045 | 0.630 | 48.1% | 1.085 | 41.3% | 1.081 | 0.655 |
| WC qualifying (Africa) | 211 | 55.5% | 0.999 | 0.596 | 44.1% | 1.069 | 46.0% | 1.021 | 0.612 |
| NBA | 2,650 | 67.4% | 0.605 | 0.418 | 55.1% | 0.688 | 64.8% | 0.626 | 0.436 |
| NFL | 571 | 65.7% | 0.621 | 0.431 | 54.1% | 0.693 | 63.2% | 0.643 | 0.452 |
| NHL | 2,799 | 56.4% | 0.679 | 0.486 | 54.1% | 0.690 | 56.6% | 0.684 | 0.490 |
| MLB | 4,948 | 56.2% | 0.682 | 0.489 | 53.6% | 0.691 | 54.8% | 0.690 | 0.497 |

### By league: current engine vs bookmaker closing odds (same matches)

| | Matches with odds | Coverage | Model acc | Bookmaker acc | Model LL | Bookmaker LL | LL gap | Model Brier | Bookmaker Brier | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 760 | 100.0% | 49.5% | 52.0% | 1.022 | 0.990 | 0.031 | 0.613 | 0.592 | Pinnacle closing; market average closing |
| LaLiga | 760 | 100.0% | 52.0% | 55.4% | 0.998 | 0.956 | 0.043 | 0.595 | 0.565 | Pinnacle closing; market average closing |
| Champions League | 378 | 100.0% | 58.2% | 60.6% | 0.940 | 0.891 | 0.049 | 0.553 | 0.521 | ESPN (ESPN BET); ESPN (DraftKings) |
| Europa League | 378 | 100.0% | 52.4% | 57.9% | 1.011 | 0.953 | 0.058 | 0.604 | 0.562 | ESPN (ESPN BET); ESPN (DraftKings) |
| Conference League | 301 | 98.4% | 50.8% | 58.8% | 1.028 | 0.945 | 0.083 | 0.617 | 0.557 | ESPN (ESPN BET); ESPN (DraftKings) |
| Serie A | 760 | 100.0% | 51.6% | 54.2% | 1.001 | 0.965 | 0.036 | 0.599 | 0.575 | Pinnacle closing; market average closing |
| Bundesliga | 610 | 99.7% | 51.3% | 54.6% | 1.014 | 0.969 | 0.045 | 0.605 | 0.576 | Pinnacle closing; market average closing |
| Ligue 1 | 611 | 100.0% | 52.0% | 54.5% | 0.995 | 0.966 | 0.030 | 0.594 | 0.573 | Pinnacle closing; market average closing |
| Eredivisie | 612 | 99.0% | 51.0% | 54.2% | 0.996 | 0.958 | 0.039 | 0.594 | 0.569 | Pinnacle closing; market average closing |
| Liga Portugal | 612 | 100.0% | 55.6% | 56.5% | 0.966 | 0.913 | 0.053 | 0.574 | 0.540 | Pinnacle closing; market average closing |
| Süper Lig | 648 | 100.0% | 52.9% | 58.2% | 0.987 | 0.940 | 0.047 | 0.587 | 0.556 | Pinnacle closing; market average closing |
| Saudi Pro League | 606 | 99.0% | 54.0% | 59.6% | 0.945 | 0.887 | 0.058 | 0.560 | 0.520 | ESPN (ESPN BET); ESPN (DraftKings) |
| MLS | 1,061 | 99.7% | 47.3% | 48.1% | 1.052 | 1.027 | 0.025 | 0.633 | 0.616 | Pinnacle closing; market average closing |
| Championship | 1,104 | 99.1% | 44.9% | 47.1% | 1.057 | 1.033 | 0.024 | 0.639 | 0.622 | Pinnacle closing; market average closing |
| FA Cup | 215 | 87.4% | 50.2% | 62.8% | 1.018 | 0.878 | 0.139 | 0.610 | 0.510 | ESPN (ESPN BET); ESPN (DraftKings) |
| EFL Cup | 185 | 99.5% | 46.5% | 58.9% | 1.018 | 0.906 | 0.112 | 0.611 | 0.534 | ESPN (ESPN BET); ESPN (DraftKings) |
| CAF Champions League | 75 | 60.5% | 45.3% | 42.7% | 1.056 | 0.994 | 0.063 | 0.637 | 0.598 | ESPN (ESPN BET); ESPN (DraftKings) |
| AFCON | 104 | 100.0% | 51.0% | 56.7% | 1.018 | 0.910 | 0.108 | 0.609 | 0.542 | ESPN (ESPN BET); ESPN (DraftKings) |
| World Cup 2026 | 104 | 100.0% | 51.0% | 68.3% | 1.045 | 0.802 | 0.243 | 0.630 | 0.467 | ESPN (DraftKings) |
| WC qualifying (Africa) | 194 | 91.9% | 54.1% | 61.3% | 1.005 | 0.806 | 0.199 | 0.600 | 0.469 | ESPN (ESPN BET) |
| NBA | 2,645 | 99.8% | 67.4% | 68.7% | 0.605 | 0.581 | 0.024 | 0.417 | 0.398 | ESPN (ESPN BET); ESPN (DraftKings) |
| NFL | 568 | 99.5% | 65.5% | 68.0% | 0.621 | 0.599 | 0.022 | 0.432 | 0.413 | ESPN (ESPN BET); ESPN (DraftKings) |
| NHL | 2,799 | 100.0% | 56.4% | 58.3% | 0.679 | 0.669 | 0.010 | 0.486 | 0.476 | ESPN (ESPN BET); ESPN (DraftKings) |
| MLB | 4,948 | 100.0% | 56.2% | 57.0% | 0.682 | 0.678 | 0.004 | 0.489 | 0.485 | ESPN (ESPN BET); ESPN (DraftKings) |

### Calibration of the current engine, by sport (all outcome probabilities pooled)


**football**: expected calibration error 0.009 (bookmaker 0.009)

| Predicted | n | Model said | Happened | Bookmaker said | Happened |
|---|---|---|---|---|---|
| 0-10% | 346 | 7.9% | 6.9% | 7.4% | 4.2% |
| 10-20% | 3,225 | 16.3% | 16.5% | 15.7% | 14.3% |
| 20-30% | 12,202 | 25.4% | 24.5% | 25.6% | 25.2% |
| 30-40% | 6,646 | 34.3% | 33.9% | 34.1% | 34.3% |
| 40-50% | 4,137 | 44.6% | 46.4% | 44.7% | 45.5% |
| 50-60% | 2,437 | 54.4% | 55.5% | 54.7% | 55.8% |
| 60-70% | 1,110 | 64.3% | 66.8% | 64.6% | 65.2% |
| 70-80% | 442 | 73.8% | 74.7% | 74.5% | 79.3% |
| 80-90% | 76 | 82.9% | 84.2% | 83.7% | 89.3% |
| 90-100% | 3 | 90.3% | 100.0% | 91.7% | 100.0% |

**basketball**: expected calibration error 0.013 (bookmaker 0.010)

| Predicted | n | Model said | Happened | Bookmaker said | Happened |
|---|---|---|---|---|---|
| 0-10% | 54 | 7.7% | 9.3% | 8.2% | 1.3% |
| 10-20% | 289 | 15.9% | 16.6% | 15.5% | 15.0% |
| 20-30% | 587 | 25.3% | 22.8% | 25.4% | 24.7% |
| 30-40% | 798 | 35.4% | 34.6% | 35.1% | 36.7% |
| 40-50% | 922 | 44.9% | 43.6% | 44.6% | 44.9% |
| 50-60% | 922 | 55.1% | 56.4% | 55.2% | 54.9% |
| 60-70% | 798 | 64.6% | 65.4% | 64.9% | 63.3% |
| 70-80% | 587 | 74.7% | 77.2% | 74.7% | 75.2% |
| 80-90% | 289 | 84.1% | 83.4% | 84.6% | 85.4% |
| 90-100% | 54 | 92.3% | 90.7% | 91.8% | 98.7% |

**american-football**: expected calibration error 0.030 (bookmaker 0.020)

| Predicted | n | Model said | Happened | Bookmaker said | Happened |
|---|---|---|---|---|---|
| 0-10% | 16 | 7.8% | 12.5% | 8.6% | 0.0% |
| 10-20% | 69 | 15.6% | 21.7% | 15.5% | 7.0% |
| 20-30% | 111 | 25.3% | 28.8% | 25.9% | 25.7% |
| 30-40% | 173 | 35.2% | 31.2% | 35.3% | 33.5% |
| 40-50% | 202 | 45.2% | 46.0% | 44.1% | 42.7% |
| 50-60% | 202 | 54.8% | 54.0% | 55.5% | 56.8% |
| 60-70% | 172 | 64.8% | 68.6% | 64.7% | 66.5% |
| 70-80% | 112 | 74.7% | 71.4% | 74.1% | 74.5% |
| 80-90% | 69 | 84.4% | 78.3% | 84.6% | 92.9% |
| 90-100% | 16 | 92.2% | 87.5% | 91.4% | 100.0% |

**ice-hockey**: expected calibration error 0.011 (bookmaker 0.013)

| Predicted | n | Model said | Happened | Bookmaker said | Happened |
|---|---|---|---|---|---|
| 10-20% | 1 | 17.0% | 0.0% | 19.4% | 0.0% |
| 20-30% | 79 | 27.5% | 22.8% | 26.9% | 22.7% |
| 30-40% | 666 | 36.3% | 36.9% | 36.1% | 36.5% |
| 40-50% | 2,048 | 45.5% | 46.5% | 44.7% | 46.1% |
| 50-60% | 2,056 | 54.5% | 53.5% | 54.9% | 53.6% |
| 60-70% | 667 | 63.7% | 63.0% | 63.9% | 63.5% |
| 70-80% | 80 | 72.5% | 77.5% | 73.1% | 77.3% |
| 80-90% | 1 | 83.0% | 100.0% | 80.6% | 100.0% |

**baseball**: expected calibration error 0.008 (bookmaker 0.008)

| Predicted | n | Model said | Happened | Bookmaker said | Happened |
|---|---|---|---|---|---|
| 20-30% | 18 | 28.4% | 16.7% | 27.7% | 22.8% |
| 30-40% | 656 | 37.1% | 35.7% | 36.3% | 37.0% |
| 40-50% | 4,268 | 45.8% | 45.2% | 45.1% | 45.9% |
| 50-60% | 4,278 | 54.2% | 54.8% | 54.5% | 53.8% |
| 60-70% | 658 | 62.9% | 64.1% | 63.7% | 63.0% |
| 70-80% | 18 | 71.6% | 83.3% | 72.3% | 77.2% |

### Root-cause measurements

| | Cold-start share (<5 games) | LL warm | LL cold | Cross-league LL model | Cross-league LL bookmaker | LL full history | LL 400-day window | Mean drift 365 vs 400-day window (P home) |
|---|---|---|---|---|---|---|---|---|
| football | 10.0% | 1.007 | 1.022 | 0.972 | 0.925 | 1.005 | 1.008 | 0.3% |
| basketball | 0.3% | 0.605 | 0.641 | – | – | 0.605 | 0.605 | 0.1% |
| american-football | 0.4% | 0.621 | 0.569 | – | – | 0.621 | 0.621 | 0.1% |
| ice-hockey | 0.4% | 0.678 | 0.716 | – | – | 0.679 | 0.678 | 0.5% |
| baseball | 0.0% | 0.682 | 0.701 | – | – | 0.681 | 0.682 | 0.3% |
| Premier League | 0.0% | 1.022 | – | 0.931 | 0.900 | 1.020 | 1.022 | 0.2% |
| LaLiga | 3.4% | 1.000 | 0.958 | – | – | 0.996 | 0.997 | 0.2% |
| Champions League | 1.3% | 0.943 | 0.719 | 0.982 | 0.962 | 0.933 | 0.938 | 0.5% |
| Europa League | 12.2% | 1.013 | 1.001 | 1.056 | 0.977 | 1.006 | 1.010 | 0.6% |
| Conference League | 43.8% | 1.033 | 1.020 | 1.022 | 0.937 | 1.020 | 1.026 | 0.7% |
| Serie A | 3.8% | 0.999 | 1.058 | – | – | 0.998 | 1.000 | 0.2% |
| Bundesliga | 3.3% | 1.013 | 1.055 | – | – | 1.013 | 1.014 | 0.2% |
| Ligue 1 | 4.7% | 0.997 | 0.963 | – | – | 0.992 | 0.995 | 0.2% |
| Eredivisie | 4.5% | 0.988 | 1.123 | – | – | 0.990 | 0.994 | 0.2% |
| Liga Portugal | 3.6% | 0.968 | 0.915 | – | – | 0.962 | 0.965 | 0.3% |
| Süper Lig | 4.3% | 0.986 | 1.014 | – | – | 0.984 | 0.987 | 0.2% |
| Saudi Pro League | 4.7% | 0.947 | 0.935 | – | – | 0.942 | 0.945 | 0.3% |
| MLS | 0.7% | 1.051 | 1.310 | – | – | 1.052 | 1.052 | 0.2% |
| Championship | 0.8% | 1.058 | 1.129 | 0.951 | 0.935 | 1.058 | 1.058 | 0.2% |
| FA Cup | 58.5% | 1.049 | 1.009 | 0.932 | 0.800 | 1.017 | 1.023 | 0.6% |
| EFL Cup | 50.0% | 0.987 | 1.054 | 0.837 | 0.659 | 1.012 | 1.016 | 0.7% |
| CAF Champions League | 53.2% | 1.022 | 1.022 | – | – | 1.008 | 1.016 | 1.0% |
| AFCON | 36.5% | 0.953 | 1.130 | – | – | 1.010 | 1.018 | 0.0% |
| World Cup 2026 | 92.3% | 0.987 | 1.050 | – | – | 1.051 | 1.045 | 0.0% |
| WC qualifying (Africa) | 80.6% | 0.997 | 0.999 | – | – | 0.970 | 0.999 | 0.0% |
| NBA | 0.3% | 0.605 | 0.641 | – | – | 0.605 | 0.605 | 0.1% |
| NFL | 0.4% | 0.621 | 0.569 | – | – | 0.621 | 0.621 | 0.1% |
| NHL | 0.4% | 0.678 | 0.716 | – | – | 0.679 | 0.678 | 0.5% |
| MLB | 0.0% | 0.682 | 0.701 | – | – | 0.681 | 0.682 | 0.3% |

Window-start shift (history window starting 7 days later, same match):

- football: mean |ΔP(home)| 0.1%, 90th pct 0.3%, max 2.2%, favourite flips 0.7% (n=409)
- basketball: mean |ΔP(home)| 0.1%, 90th pct 0.1%, max 0.3%, favourite flips 0.0% (n=442)
- american-football: mean |ΔP(home)| 0.1%, 90th pct 0.3%, max 0.5%, favourite flips 0.0% (n=571)
- ice-hockey: mean |ΔP(home)| 0.3%, 90th pct 0.5%, max 1.2%, favourite flips 1.9% (n=467)
- baseball: mean |ΔP(home)| 0.1%, 90th pct 0.3%, max 0.4%, favourite flips 0.0% (n=413)

Draws (football):

- engine picks a draw as the most likely result in 0.6% of matches; draws happened in 24.3%; mean draw probability 25.5%

Mean Elo by domestic league at the end of the data (every team starts at 1500):

- Premier League: 1606
- MLS: 1500
- Bundesliga: 1495
- Serie A: 1490
- LaLiga: 1489
- Ligue 1: 1488
- Championship: 1486
- Saudi Pro League: 1482
- Liga Portugal: 1479
- Süper Lig: 1474
- Eredivisie: 1471

football-data.co.uk matching:

- Premier League: 1,140 of 1,140 rows matched to ESPN matches
- Championship: 1,656 of 1,656 rows matched to ESPN matches
- LaLiga: 1,140 of 1,140 rows matched to ESPN matches
- Serie A: 1,140 of 1,140 rows matched to ESPN matches
- Bundesliga: 914 of 918 rows matched to ESPN matches
- Ligue 1: 917 of 918 rows matched to ESPN matches
- Eredivisie: 918 of 918 rows matched to ESPN matches
- Liga Portugal: 918 of 918 rows matched to ESPN matches
- Süper Lig: 1,028 of 1,028 rows matched to ESPN matches
- MLS: 1,798 of 6,311 rows matched to ESPN matches
