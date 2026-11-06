"""Command line: python -m app.cli <command>

  migrate               apply Alembic migrations (PostgreSQL or SQLite)
  init-db               create tables directly from the models (quick local start)
  catalog               load/refresh sports, leagues and badges from data/catalog.json
  seed                  full demo world from the mock provider (+ demo users and picks)
  demo-live             move a few upcoming mock fixtures to kick off around now
  job <name>            run one job: fixtures | live | squads | predictions | standings | settle
  worker                run the scheduler in the foreground (production: one worker process)
  rebuild-leaderboards  recompute every leaderboard from picks (and refill Redis)
  backtest              walk-forward backtest of the models on the results in the database
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import time
from pathlib import Path

from .config import get_settings
from .db import Base, get_engine, session_scope

BACKEND_DIR = Path(__file__).resolve().parent.parent


def cmd_migrate(_args) -> None:
    from alembic import command
    from alembic.config import Config

    # run from backend/ (or the Docker WORKDIR); fall back to the source tree layout
    base = Path.cwd() if (Path.cwd() / "alembic.ini").exists() else BACKEND_DIR
    cfg = Config(str(base / "alembic.ini"))
    cfg.set_main_option("script_location", str(base / "migrations"))
    command.upgrade(cfg, "head")
    print("migrations applied")


def cmd_init_db(_args) -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(get_engine())
    print("tables created")


def cmd_catalog(_args) -> None:
    from .services.catalog import apply_catalog, load_catalog_file

    with session_scope() as db:
        print(apply_catalog(db, load_catalog_file()))


def cmd_seed(args) -> None:
    from .seed import seed_all

    settings = get_settings()
    t0 = time.time()
    with session_scope() as db:
        report = seed_all(db, settings, users=not args.no_users, live=not args.no_live)
    report["seconds"] = round(time.time() - t0, 1)
    print(json.dumps(report, indent=2, default=str))


def cmd_demo_live(_args) -> None:
    from .seed import demo_live

    with session_scope() as db:
        print({"moved_match_ids": demo_live(db, get_settings())})


def cmd_job(args) -> None:
    from .jobs import run_job

    print(json.dumps(run_job(args.name), indent=2, default=str))


def cmd_worker(_args) -> None:
    from .jobs import start_scheduler

    sched = start_scheduler(get_settings())
    stop = {"flag": False}
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))
    try:
        while not stop["flag"]:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    sched.shutdown()


def cmd_rebuild(_args) -> None:
    from .services.leaderboards import rebuild_all

    with session_scope() as db:
        print({"entries": rebuild_all(db)})


def cmd_backtest(args) -> None:
    from predictpro_engine import backtest, should_promote
    from sqlalchemy import select

    from .models import Sport
    from .services.predictions import finished_history, model_for

    with session_scope() as db:
        for sport in db.scalars(select(Sport).where(Sport.is_active.is_(True))):
            if args.sport and sport.slug != args.sport:
                continue
            history = finished_history(db, sport.id)
            res = backtest(model_for(db, sport), history, warmup=args.warmup)
            ok, notes = should_promote(res.model, res.baseline, min_matches=1)
            print(json.dumps({"sport": sport.slug, **res.to_dict(), "beats_base_rate": ok, "notes": notes}, indent=2))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    sub.add_parser("init-db").set_defaults(fn=cmd_init_db)
    sub.add_parser("catalog").set_defaults(fn=cmd_catalog)
    p = sub.add_parser("seed")
    p.add_argument("--no-users", action="store_true", help="skip demo users and picks")
    p.add_argument("--no-live", action="store_true", help="don't move fixtures to 'now'")
    p.set_defaults(fn=cmd_seed)
    sub.add_parser("demo-live").set_defaults(fn=cmd_demo_live)
    p = sub.add_parser("job")
    p.add_argument("name", choices=["fixtures", "live", "squads", "predictions", "standings", "settle"])
    p.set_defaults(fn=cmd_job)
    sub.add_parser("worker").set_defaults(fn=cmd_worker)
    sub.add_parser("rebuild-leaderboards").set_defaults(fn=cmd_rebuild)
    p = sub.add_parser("backtest")
    p.add_argument("--sport")
    p.add_argument("--warmup", type=int, default=200)
    p.set_defaults(fn=cmd_backtest)
    args = ap.parse_args(argv)
    logging.getLogger().setLevel(logging.WARNING)
    args.fn(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
