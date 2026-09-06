"""Turn a saved Supabase CLI reply into the snapshot.json the runner reads.

The CLI has shipped several wrappers around the same SELECT result, and PowerShell's
JSON handling differs between Windows PowerShell 5.1 and PowerShell 7 in ways that made
the shell-side parsing unreliable. Parsing here instead keeps one implementation that is
actually exercised by tests, and keeps the shell script to what a shell is good at:
running the command and saving its bytes.

This reads only a local file. It never contacts the database, never repairs a row, and
refuses to write a snapshot that does not match the config it was given.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

EXPORT_SCHEMAS = {"hybrid-ml-exploratory-v1": "hybrid-ml-training-export-v1",
                  "hybrid-ml-exploratory-v2": "hybrid-ml-training-export-v2"}
DEFAULT_QUERIES = {"hybrid-ml-exploratory-v1": "docs/queries/hybrid_ml_training_export_v1.sql"}
ARTIFACT_KEY = "hybrid_ml_training_export"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def find_artifact(node, depth=0):
    """Locate the exported column under whatever wrapper the CLI used this time."""
    if depth > 5:
        return None
    if isinstance(node, list):
        for item in node:
            found = find_artifact(item, depth + 1)
            if found is not None:
                return found
        return None
    if isinstance(node, dict):
        if ARTIFACT_KEY in node:
            return node[ARTIFACT_KEY]
        # Some CLI versions wrap result rows in `rows`. The artifact has its own `rows`
        # of bar data, so only descend when this is clearly not the artifact itself.
        if "rows" in node and "schema_version" not in node:
            return find_artifact(node["rows"], depth + 1)
    return None


def timestamp(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def check(artifact, config):
    """Every mismatch is a refusal, never a repair."""
    expected_schema = EXPORT_SCHEMAS[config["schema_version"]]
    if artifact.get("schema_version") != expected_schema:
        raise ValueError(f"Snapshot schema {artifact.get('schema_version')!r} does not match "
                         f"config {config['schema_version']!r} (expected {expected_schema!r})")
    rows = artifact.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ValueError("The reply carries no rows")
    if artifact.get("row_count") != len(rows):
        raise ValueError(f"Incomplete snapshot: row_count {artifact.get('row_count')} "
                         f"but {len(rows)} rows arrived")
    expected = set(config["target_symbols"])
    present = {row.get("symbol") for row in rows}
    if present - expected:
        raise ValueError(f"Out-of-scope symbols in snapshot: {sorted(present - expected)}")
    if expected - present:
        raise ValueError(f"Snapshot is missing rows for: {sorted(expected - present)}")
    for field, key in (("development_start", "development_start"),
                       ("development_end_exclusive", "development_end_exclusive")):
        if timestamp(artifact[field]) != timestamp(config[key]):
            raise ValueError(f"Snapshot {field} {artifact[field]} does not match the config window")
    return rows


def extract(cli_output, config_path, output_directory):
    cli_output, config_path = Path(cli_output).resolve(), Path(config_path).resolve()
    output = Path(output_directory).resolve()
    repo = Path(__file__).resolve().parents[2]
    if output.is_relative_to(repo):
        raise ValueError("Raw snapshots must stay outside the repository")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if config.get("schema_version") not in EXPORT_SCHEMAS:
        raise ValueError(f"Unknown config schema_version {config.get('schema_version')!r}")
    text = cli_output.read_text(encoding="utf-8-sig")
    if not text.strip():
        raise ValueError(f"{cli_output} is empty; the CLI returned nothing to extract")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError(f"{cli_output} is not valid JSON ({error}). Its first 300 characters "
                         f"are: {text[:300]}") from error
    artifact = find_artifact(parsed)
    if artifact is None:
        raise ValueError(f"No {ARTIFACT_KEY!r} column found in {cli_output}. Its first 300 "
                         f"characters are: {text[:300]}")
    rows = check(artifact, config)
    output.mkdir(parents=True, exist_ok=True)
    snapshot = output / "snapshot.json"
    if snapshot.exists():
        raise FileExistsError(f"Refusing to overwrite {snapshot}")
    snapshot.write_text(json.dumps(artifact, ensure_ascii=False, allow_nan=False),
                        encoding="utf-8")
    query = repo / config.get("export_query", DEFAULT_QUERIES.get(config["schema_version"], ""))
    manifest = {"config": config_path.name, "schema_version": artifact["schema_version"],
                "target_symbols": list(config["target_symbols"]),
                "query_sha256": digest(query) if query.is_file() else None,
                "cli_output_sha256": digest(cli_output),
                "snapshot_sha256": digest(snapshot), "config_sha256": digest(config_path),
                "row_count": len(rows), "exported_at": artifact.get("executed_at"),
                "extracted_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "snapshot_path": str(snapshot), "status": "exploratory_only"}
    (output / "export_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli-output", required=True, help="the saved CLI reply (cli-output.json)")
    parser.add_argument("--config", required=True)
    parser.add_argument("--output-directory", required=True,
                        help="where snapshot.json is written; must be outside the repository")
    args = parser.parse_args()
    print(json.dumps(extract(args.cli_output, args.config, args.output_directory), indent=2))


if __name__ == "__main__":
    main()
