"""Write permitted canonical results in the row shape the current TS engine's audit scripts read."""

import json
import sys
from pathlib import Path

from mkmodel.data import APP_LEAGUES, load

out = Path(sys.argv[1])
out.parent.mkdir(parents=True, exist_ok=True)
rows = [{"id": m.id, "t": int(m.t * 1000), "h": m.h, "a": m.a, "hn": m.h, "an": m.a, "hs": m.hs, "as": m.as_, "n": 0, "pre": 0,
         "league": m.comp} for m in load(comps=APP_LEAGUES) if m.outcome is not None]
out.write_text(json.dumps(rows))
print(len(rows), "rows ->", out)
