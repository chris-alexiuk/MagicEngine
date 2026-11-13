#!/usr/bin/env python3
"""Compare and query compiled card pools (cards.json.gz).

The grammar is grown one "slice" at a time. Each slice reparses the whole pool and compares the
result with the previous one; these subcommands are that comparison. See tools/dev/README.md.

  pool.py gained OLD NEW                cards that became (or stopped being) fully automatic
  pool.py astdiff OLD NEW [N]           cards that were full in OLD and whose compiled abilities changed
  pool.py lines OLD NEW NAME [NAME…]    the lines of those cards that NEW reads and OLD didn't, with their AST
  pool.py nonfull FILE LO HI            cards ranked LO..HI (EDHREC) that aren't full, with their unread lines
  pool.py grep FILE REGEX               cards whose Oracle text matches, by rank, with their grade
  pool.py tops FILE                     share of full cards among the top 1,000 / 2,000 / 5,000 / 10,000
  pool.py focus OLD NEW OUT [NAME…]     a --focus regex for the fuzzer: every card new or changed in NEW
  pool.py sample FILE N SEED [LO HI]    N random full cards with non-trivial text (JSON, for a grading audit)
  pool.py templates FILE [N]            the most common openings of unread lines
"""
import collections
import gzip
import json
import random
import re
import sys


def load(path):
    with gzip.open(path) as f:
        return json.load(f)


def level(card):
    a = card["automation"]
    return a if isinstance(a, str) else a.get("level")


def strip_text(o):
    if isinstance(o, dict):
        return {k: strip_text(v) for k, v in o.items() if k != "text"}
    if isinstance(o, list):
        return [strip_text(x) for x in o]
    return o


def unread(card):
    return [u for f in card["faces"] for u in f.get("unparsed", [])]


def gained(old, new):
    def full(p):
        return {(c.get("id") or c["name"]): (c["name"], c.get("rank")) for c in load(p)["cards"] if level(c) == "full"}

    a, b = full(old), full(new)
    up = [b[k][0] for k in sorted(set(b) - set(a), key=lambda k: (b[k][1] is None, b[k][1] or 0))]
    down = sorted(a[k][0] for k in set(a) - set(b))
    print("gained", len(up), "lost", len(down))
    print("GAINED:", ", ".join(up[:80]))
    print("LOST:", ", ".join(down[:80]))


def astdiff(old, new, show=30):
    a = {(c.get("id") or c["name"]): c for c in load(old)["cards"]}
    changed = []
    for c in load(new)["cards"]:
        o = a.get(c.get("id") or c["name"])
        if not o or level(o) != "full":
            continue
        x = json.dumps([strip_text(f["abilities"]) for f in o["faces"]], sort_keys=True)
        y = json.dumps([strip_text(f["abilities"]) for f in c["faces"]], sort_keys=True)
        if x != y:
            changed.append((c.get("rank") or 99999, c["name"], level(c), x, y))
    changed.sort()
    print("changed full cards:", len(changed))
    for rank, name, lvl, x, y in changed[:show]:
        i = 0
        while i < min(len(x), len(y)) and x[i] == y[i]:
            i += 1
        print("##", rank, name, lvl)
        print("  OLD:", x[max(0, i - 150) : i + 250])
        print("  NEW:", y[max(0, i - 150) : i + 250])


def lines(old, new, names):
    before = {c["name"]: c for c in load(old)["cards"]}
    for c in load(new)["cards"]:
        if c["name"] not in names or c["name"] not in before:
            continue
        for fo, fn in zip(before[c["name"]]["faces"], c["faces"]):
            for u in [u for u in fo.get("unparsed", []) if u not in fn.get("unparsed", [])]:
                print("##", c["name"], "|", u[:220])
                for ab in fn["abilities"]:
                    if ab.get("text") == u:
                        print("   ", json.dumps({k: v for k, v in ab.items() if k != "text"})[:600])


def nonfull(path, lo, hi):
    cards = [c for c in load(path)["cards"] if c.get("rank") and lo <= c["rank"] <= hi and level(c) != "full"]
    for c in sorted(cards, key=lambda c: c["rank"]):
        print(c["rank"], c["name"], "|", level(c), "|", " // ".join(unread(c))[:240])


def grep(path, pattern):
    r = re.compile(pattern)
    out = []
    for c in load(path)["cards"]:
        for f in c["faces"]:
            m = r.search(f.get("oracle") or "")
            if m:
                out.append((c.get("rank") or 99999, c["name"], level(c), m.group(0)[:220]))
                break
    for row in sorted(out):
        print(*row, sep=" | ")
    print(len(out), "cards")


def tops(path):
    cards = load(path)["cards"]
    for n in (1000, 2000, 5000, 10000):
        cs = [c for c in cards if c.get("rank") and c["rank"] <= n]
        full = sum(1 for c in cs if level(c) == "full")
        print(f"top{n}: {100 * full / len(cs):.1f}% ({full}/{len(cs)})")
    total = collections.Counter(level(c) for c in cards)
    print("all:", ", ".join(f"{k} {v} ({100 * v / len(cards):.1f}%)" for k, v in total.most_common()))


def focus(old, new, out, extra):
    a = {(c.get("id") or c["name"]): c for c in load(old)["cards"]}

    def key(c):
        return json.dumps([f["abilities"] for f in c["faces"]] + [f.get("keywords") for f in c["faces"]])

    names = set(extra)
    for c in load(new)["cards"]:
        if level(c) != "full":
            continue
        o = a.get(c.get("id") or c["name"])
        if not o or level(o) != "full" or key(o) != key(c):
            names.add(c["name"])
    print(len(names))
    with open(out, "w") as f:
        f.write("^(" + "|".join(re.escape(n) for n in sorted(names)) + ")$")


def sample(path, n, seed, lo=None, hi=None):
    def interesting(c):
        if level(c) != "full":
            return False
        rank = c.get("rank") or 10**9
        if (lo is not None and rank < lo) or (hi is not None and rank > hi):
            return False
        text = " ".join(f.get("oracle", "") for f in c["faces"])
        abilities = [a for f in c["faces"] for a in f.get("abilities", [])]
        return len(text) > 70 and any(a.get("kind") != "mana" for a in abilities)

    pool = [c for c in load(path)["cards"] if interesting(c)]
    random.seed(seed)
    keep = ("name", "manaCost", "typeLine", "power", "toughness", "loyalty", "oracle", "keywords", "abilities")
    picked = [{"name": c["name"], "rank": c.get("rank"), "faces": [{k: f.get(k) for k in keep} for f in c["faces"]]} for c in random.sample(pool, min(n, len(pool)))]
    json.dump(picked, sys.stdout, indent=1)


def templates(path, show=30):
    count, example = collections.Counter(), {}
    for c in load(path)["cards"]:
        for u in unread(c):
            t = re.sub(r"\{[^}]+\}", "{M}", u)
            t = re.sub(r"\b\d+\b", "N", t)
            k = " ".join(t.split()[:5])
            count[k] += 1
            example.setdefault(k, (c.get("rank"), c["name"], u[:110]))
    for k, n in count.most_common(show):
        print(n, "|", k, "|", example[k])


def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, a = argv[1], argv[2:]
    if cmd == "gained":
        gained(a[0], a[1])
    elif cmd == "astdiff":
        astdiff(a[0], a[1], int(a[2]) if len(a) > 2 else 30)
    elif cmd == "lines":
        lines(a[0], a[1], set(a[2:]))
    elif cmd == "nonfull":
        nonfull(a[0], int(a[1]), int(a[2]))
    elif cmd == "grep":
        grep(a[0], a[1])
    elif cmd == "tops":
        tops(a[0])
    elif cmd == "focus":
        focus(a[0], a[1], a[2], a[3:])
    elif cmd == "sample":
        sample(a[0], int(a[1]), int(a[2]), int(a[3]) if len(a) > 3 else None, int(a[4]) if len(a) > 4 else None)
    elif cmd == "templates":
        templates(a[0], int(a[1]) if len(a) > 1 else 30)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
