"""MK Sports multi-source data layer (Step 2 of the engine rebuild).

Every data point is stored with the time it could first have been known (``available_at``) and the
time we fetched it (``fetched_at``). Model features may only read data with
``available_at < kickoff`` of the match being predicted; :mod:`mkdata.store` enforces that.
"""

__version__ = "0.1.0"
