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
  pool.py set FILE CODE[,CODE…] [OLD]   a set's intake: how its cards fare and what blocks the ones that don't read
                                        (OLD: an older pool — only the cards that weren't in it)
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


WORD = re.compile(r"[a-z][a-z'\-]*")


def intake(path, codes, older=None, show=14):
    """How a set's cards fare with nobody having looked at them, and what blocks the ones that don't read.

    For every unread line: is it a keyword line the grammar doesn't know ("Beam me up {3}{G}"), does it use a word the
    grammar has never read anywhere in the pool (a new mechanic or term), or only words it knows, in an arrangement it
    doesn't (wording)? The words and the phrases that block the most cards come first: fix a cause, not a card.
    """
    cards = load(path)["cards"]

    def strip_names(text, card):
        for f in card["faces"]:
            n = f["name"]
            for part in sorted({n, n.split(",")[0], n.split(" // ")[0]}, key=len, reverse=True):
                text = text.replace(part, "~")
        return text

    def words(text):
        return set(WORD.findall(re.sub(r"\([^)]*\)", "", text).lower()))

    def texts(n):
        if isinstance(n, list):
            for v in n:
                yield from texts(v)
        elif isinstance(n, dict):
            if isinstance(n.get("text"), str) and n.get("kind"):
                yield n["text"]
            for v in n.values():
                yield from texts(v)

    # Every word in a line the grammar read, on any card.
    vocab = set()
    for c in cards:
        for f in c["faces"]:
            for t in texts(f.get("abilities", [])):
                vocab |= words(strip_names(t, c))
            for k in f.get("keywords", []):
                vocab |= words(k.get("text") or k.get("id", "").replace("_", " "))
    old = {c["name"] for c in load(older)["cards"]} if older else None
    sel = [c for c in cards if c["set"] in codes and (old is None or c["name"] not in old)]
    g = collections.Counter(level(c) for c in sel)
    n = max(1, len(sel))
    print(f"{'+'.join(sorted(codes))}{' (cards not in the older pool)' if older else ''}: {len(sel)} cards — fully automatic {g['full']} ({100 * g['full'] / n:.0f}%), partly {g['partial']}, by hand {g['manual']}")
    kinds = collections.Counter()
    novel, phrases, keywords, wording = collections.defaultdict(set), collections.defaultdict(set), collections.defaultdict(set), []
    total = 0
    for c in sel:
        if level(c) == "full":
            continue
        for u in unread(c):
            total += 1
            line = re.sub(r" ?\([^)]*\)", "", strip_names(u, c)).strip()
            if re.match(r"^[A-Z][\w' -]{1,30}(?: \{[^}]+\})+$|^[A-Z][\w' -]{1,30}—[^.:]+$", line) or not re.search(r"[.:,]", line):
                kinds["a keyword line the grammar doesn't know"] += 1
                keywords[re.sub(r"\{[^}]+\}|\d+", "N", line)].add(c["name"])
                continue
            oov = sorted(w for w in words(line) if w not in vocab and len(w) > 2)
            if oov:
                kinds["a word the grammar has never read"] += 1
                for w in oov:
                    novel[w].add(c["name"])
            else:
                kinds["known words, unread arrangement"] += 1
                wording.append((c.get("rank") or 99999, c["name"], u))
            ws = re.findall(r"[a-z~'][a-z'~-]*", re.sub(r"\{[^}]+\}|\d+", "N", line).lower())
            for k in (2, 3):
                for i in range(len(ws) - k + 1):
                    phrases[" ".join(ws[i : i + k])].add(c["name"])
    print(f"{len(sel) - g['full']} cards don't read in full: {total} unread lines")
    for k, v in kinds.most_common():
        print(f"  {v:4d} ({100 * v / max(1, total):.0f}%)  {k}")
    if keywords:
        print("keyword lines:")
        for k, cs in sorted(keywords.items(), key=lambda kv: -len(kv[1]))[:show]:
            print(f"  {len(cs):3d}  {k}")
    print("new words, by the cards they block:")
    for w, cs in sorted(novel.items(), key=lambda kv: -len(kv[1]))[:show]:
        print(f"  {len(cs):3d}  {w}   (e.g. {sorted(cs)[0]})")
    # Phrases that recur in this set's unread lines and are rare in the pool's read text: its own mechanics and turns of phrase.
    common = {"the", "a", "an", "of", "to", "you", "your", "it", "and", "or", "that", "this", "at", "if", "in", "on", "with", "for", "is", "are", "then", "each", "its", "may", "up", "from", "have", "has", "they", "their", "target", "creature", "card", "cards", "creatures", "control", "until", "end", "turn", "put", "into", "when", "whenever", "beginning", "next", "n", "~", "counter", "counters", "battlefield", "library", "graveyard", "hand", "enters", "draw"}
    print("phrases that recur in the unread lines:")
    shown = 0
    for ph, cs in sorted(phrases.items(), key=lambda kv: -len(kv[1])):
        if shown >= show or len(cs) < 3:
            break
        if all(w in common for w in ph.split()):
            continue
        print(f"  {len(cs):3d}  {ph}")
        shown += 1
    print("known words, unread arrangement — the most played first:")
    for _, name, u in sorted(wording)[:show]:
        print(f"  {name}: {u[:160]}")


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
    elif cmd == "set":
        intake(a[0], set(a[1].split(",")), a[2] if len(a) > 2 else None)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
