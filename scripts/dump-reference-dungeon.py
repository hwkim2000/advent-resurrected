#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-2-Clause
"""
Developer tool (not run by CI). Regenerates tests/golden/dungeon-summary.json
from the upstream Open Adventure generator.

  python scripts/dump-reference-dungeon.py

It copies original/adventure.yaml and reference/open-adventure/{make_dungeon.py,
templates} into a temporary directory, runs make_dungeon.py there (nothing is
ever written under reference/ or original/), parses the generated dungeon.h and
dungeon.c, and writes table counts plus SHA-256 hashes of the canonical dump of
travel / tkey / conditions.

Canonical dump (also computed by the TypeScript tests from src/data):
  JSON, no whitespace (separators "," and ":"), keys in this order:
    {"travel": [[motion, condtype, condarg1, condarg2, desttype, destval,
                 nodwarves(0|1), stop(0|1)], ...],
     "tkey": [...], "conditions": [...]}
  Names are resolved to the numeric values of the C enums. condtype is
  cond_goto..cond_not = 0..4, desttype is dest_goto..dest_speak = 0..2.
  conditions are the bit masks in dungeon.c (without the run-time FORCED bit).

Copyright notice: BSD-2-Clause, see original/COPYING.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YAML_SRC = os.path.join(ROOT, "original", "adventure.yaml")
REF = os.path.join(ROOT, "reference", "open-adventure")
OUT = os.path.join(ROOT, "tests", "golden", "dungeon-summary.json")

CONDTYPES = {"cond_goto": 0, "cond_pct": 1, "cond_carry": 2, "cond_with": 3, "cond_not": 4}
DESTTYPES = {"dest_goto": 0, "dest_special": 1, "dest_speak": 2}


def enum_map(header, name):
    m = re.search(r"enum %s \{\s*(.*?)\s*\};" % name, header, re.S)
    if not m:
        raise SystemExit("enum %s not found in dungeon.h" % name)
    names = [x.strip() for x in m.group(1).split(",") if x.strip()]
    return {n: i for i, n in enumerate(names)}


def define_value(header, name):
    m = re.search(r"^#define\s+%s\s+(-?\d+)" % name, header, re.M)
    if not m:
        raise SystemExit("#define %s not found in dungeon.h" % name)
    return int(m.group(1))


def sha(obj):
    data = json.dumps(obj, separators=(",", ":")).encode("ascii")
    return hashlib.sha256(data).hexdigest()


def main():
    tmp = tempfile.mkdtemp(prefix="advent-dungeon-")
    try:
        shutil.copyfile(YAML_SRC, os.path.join(tmp, "adventure.yaml"))
        shutil.copyfile(os.path.join(REF, "make_dungeon.py"), os.path.join(tmp, "make_dungeon.py"))
        shutil.copytree(os.path.join(REF, "templates"), os.path.join(tmp, "templates"))
        subprocess.run([sys.executable, "make_dungeon.py"], cwd=tmp, check=True)
        with open(os.path.join(tmp, "dungeon.h"), encoding="ascii") as f:
            header = f.read()
        with open(os.path.join(tmp, "dungeon.c"), encoding="ascii") as f:
            csrc = f.read()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    msgs = enum_map(header, "arbitrary_messages_refs")
    locs = enum_map(header, "locations_refs")
    objs = enum_map(header, "object_refs")
    motions = enum_map(header, "motion_refs")
    actions = enum_map(header, "action_refs")

    cond_bits = {
        m.group(1): int(m.group(2))
        for m in re.finditer(r"^#define COND_(\w+)\s+(\d+)", header, re.M)
    }

    def num(tok, table):
        tok = tok.strip()
        if re.fullmatch(r"-?\d+", tok):
            return int(tok)
        return table[tok]

    # tkey
    m = re.search(r"const long tkey\[\] = \{(.*?)\};", csrc, re.S)
    tkey = [int(x) for x in m.group(1).replace("\n", " ").split(",") if x.strip()]

    # travel
    m = re.search(r"const travelop_t travel\[\] = \{(.*?)\n\};", csrc, re.S)
    body = m.group(1)
    travel = []
    for entry in re.finditer(r"\{ // from[^\n]*\n(.*?)\n    \},", body, re.S):
        fields = dict(re.findall(r"\.(\w+) = ([^,\n]+),", entry.group(1)))
        condtype = CONDTYPES.get(fields["condtype"], 0)
        desttype = DESTTYPES.get(fields["desttype"], 0)
        if condtype in (2, 3):
            arg1 = num(fields["condarg1"], objs)
        else:
            arg1 = num(fields["condarg1"], {})
        dest_table = msgs if desttype == 2 else locs
        travel.append([
            num(fields["motion"], motions),
            condtype,
            arg1,
            num(fields["condarg2"], {}),
            desttype,
            num(fields["destval"], dest_table),
            1 if fields["nodwarves"] == "true" else 0,
            1 if fields["stop"] == "true" else 0,
        ])

    # conditions
    m = re.search(r"long conditions\[\] = \{\n(.*?)\n\};", csrc, re.S)
    conditions = []
    for line in m.group(1).split("\n"):
        expr = line.split(",\t//")[0].strip()
        if not expr:
            continue
        value = 0
        if expr != "0":
            for bit in expr.split("|"):
                bm = re.fullmatch(r"\(1<<COND_(\w+)\)", bit.strip())
                value |= 1 << cond_bits[bm.group(1)]
        conditions.append(value)

    m = re.search(r'const char \*ignore = "([^"]*)";', csrc)
    ignore = m.group(1)
    m = re.search(r"const int dwarflocs\[NDWARVES\] = \{(.*?)\};", csrc, re.S)
    dwarflocs = [locs[x.strip()] for x in m.group(1).split(",") if x.strip()]

    counts = {
        "locations": define_value(header, "NLOCATIONS"),
        "objects": define_value(header, "NOBJECTS"),
        "hints": define_value(header, "NHINTS"),
        "classes": define_value(header, "NCLASSES"),
        "deaths": define_value(header, "NDEATHS"),
        "thresholds": define_value(header, "NTHRESHOLDS"),
        "motions": define_value(header, "NMOTIONS"),
        "actions": define_value(header, "NACTIONS"),
        "travel": define_value(header, "NTRAVEL"),
        "keys": define_value(header, "NKEYS"),
        "arbitraryMessages": len(msgs),
        "dwarves": define_value(header, "NDWARVES"),
        "birdEndstate": define_value(header, "BIRD_ENDSTATE"),
        "maxState": define_value(header, "MAX_STATE"),
    }
    # Cross-check the parsed tables against the declared counts.
    assert len(travel) == counts["travel"], (len(travel), counts["travel"])
    assert len(tkey) == counts["keys"], (len(tkey), counts["keys"])
    assert len(conditions) == counts["locations"]
    assert len(locs) == counts["locations"] and len(objs) == counts["objects"]
    assert len(motions) == counts["motions"] and len(actions) == counts["actions"]

    summary = {
        "source": "reference/open-adventure/make_dungeon.py (commit e6160529e70a8c7a06b9a5f190d69aa35c4c62f5)",
        "counts": counts,
        "ignore": ignore,
        "dwarflocs": dwarflocs,
        "travelDumpSha256": sha({"travel": travel, "tkey": tkey, "conditions": conditions}),
        "travelSha256": sha(travel),
        "tkeySha256": sha(tkey),
        "conditionsSha256": sha(conditions),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="ascii", newline="\n") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
