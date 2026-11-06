"""Render docs/SOURCE_REGISTRY.md from mkdata.sources.REGISTRY (+ measured cross-check numbers)."""

from __future__ import annotations

import json
from pathlib import Path

from .sources import CHECKED, EXCLUDED, PERMITTED, PERMITTED_ATTRIBUTION, RESTRICTED, UNVERIFIED, SourceSpec

LABEL = {PERMITTED: "Permitted", PERMITTED_ATTRIBUTION: "Permitted (attribution required)", RESTRICTED: "Restricted: not used",
         UNVERIFIED: "Unverified: not used", EXCLUDED: "Excluded"}


def _status(s: SourceSpec) -> str:
    ok, why = s.usable()
    if ok:
        return "On"
    if s.terms_status in (PERMITTED, PERMITTED_ATTRIBUTION) and s.key_env:
        return f"Off until `{s.key_env}` is set"
    return "Off"


def render(registry: dict[str, SourceSpec], crosscheck_path: str | None = None) -> str:
    out = [
        "# Source registry",
        "",
        f"Generated from `pipeline/mkdata/sources.py` (`python -m mkdata registry-doc`). Terms and robots.txt read on {CHECKED}.",
        "A source is fetched only if its terms permit our use **and** any key it needs is in the server-side environment.",
        "Keys are never stored in the app, the repository or logs.",
        "",
        "| Source | Provides | Sports | Cost | Rate limit | Terms | Reliability prior | Status |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for s in registry.values():
        out.append(
            f"| {s.title} | {', '.join(s.provides)} | {', '.join(s.sports)} | {s.cost} | {s.rate_limit} | "
            f"{LABEL[s.terms_status]} | {s.reliability:.2f} | {_status(s)} |"
        )
    out += ["", "## What the terms say (as read)", ""]
    for s in registry.values():
        out.append(f"### {s.title}")
        out.append("")
        out.append(f"- **Terms status:** {LABEL[s.terms_status]}" + (f" ([source]({s.terms_url}))" if s.terms_url else ""))
        out.append(f"- **What we read:** {s.terms}")
        if s.attribution:
            out.append(f"- **Required attribution:** \"{s.attribution}\"")
        if s.key_env:
            out.append(f"- **Key:** server-side environment variable `{s.key_env}`")
        if s.notes:
            out.append(f"- **Notes:** {s.notes}")
        out.append("")
    if crosscheck_path and Path(crosscheck_path).exists():
        d = json.loads(Path(crosscheck_path).read_text())
        out += ["## Measured reliability (cross-check of the two free football sources)", "",
                f"From `{crosscheck_path}` ({d['generated_at']}).", "",
                "| Competition | Canonical matches | In both sources | Both final | Score agreement | Kick-off within 15 min |",
                "|---|---|---|---|---|---|"]
        for c, v in d["competitions"].items():
            sa = "–" if v["score_agreement"] is None else f"{100 * v['score_agreement']:.2f}%"
            ko = "–" if v["kickoff_within_15min"] is None else f"{100 * v['kickoff_within_15min']:.1f}%"
            out.append(f"| {c} | {v['canonical_matches']:,} | {v['in_two_or_more_sources']:,} | {v['both_final']:,} | {sa} | {ko} |")
        out.append("")
    return "\n".join(out) + "\n"
