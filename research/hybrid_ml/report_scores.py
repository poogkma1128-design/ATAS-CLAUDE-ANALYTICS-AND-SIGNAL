"""Print a compact, pasteable score table from a completed run's summary.json.

Read-only. It reformats what the run already recorded and computes nothing new, so it
cannot become a second, disagreeing source of numbers. summary.json stays the evidence;
this is only a way to carry the headline rows back into a conversation without pasting
a file of several hundred kilobytes. Every cell is printed, including failed ones - a
report that hides a failed fit would misrepresent the run.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def number(value, digits=4):
    return "-" if value is None else f"{value:.{digits}f}"


def report(run_directory, horizon=10):
    path = Path(run_directory).resolve()
    summary = json.loads((path / "summary.json").read_text(encoding="utf-8"))
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    scope = manifest.get("scope", {})
    lines = [f"run_id: {summary['run_id']}",
             f"status: {manifest['status']} ({summary['status']})",
             f"config: {manifest['config'].get('schema_version')}"
             f"  symbols: {','.join(scope.get('symbols', []))}"
             f"  window: {scope.get('start')} -> {scope.get('end')}",
             f"raw_bars: {summary['raw_bars']}  fits: {summary['fit_status_counts']}",
             f"python: {manifest['python']}  git_head: {manifest['git_head'][:12]}"
             f"  source_dirty: {manifest['source_dirty']}", ""]

    lines.append("Selected candidates per market and task (eligible, not purged):")
    selected = {}
    for row in summary["candidate_census"]:
        key = (row["symbol"], row["task"], row["partition"])
        selected[key] = selected.get(key, 0) + row["selected"]
    lines.append("| market | task | train | calibration | evaluation |")
    lines.append("|---|---|---:|---:|---:|")
    for symbol in scope.get("symbols", []):
        for task in ("direction", "level"):
            lines.append(f"| {symbol} | {task} | "
                         + " | ".join(str(selected.get((symbol, task, p), 0))
                                     for p in ("train", "calibration", "evaluation")) + " |")
    lines += ["", f"Evaluation partition at the {horizon * 5}-minute horizon."
                  " Lower Brier and log loss are better. Accuracy counts four classes"
                  " (two events, ambiguous, no event) and is NOT a win rate.", ""]
    lines.append("| market | task | model | variant | Brier | log loss | accuracy | scored/candidates |")
    lines.append("|---|---|---|---|---:|---:|---:|---:|")
    for cell in summary["cells"]:
        if cell["fit_status"] != "fitted":
            lines.append(f"| {cell['symbol']} | {cell['task']} | {cell['model']} | "
                         f"FAILED | - | - | - | {cell.get('failure', 'no reason recorded')} |")
            continue
        for variant in cell["variants"]:
            score = next((s for s in variant["scores"]
                          if s["partition"] == "evaluation" and s["horizon"] == horizon), None)
            if score is None:
                continue
            accuracy = "-" if score["accuracy"] is None else f"{score['accuracy'] * 100:.2f}%"
            lines.append(f"| {cell['symbol']} | {cell['task']} | {cell['model']} | "
                         f"{variant['variant']} | {number(score['brier'])} | "
                         f"{number(score['log_loss'])} | {accuracy} | "
                         f"{score['scored']}/{score['candidates']} |")
    lines += ["", "No model is promoted or declared a winner by this table. Small samples,"
                  " reused history, overlapping candidates and unverified source provenance"
                  " all still apply; see the experiment document."]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_directory")
    parser.add_argument("--horizon", type=int, default=10,
                        help="reported horizon in 5-minute bars (3, 6 or 10)")
    args = parser.parse_args()
    print(report(args.run_directory, args.horizon))


if __name__ == "__main__":
    main()
