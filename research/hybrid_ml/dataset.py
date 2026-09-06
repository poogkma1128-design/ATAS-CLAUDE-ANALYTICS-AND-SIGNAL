"""Causal candidate construction and censored first-passage labels.

This labels forecasts, not trade fills or P&L. Footprint checks use only data
available at the decision; future bars are checked for OHLC validity only.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
import math

SYMBOLS = ("MNQU6", "GC")
STEP = timedelta(minutes=5)
HORIZONS = (3, 6, 10)
FEATURES = (
    "return1", "return3", "return12", "range",
    "body", "close_location", "log_relative_volume",
    "aggressive_imbalance", "poc_distance", "footprint_concentration",
    "log_ticks",
)
LEVEL_FEATURES = FEATURES + ("level_distance", "approach")
START = datetime(2026, 8, 28, tzinfo=timezone.utc)
TRAIN_END = datetime(2026, 9, 2, tzinfo=timezone.utc)
CAL_END = datetime(2026, 9, 3, tzinfo=timezone.utc)
END = datetime(2026, 9, 4, tzinfo=timezone.utc)


def timestamp(value):
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamp must include timezone")
    return result.astimezone(timezone.utc)


def iso(value):
    return value.isoformat().replace("+00:00", "Z")


def numeric(row, name):
    try:
        value = float(row[name])
        return value if math.isfinite(value) else None
    except (KeyError, TypeError, ValueError, OverflowError):
        return None


def basic_reason(row):
    if row.get("timeframe_sec") != 300 or row.get("is_closed") is not True:
        return "not_closed_5m"
    t = timestamp(row["opened_at"])
    if t.second or t.microsecond or t.minute % 5:
        return "off_grid"
    vals = [numeric(row, x) for x in ("open", "high", "low", "close")]
    if any(v is None for v in vals):
        return "invalid_ohlc"
    o, h, l, c = vals
    if not l <= min(o, c) <= max(o, c) <= h:
        return "invalid_ohlc"
    return None


def footprint_reason(row):
    """Conservative current-snapshot checks; never repair or impute a level."""
    required = ("level_count", "level_volume_sum", "ask_sum", "bid_sum",
                "tick_sum", "ticks", "max_level_volume", "derived_poc",
                "outside_level_count", "invalid_level_count", "ask_volume", "bid_volume")
    vals = {k: numeric(row, k) for k in required}
    if any(v is None for v in vals.values()):
        return "missing_footprint_diagnostics"
    if vals["level_count"] <= 0 or vals["level_volume_sum"] <= 0:
        return "missing_footprint"
    if vals["outside_level_count"] or vals["invalid_level_count"]:
        return "invalid_footprint_levels"
    if vals["ticks"] < 0 or vals["tick_sum"] != vals["ticks"]:
        return "footprint_tick_mismatch"
    tolerance = 0.00005 * (vals["level_count"] + 1)
    if abs(vals["ask_sum"] - vals["ask_volume"]) > tolerance:
        return "footprint_ask_mismatch"
    if abs(vals["bid_sum"] - vals["bid_volume"]) > tolerance:
        return "footprint_bid_mismatch"
    if min(vals["ask_sum"], vals["bid_sum"], vals["max_level_volume"]) < 0:
        return "invalid_footprint_values"
    if not 0 <= vals["max_level_volume"] <= vals["level_volume_sum"]:
        return "invalid_footprint_concentration"
    if not float(row["low"]) <= vals["derived_poc"] <= float(row["high"]):
        return "invalid_derived_poc"
    return None


def split_at(decision_time):
    if not START <= decision_time < END:
        return "outside_window", True
    if decision_time < TRAIN_END:
        name, boundary = "train", TRAIN_END
    elif decision_time < CAL_END:
        name, boundary = "calibration", CAL_END
    else:
        name, boundary = "evaluation", END
    # Fixed maximum horizon, never the (possibly early) observed event time.
    return name, decision_time + 10 * STEP >= boundary


def barriers(reference, scale, tick_size):
    p, s, tick = (Decimal(str(v)) for v in (reference, scale, tick_size))
    upper = ((p + s) / tick).to_integral_value(rounding=ROUND_CEILING) * tick
    lower = ((p - s) / tick).to_integral_value(rounding=ROUND_FLOOR) * tick
    return float(upper), float(lower)


def future_label(candidate, clock):
    """Observe until an event, the first missing/invalid OHLC, or ten bins."""
    t = timestamp(candidate["opened_at"])
    observed = 0
    for k in range(1, 11):
        row = clock.get(t + k * STEP)
        reason = "missing_future_bar" if row is None else basic_reason(row)
        if reason:
            return {"observed_bins": observed, "event_bin": None,
                    "event_class": None, "censor_reason": reason}
        observed = k
        upper = float(row["high"]) >= candidate["upper_barrier"]
        lower = float(row["low"]) <= candidate["lower_barrier"]
        if upper or lower:
            event = 3 if upper and lower else 1 if upper else 2
            if candidate["task"] == "level" and candidate["approach"] < 0 and event != 3:
                event = 3 - event
            return {"observed_bins": observed, "event_bin": k,
                    "event_class": event, "censor_reason": None}
    return {"observed_bins": 10, "event_bin": None, "event_class": None,
            "censor_reason": None}


def horizon_label(candidate, horizon):
    if candidate["event_bin"] is not None and candidate["event_bin"] <= horizon:
        return candidate["event_class"] - 1  # [event1,event2,ambiguous,no_event]
    if candidate["observed_bins"] >= horizon:
        return 3
    return None


def build_candidates(rows):
    clocks = defaultdict(dict)
    for row in rows:
        if row.get("symbol") not in SYMBOLS:
            raise ValueError("Snapshot contains an out-of-scope instrument")
        group = (row["symbol"], row["instrument_id"], row.get("exchange"))
        t = timestamp(row["opened_at"])
        if not START <= t < END:
            raise ValueError("Snapshot contains rows outside frozen development window")
        if t in clocks[group]:
            raise ValueError("Duplicate instrument timestamp; source must be unambiguous")
        clocks[group][t] = row
    # A symbol must name one immutable contract/venue within this frozen run.
    identities = Counter(group[0] for group in clocks)
    if any(n != 1 for n in identities.values()):
        raise ValueError("Multiple instrument identities for a target symbol")
    ledger = []
    for group, clock in sorted(clocks.items(), key=lambda item: str(item[0])):
        for t, row in sorted(clock.items()):
            decision = t + STEP
            partition, purged = split_at(decision)
            base = {"bar_id": row["id"], "instrument_id": row["instrument_id"],
                    "symbol": row["symbol"], "exchange": row.get("exchange"),
                    "opened_at": iso(t), "decision_time": iso(decision),
                    "utc_day": decision.date().isoformat(), "partition": partition,
                    "purged": purged, "eligible": False,
                    "status": "exploratory_only"}
            reason = basic_reason(row)
            if not reason and partition == "outside_window":
                reason = "outside_window"
            tick, volume = numeric(row, "tick_size"), numeric(row, "volume")
            if not reason and (tick is None or tick <= 0 or volume is None or volume <= 0):
                reason = "invalid_units_or_volume"
            if not reason:
                reason = footprint_reason(row)
            past = [clock.get(t - k * STEP) for k in range(1, 14)]
            if not reason and any(r is None or basic_reason(r) for r in past):
                reason = "missing_or_invalid_past_13"
            feature_values, scale = None, None
            if not reason:
                prev_volumes = [numeric(r, "volume") for r in past[:12]]
                if any(v is None or v <= 0 for v in prev_volumes):
                    reason = "invalid_past_volume"
                else:
                    tr = [max(float(past[k]["high"]) - float(past[k]["low"]),
                              abs(float(past[k]["high"]) - float(past[k + 1]["close"])),
                              abs(float(past[k]["low"]) - float(past[k + 1]["close"])))
                          for k in range(12)]
                    scale = max(tick, sum(tr) / 12)
                    c, o, h, l = (float(row[k]) for k in ("close", "open", "high", "low"))
                    ask, bid = float(row["ask_sum"]), float(row["bid_sum"])
                    if ask + bid <= 0:
                        reason = "undefined_aggressive_imbalance"
                    else:
                        feature_values = [
                            (c - float(past[k - 1]["close"])) / scale for k in (1, 3, 12)
                        ] + [(h - l) / scale, (c - o) / scale,
                             (c - l) / max(h - l, tick),
                             math.log(volume / (sum(prev_volumes) / 12)),
                             (ask - bid) / (ask + bid),
                             (c - float(row["derived_poc"])) / scale,
                             float(row["max_level_volume"]) / float(row["level_volume_sum"]),
                             math.log1p(float(row["ticks"]))]
                        if not all(math.isfinite(v) for v in feature_values):
                            reason = "nonfinite_features"
            for task in ("direction", "level"):
                item = dict(base, task=task,
                            candidate_id=f"{row['instrument_id']}:{iso(t)}:{task}")
                task_reason = reason
                reference, approach = numeric(row, "close"), 1
                if not task_reason and task == "level":
                    task_reason = footprint_reason(past[0])
                    if task_reason:
                        task_reason = "previous_" + task_reason
                    else:
                        reference = float(past[0]["derived_poc"])
                        approach = int(reference > float(past[0]["close"])) - int(reference < float(past[0]["close"]))
                        if not approach:
                            task_reason = "undefined_approach"
                        elif not float(row["low"]) <= reference <= float(row["high"]):
                            task_reason = "level_not_touched"
                if not task_reason:
                    upper, lower = barriers(reference, scale, tick)
                    if task == "level" and not lower < float(row["close"]) < upper:
                        task_reason = "already_resolved_at_decision"
                    else:
                        values = list(feature_values)
                        if task == "level":
                            values += [(float(row["close"]) - reference) / scale, approach]
                        item.update(eligible=True, features=values, scale=scale,
                                    reference=reference, approach=approach,
                                    upper_barrier=upper, lower_barrier=lower)
                        item.update(future_label(item, clock))
                item["exclusion_reason"] = task_reason
                ledger.append(item)
    return ledger


def candidate_census(ledger):
    groups = defaultdict(list)
    for item in ledger:
        groups[(item["symbol"], item["task"], item["partition"], item["utc_day"])].append(item)
    result = []
    for key, items in sorted(groups.items()):
        eligible = [r for r in items if r["eligible"]]
        selected = [r for r in eligible if not r["purged"]]
        result.append(dict(zip(("symbol", "task", "partition", "utc_day"), key),
                           candidates=len(items), eligible=len(eligible),
                           purged=sum(r["purged"] for r in eligible), selected=len(selected),
                           exclusion_reasons=dict(Counter(r["exclusion_reason"] for r in items if not r["eligible"])),
                           censor_reasons=dict(Counter(r["censor_reason"] for r in selected if r["censor_reason"])),
                           terminal_classes=dict(Counter(str(r["event_class"]) for r in selected))))
    return result
