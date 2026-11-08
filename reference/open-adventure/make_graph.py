#!/usr/bin/env python3
# SPDX-FileCopyrightText: (C) Eric S. Raymond <esr@thyrsus.com>
# SPDX-License-Identifier: BSD-2-Clause
"""\
usage: make_graph.py [-a] [-d] [-m] [-s] [-v]

Make a DOT graph of Colossal Cave.

-a = emit graph of entire dungeon
-d = emit graph of maze all different
-f = emit graph of forest locations
-m = emit graph of maze all alike
-s = emit graph of non-forest surface locations
-v = include internal symbols in room labels
"""

# pylint: disable=consider-using-f-string,line-too-long,invalid-name,missing-function-docstring,multiple-imports,redefined-outer-name

import sys, getopt, yaml

# pacify pylint
location_lookup = {}
object_lookup = {}
debug = False
startlocs = {}


def allalike(loc):
    "Select out loci related to the Maze All Alike"
    return location_lookup[loc]["conditions"].get("ALLALIKE")


def alldifferent(loc):
    "Select out loci related to the Maze All Alike"
    return location_lookup[loc]["conditions"].get("ALLDIFFERENT")


def surface(loc):
    "Select out surface locations"
    return location_lookup[loc]["conditions"].get("ABOVE")


def forest(loc):
    return location_lookup[loc]["conditions"].get("FOREST")


def abbreviate(d):
    m = {
        "NORTH": "N",
        "EAST": "E",
        "SOUTH": "S",
        "WEST": "W",
        "UPWAR": "U",
        "DOWN": "D",
    }
    return m.get(d, d)


def roomlabel(loc):
    "Generate a room label from the description, if possible"
    loc_descriptions = location_lookup[loc]["description"]
    description = ""
    if debug:
        description = loc[4:]
    longd = loc_descriptions["long"]
    short = loc_descriptions["maptag"] or loc_descriptions["short"]
    if short is None and longd is not None and len(longd) < 20:
        short = loc_descriptions["long"]
    if short is not None:
        if short.startswith("You're "):
            short = short[7:]
        if short.startswith("You are "):
            short = short[8:]
        if (
            short.startswith("in ")
            or short.startswith("at ")
            or short.startswith("on ")
        ):
            short = short[3:]
        if short.startswith("the "):
            short = short[4:]
        if short[:3] in {"n/s", "e/w"}:
            short = short[:3].upper() + short[3:]
        elif short[:2] in {"ne", "sw", "se", "nw"}:
            short = short[:2].upper() + short[2:]
        else:
            short = short[0].upper() + short[1:]
        if debug:
            description += "\\n"
        description += short
        if loc in startlocs:
            description += "\\n(" + ",".join(startlocs[loc]).lower() + ")"
    return description


# A forwarder is a location that you can't actually stop in - when you go there
# it ships some message (which is the point) then shifts you to a next location.
# A forwarder has a zero-length array of notion verbs in its travel section.
#
# Here is an example forwarder declaration:
#
# - LOC_GRUESOME:
#    description:
#      long: 'There is now one more gruesome aspect to the spectacular vista.'
#      short: !!null
#      maptag: !!null
#    conditions: {DEEP: true}
#    travel: [
#      {verbs: [], action: [goto, LOC_NOWHERE]},
#    ]


def is_forwarder(loc):
    "Is a location a forwarder?"
    travel = location_lookup[loc]["travel"]
    return len(travel) == 1 and len(travel[0]["verbs"]) == 0


def forward(loc):
    "Chase a location through forwarding links."
    while is_forwarder(loc):
        loc = location_lookup[loc]["travel"][0]["action"][1]
    return loc


def reveal(objname):
    "Should this object be revealed when mapping?"
    if "OBJ_" in objname:
        return False
    if objname == "VEND":
        return True
    obj = object_lookup[objname]
    return not obj.get("immovable")


if __name__ == "__main__":
    with open("adventure.yaml", "r", encoding="ascii", errors="surrogateescape") as f:
        db = yaml.safe_load(f)

    location_lookup = dict(db["locations"])
    object_lookup = dict(db["objects"])

    try:
        (options, arguments) = getopt.getopt(sys.argv[1:], "adfmsv")
    except getopt.GetoptError as e:
        print(e)
        sys.exit(1)

    subset = allalike
    debug = False
    for switch, val in options:
        if switch == "-a":
            # pylint: disable=unnecessary-lambda-assignment
            subset = lambda loc: True
        elif switch == "-d":
            subset = alldifferent
        elif switch == "-f":
            subset = forest
        elif switch == "-m":
            subset = allalike
        elif switch == "-s":
            subset = surface
        elif switch == "-v":
            debug = True
        else:
            sys.stderr.write(__doc__)
            raise SystemExit(1)

    startlocs = {}
    for obj in db["objects"]:
        objname = obj[0]
        location = obj[1].get("locations")
        if location != "LOC_NOWHERE" and reveal(objname):
            if location in startlocs:
                startlocs[location].append(objname)
            else:
                startlocs[location] = [objname]

    # Compute reachability, using forwards.
    # Dictionary key is (from, to) iff its a valid link,
    # value is corresponding motion verbs.
    links = {}
    nodes = []
    for loc, attrs in db["locations"]:
        nodes.append(loc)
        travel = attrs["travel"]
        if len(travel) > 0:
            for dest in travel:
                verbs = [abbreviate(x) for x in dest["verbs"]]
                if len(verbs) == 0:
                    continue
                action = dest["action"]
                if action[0] == "goto":
                    dest = forward(action[1])
                    if not (subset(loc) or subset(dest)):
                        continue
                    links[(loc, dest)] = verbs

    neighbors = set()
    for loc in nodes:
        for f, t in links:
            if f == "LOC_NOWHERE" or t == "LOC_NOWHERE":
                continue
            if (f == loc and subset(t)) or (t == loc and subset(f)):
                if loc not in neighbors:
                    neighbors.add(loc)

    print("digraph G {")

    for loc in nodes:
        if not is_forwarder(loc):
            node_label = roomlabel(loc)
            if subset(loc):
                print('    %s [shape=box,label="%s"]' % (loc[4:], node_label))
            elif loc in neighbors:
                print('    %s [label="%s"]' % (loc[4:], node_label))

    # Draw arcs
    for f, t in links:
        arc = "%s -> %s" % (f[4:], t[4:])
        label = ",".join(links[(f, t)]).lower()
        if len(label) > 0:
            arc += ' [label="%s"]' % label
        print("    " + arc)
    print("}")

# end
