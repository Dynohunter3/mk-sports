Evaluation matches: 7,740. Seed 42. Prediction hash `0f2e6d1142341db2`.

### Feature groups added one at a time (boosted model, selection season 2024-25)

| Step | Added | Selection log loss | Selection Brier | Kept |
|---|---|---|---|---|
| 1 | elo+context | 0.9938 | 0.5929 | yes |
| 2 | dc | 0.9929 | 0.5924 | yes |
| 3 | xg_proxy | 0.9895 | 0.5905 | yes |
| 4 | pi | 0.9898 | 0.5907 | no |
| 5 | form | 0.9893 | 0.5900 | yes |
| 6 | draw | 0.9889 | 0.5902 | yes |
| 7 | market_pre | 0.9778 | 0.5826 | yes |

### All models, all leagues — Selection season (2024-25; MLS 2024)

| Model | n | Accuracy | Log loss | Brier | ECE | LL gap to closing odds |
|---|---|---|---|---|---|---|
| current engine v2 | 3,973 | 50.9% | 1.0035 | 0.5997 | 0.008 | 0.0360 |
| league base rate | 3,937 | 44.2% | 1.0706 | 0.6478 | 0.004 | 0.1026 |
| bookmaker pre-closing (Tue/Fri) | 3,258 | 53.6% | 0.9655 | 0.5743 | 0.010 | 0.0040 |
| bookmaker closing | 3,780 | 53.3% | 0.9709 | 0.5781 | 0.008 | 0.0000 |
| elo (ordered logit) | 3,973 | 51.5% | 0.9921 | 0.5922 | 0.006 | 0.0245 |
| dixon-coles | 3,847 | 51.3% | 1.0003 | 0.5968 | 0.010 | 0.0294 |
| dixon-coles xg-proxy | 3,263 | 52.6% | 0.9901 | 0.5904 | 0.020 | 0.0284 |
| gbm[elo+context] | 3,973 | 52.2% | 0.9938 | 0.5929 | 0.013 | 0.0272 |
| gbm[elo+context+dc] | 3,973 | 52.1% | 0.9929 | 0.5924 | 0.011 | 0.0257 |
| gbm[elo+context+dc+xg_proxy] | 3,973 | 51.8% | 0.9895 | 0.5905 | 0.011 | 0.0216 |
| gbm[elo+context+dc+xg_proxy+pi] | 3,973 | 52.0% | 0.9898 | 0.5907 | 0.012 | 0.0216 |
| gbm[elo+context+dc+xg_proxy+form] | 3,973 | 52.0% | 0.9893 | 0.5900 | 0.009 | 0.0218 |
| gbm[elo+context+dc+xg_proxy+form+draw] | 3,973 | 51.8% | 0.9889 | 0.5902 | 0.008 | 0.0211 |
| gbm[elo+context+dc+xg_proxy+form+draw+market_pre] | 3,973 | 52.9% | 0.9778 | 0.5826 | 0.006 | 0.0092 |
| ensemble (no market) | 3,973 | 52.2% | 0.9859 | 0.5882 | 0.005 | 0.0188 |
| ensemble + market | 3,973 | 52.8% | 0.9747 | 0.5807 | 0.007 | 0.0062 |
| ensemble (no market) + calibration | 3,973 | 52.1% | 0.9856 | 0.5880 | 0.006 | 0.0184 |
| ensemble + market + calibration | 3,973 | 52.6% | 0.9748 | 0.5810 | 0.007 | 0.0057 |
| final (market ensemble when pre-match odds exist, else calibrated no-market ensemble) | 3,973 | 53.0% | 0.9736 | 0.5795 | 0.010 | 0.0057 |

### All models, all leagues — Test season (2025-26; MLS 2025) — never used for a decision

| Model | n | Accuracy | Log loss | Brier | ECE | LL gap to closing odds |
|---|---|---|---|---|---|---|
| current engine v2 | 3,767 | 48.8% | 1.0229 | 0.6134 | 0.005 | 0.0357 |
| league base rate | 3,767 | 43.3% | 1.0794 | 0.6533 | 0.010 | 0.0925 |
| bookmaker pre-closing (Tue/Fri) | 3,222 | 52.4% | 0.9817 | 0.5855 | 0.012 | 0.0014 |
| bookmaker closing | 3,762 | 52.3% | 0.9867 | 0.5890 | 0.010 | 0.0000 |
| elo (ordered logit) | 3,767 | 50.3% | 1.0062 | 0.6017 | 0.012 | 0.0191 |
| dixon-coles | 3,767 | 50.1% | 1.0149 | 0.6039 | 0.014 | 0.0278 |
| dixon-coles xg-proxy | 3,227 | 50.1% | 1.0043 | 0.6003 | 0.013 | 0.0236 |
| gbm[elo+context] | 3,767 | 50.0% | 1.0107 | 0.6046 | 0.014 | 0.0235 |
| gbm[elo+context+dc] | 3,767 | 50.3% | 1.0077 | 0.6025 | 0.011 | 0.0206 |
| gbm[elo+context+dc+xg_proxy] | 3,767 | 50.0% | 1.0035 | 0.6000 | 0.012 | 0.0164 |
| gbm[elo+context+dc+xg_proxy+pi] | 3,767 | 50.0% | 1.0028 | 0.5996 | 0.015 | 0.0157 |
| gbm[elo+context+dc+xg_proxy+form] | 3,767 | 50.4% | 1.0035 | 0.5997 | 0.012 | 0.0164 |
| gbm[elo+context+dc+xg_proxy+form+draw] | 3,767 | 49.6% | 1.0031 | 0.5997 | 0.011 | 0.0160 |
| gbm[elo+context+dc+xg_proxy+form+draw+market_pre] | 3,767 | 51.3% | 0.9940 | 0.5937 | 0.009 | 0.0069 |
| ensemble (no market) | 3,767 | 50.4% | 1.0010 | 0.5983 | 0.008 | 0.0139 |
| ensemble + market | 3,767 | 51.6% | 0.9919 | 0.5924 | 0.007 | 0.0048 |
| ensemble (no market) + calibration | 3,767 | 50.4% | 1.0012 | 0.5985 | 0.008 | 0.0141 |
| ensemble + market + calibration | 3,767 | 51.6% | 0.9920 | 0.5925 | 0.010 | 0.0048 |
| final (market ensemble when pre-match odds exist, else calibrated no-market ensemble) | 3,767 | 52.0% | 0.9908 | 0.5917 | 0.007 | 0.0036 |

### All models, all leagues — Both seasons

| Model | n | Accuracy | Log loss | Brier | ECE | LL gap to closing odds |
|---|---|---|---|---|---|---|
| current engine v2 | 7,740 | 49.9% | 1.0129 | 0.6064 | 0.003 | 0.0358 |
| league base rate | 7,704 | 43.8% | 1.0749 | 0.6505 | 0.007 | 0.0976 |
| bookmaker pre-closing (Tue/Fri) | 6,480 | 53.0% | 0.9736 | 0.5799 | 0.008 | 0.0027 |
| bookmaker closing | 7,542 | 52.8% | 0.9788 | 0.5835 | 0.006 | 0.0000 |
| elo (ordered logit) | 7,740 | 50.9% | 0.9989 | 0.5968 | 0.006 | 0.0218 |
| dixon-coles | 7,614 | 50.7% | 1.0075 | 0.6003 | 0.011 | 0.0286 |
| dixon-coles xg-proxy | 6,490 | 51.3% | 0.9972 | 0.5953 | 0.014 | 0.0260 |
| gbm[elo+context] | 7,740 | 51.1% | 1.0020 | 0.5986 | 0.012 | 0.0254 |
| gbm[elo+context+dc] | 7,740 | 51.2% | 1.0001 | 0.5973 | 0.010 | 0.0232 |
| gbm[elo+context+dc+xg_proxy] | 7,740 | 50.9% | 0.9963 | 0.5951 | 0.011 | 0.0190 |
| gbm[elo+context+dc+xg_proxy+pi] | 7,740 | 51.0% | 0.9961 | 0.5951 | 0.011 | 0.0187 |
| gbm[elo+context+dc+xg_proxy+form] | 7,740 | 51.2% | 0.9962 | 0.5948 | 0.009 | 0.0191 |
| gbm[elo+context+dc+xg_proxy+form+draw] | 7,740 | 50.7% | 0.9958 | 0.5948 | 0.008 | 0.0185 |
| gbm[elo+context+dc+xg_proxy+form+draw+market_pre] | 7,740 | 52.1% | 0.9857 | 0.5880 | 0.007 | 0.0081 |
| ensemble (no market) | 7,740 | 51.3% | 0.9932 | 0.5931 | 0.004 | 0.0163 |
| ensemble + market | 7,740 | 52.2% | 0.9831 | 0.5864 | 0.004 | 0.0055 |
| ensemble (no market) + calibration | 7,740 | 51.2% | 0.9932 | 0.5931 | 0.003 | 0.0162 |
| ensemble + market + calibration | 7,740 | 52.1% | 0.9831 | 0.5866 | 0.007 | 0.0053 |
| final (market ensemble when pre-match odds exist, else calibrated no-market ensemble) | 7,740 | 52.5% | 0.9819 | 0.5854 | 0.005 | 0.0047 |

### Per league, selection: current engine v2 vs `final (market ensemble when pre-match odds exist, else calibrated no-market ensemble)`

| League | n | v2 log loss | new log loss | Δ LL | v2 Brier | new Brier | Δ Brier | new acc | new gap to closing | closing LL |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 380 | 1.0032 | 0.9705 | -0.0327 | 0.6014 | 0.5791 | -0.0224 | 54.5% | 0.0041 | 0.9664 |
| Championship | 557 | 1.0513 | 1.0295 | -0.0218 | 0.6352 | 0.6195 | -0.0157 | 47.4% | 0.0011 | 1.0274 |
| LaLiga | 380 | 0.9921 | 0.9520 | -0.0401 | 0.5917 | 0.5628 | -0.0288 | 54.7% | 0.0057 | 0.9463 |
| Ligue 1 | 306 | 0.9854 | 0.9595 | -0.0259 | 0.5868 | 0.5673 | -0.0195 | 54.6% | 0.0044 | 0.9550 |
| Bundesliga | 306 | 1.0401 | 0.9903 | -0.0498 | 0.6240 | 0.5906 | -0.0334 | 52.3% | 0.0021 | 0.9882 |
| Serie A | 380 | 0.9888 | 0.9497 | -0.0391 | 0.5922 | 0.5656 | -0.0266 | 53.2% | -0.0016 | 0.9513 |
| Eredivisie | 306 | 0.9822 | 0.9470 | -0.0352 | 0.5836 | 0.5630 | -0.0206 | 53.9% | 0.0094 | 0.9376 |
| Liga Portugal | 306 | 0.9742 | 0.9316 | -0.0426 | 0.5773 | 0.5520 | -0.0252 | 56.5% | 0.0077 | 0.9239 |
| Süper Lig | 342 | 0.9598 | 0.9186 | -0.0412 | 0.5674 | 0.5395 | -0.0279 | 59.6% | 0.0035 | 0.9150 |
| Champions League | 188 | 0.9288 | 0.9085 | -0.0203 | 0.5443 | 0.5318 | -0.0125 | 60.1% | – | – |
| MLS | 522 | 1.0459 | 1.0475 | +0.0017 | 0.6292 | 0.6293 | +0.0001 | 46.6% | 0.0180 | 1.0296 |
| All leagues | 3,973 | 1.0035 | 0.9736 | -0.0299 | 0.5997 | 0.5795 | -0.0202 | 53.0% | 0.0057 | 0.9709 |

### Per league, test: current engine v2 vs `final (market ensemble when pre-match odds exist, else calibrated no-market ensemble)`

| League | n | v2 log loss | new log loss | Δ LL | v2 Brier | new Brier | Δ Brier | new acc | new gap to closing | closing LL |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 380 | 1.0421 | 1.0197 | -0.0224 | 0.6271 | 0.6131 | -0.0140 | 48.9% | 0.0058 | 1.0139 |
| Championship | 557 | 1.0691 | 1.0429 | -0.0262 | 0.6466 | 0.6287 | -0.0178 | 45.6% | 0.0009 | 1.0395 |
| LaLiga | 380 | 1.0071 | 0.9661 | -0.0410 | 0.6007 | 0.5726 | -0.0281 | 53.7% | 0.0011 | 0.9650 |
| Ligue 1 | 306 | 1.0143 | 0.9711 | -0.0433 | 0.6080 | 0.5786 | -0.0293 | 54.2% | -0.0063 | 0.9774 |
| Bundesliga | 306 | 0.9911 | 0.9515 | -0.0396 | 0.5892 | 0.5616 | -0.0276 | 56.5% | 0.0012 | 0.9503 |
| Serie A | 380 | 1.0153 | 0.9804 | -0.0349 | 0.6078 | 0.5838 | -0.0240 | 54.2% | 0.0028 | 0.9777 |
| Eredivisie | 306 | 1.0049 | 0.9752 | -0.0297 | 0.5999 | 0.5798 | -0.0201 | 52.3% | -0.0024 | 0.9776 |
| Liga Portugal | 306 | 0.9509 | 0.9116 | -0.0393 | 0.5655 | 0.5390 | -0.0265 | 56.9% | 0.0096 | 0.9020 |
| Süper Lig | 306 | 1.0101 | 0.9634 | -0.0467 | 0.6048 | 0.5757 | -0.0291 | 54.9% | -0.0040 | 0.9674 |
| MLS | 540 | 1.0592 | 1.0438 | -0.0154 | 0.6386 | 0.6274 | -0.0112 | 49.3% | 0.0186 | 1.0252 |
| All leagues | 3,767 | 1.0229 | 0.9908 | -0.0321 | 0.6134 | 0.5917 | -0.0217 | 52.0% | 0.0036 | 0.9867 |

### Per league, both: current engine v2 vs `final (market ensemble when pre-match odds exist, else calibrated no-market ensemble)`

| League | n | v2 log loss | new log loss | Δ LL | v2 Brier | new Brier | Δ Brier | new acc | new gap to closing | closing LL |
|---|---|---|---|---|---|---|---|---|---|---|
| Premier League | 760 | 1.0227 | 0.9951 | -0.0276 | 0.6143 | 0.5961 | -0.0182 | 51.7% | 0.0050 | 0.9901 |
| Championship | 1,114 | 1.0602 | 1.0362 | -0.0240 | 0.6409 | 0.6241 | -0.0168 | 46.5% | 0.0010 | 1.0335 |
| LaLiga | 760 | 0.9996 | 0.9591 | -0.0405 | 0.5962 | 0.5677 | -0.0285 | 54.2% | 0.0034 | 0.9557 |
| Ligue 1 | 612 | 0.9999 | 0.9653 | -0.0346 | 0.5974 | 0.5729 | -0.0244 | 54.4% | -0.0009 | 0.9662 |
| Bundesliga | 612 | 1.0156 | 0.9709 | -0.0447 | 0.6066 | 0.5761 | -0.0305 | 54.4% | 0.0016 | 0.9692 |
| Serie A | 760 | 1.0021 | 0.9651 | -0.0370 | 0.6000 | 0.5747 | -0.0253 | 53.7% | 0.0006 | 0.9645 |
| Eredivisie | 612 | 0.9936 | 0.9611 | -0.0325 | 0.5918 | 0.5714 | -0.0204 | 53.1% | 0.0035 | 0.9576 |
| Liga Portugal | 612 | 0.9625 | 0.9216 | -0.0409 | 0.5714 | 0.5455 | -0.0259 | 56.7% | 0.0086 | 0.9130 |
| Süper Lig | 648 | 0.9836 | 0.9397 | -0.0438 | 0.5851 | 0.5566 | -0.0285 | 57.4% | -0.0000 | 0.9397 |
| Champions League | 188 | 0.9288 | 0.9085 | -0.0203 | 0.5443 | 0.5318 | -0.0125 | 60.1% | – | – |
| MLS | 1,062 | 1.0527 | 1.0457 | -0.0070 | 0.6340 | 0.6283 | -0.0057 | 47.9% | 0.0183 | 1.0273 |
| All leagues | 7,740 | 1.0129 | 0.9819 | -0.0310 | 0.6064 | 0.5854 | -0.0209 | 52.5% | 0.0047 | 0.9788 |

### Calibration (both seasons, all outcome probabilities pooled)


**current engine v2**

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-10% | 299 | 7.8% | 7.4% |
| 10-20% | 2,556 | 16.3% | 16.9% |
| 20-30% | 9,211 | 25.3% | 25.1% |
| 30-40% | 4,906 | 34.3% | 34.0% |
| 40-50% | 3,029 | 44.6% | 44.6% |
| 50-60% | 1,906 | 54.5% | 55.0% |
| 60-70% | 900 | 64.2% | 65.6% |
| 70-80% | 339 | 74.0% | 74.6% |
| 80-90% | 72 | 83.0% | 81.9% |
| 90-100% | 2 | 90.4% | 100.0% |

**ensemble (no market) + calibration**

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-10% | 794 | 7.0% | 7.3% |
| 10-20% | 3,016 | 15.8% | 16.1% |
| 20-30% | 8,928 | 25.9% | 25.9% |
| 30-40% | 4,181 | 34.1% | 34.4% |
| 40-50% | 2,698 | 44.7% | 44.6% |
| 50-60% | 1,767 | 54.5% | 53.5% |
| 60-70% | 971 | 64.5% | 64.0% |
| 70-80% | 587 | 74.6% | 74.8% |
| 80-90% | 259 | 83.9% | 83.4% |
| 90-100% | 19 | 91.5% | 78.9% |

**final (market ensemble when pre-match odds exist, else calibrated no-market ensemble)**

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-10% | 735 | 7.5% | 5.6% |
| 10-20% | 3,216 | 16.0% | 15.5% |
| 20-30% | 8,714 | 25.7% | 25.5% |
| 30-40% | 4,206 | 34.1% | 34.1% |
| 40-50% | 2,697 | 44.6% | 45.9% |
| 50-60% | 1,819 | 54.9% | 54.4% |
| 60-70% | 954 | 64.3% | 64.0% |
| 70-80% | 647 | 74.4% | 77.4% |
| 80-90% | 223 | 84.0% | 86.1% |
| 90-100% | 9 | 91.5% | 88.9% |

**bookmaker closing**

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-10% | 624 | 7.5% | 5.1% |
| 10-20% | 3,124 | 15.9% | 14.4% |
| 20-30% | 8,599 | 25.6% | 25.9% |
| 30-40% | 4,084 | 34.1% | 34.0% |
| 40-50% | 2,576 | 44.6% | 45.0% |
| 50-60% | 1,821 | 54.7% | 54.5% |
| 60-70% | 1,013 | 64.6% | 65.1% |
| 70-80% | 577 | 74.4% | 78.5% |
| 80-90% | 204 | 83.8% | 88.2% |
| 90-100% | 4 | 91.3% | 100.0% |
