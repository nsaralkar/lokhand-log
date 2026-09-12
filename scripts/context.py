#!/usr/bin/env python3
"""Print one user's recent training context as YAML: profile, body weight, and
each recent session as planned vs. done, with notes. Same payload as the MCP
`get_training_context` tool, for LLM sessions that read the data repo directly.

Usage:
    uv run scripts/context.py --user nikhil --data-dir /path/to/lokhand-data
    uv run scripts/context.py --user nikhil --days 28
"""
import argparse
import os
import sys
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--user", required=True)
    p.add_argument("--data-dir", default=os.environ.get("LOKHAND_LOG_DATA_DIR"),
                   help="data repo root (default: $LOKHAND_LOG_DATA_DIR)")
    p.add_argument("--days", type=int, default=14, help="how far back to look")
    args = p.parse_args()
    if not args.data_dir:
        p.error("--data-dir or $LOKHAND_LOG_DATA_DIR is required")
    os.environ["LOKHAND_LOG_DATA_DIR"] = args.data_dir   # before app.config imports

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    import yaml
    from app import analytics, config

    if not config.user_dir(args.user).exists():
        p.error(f"no such user in {config.DATA_DIR}: {args.user}")
    ctx = analytics.training_context(args.user, args.days)
    # Multi-line strings (the profile) as readable `|` blocks, not escaped \n.
    yaml.SafeDumper.add_representer(str, lambda d, v: d.represent_scalar(
        "tag:yaml.org,2002:str", v, style="|" if "\n" in v else None))
    print(yaml.safe_dump(ctx, sort_keys=False, allow_unicode=True, width=10**6), end="")


if __name__ == "__main__":
    main()
