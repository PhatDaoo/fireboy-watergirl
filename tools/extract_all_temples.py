import os
import re
import json
import zlib
import struct
import math

WORKSPACE_ROOT = r"a:\Game Project\fireboy-watergirl"

TEMPLE_CONFIGS = [
    {
        "id": "light",
        "title": "Light Temple",
        "folder": "Light Temple",
        "swf": "FireBoyAndWaterGirl - Light Temple.swf",
        "out_js": "js/light_gamedata.js",
        "json_levels": None,
    },
    {
        "id": "ice",
        "title": "Ice Temple",
        "folder": "Ice Temple",
        "swf": "FireBoyAndWaterGirl - Ice Temple.swf",
        "out_js": "js/ice_gamedata.js",
        "json_levels": None,
    },
    {
        "id": "crystal",
        "title": "Crystal Temple",
        "folder": "Crystal Temple",
        "swf": "FireBoyAndWaterGirl - Crystal Temple.swf",
        "out_js": "js/crystal_gamedata.js",
        "json_levels": os.path.join("binaryData", "265_level_JsonData.bin"),
    },
]

# ---------- SWF Binary Parser ----------
class BitReader:
    def __init__(self, data, byte_offset=0):
        self.data = data
        self.byte_pos = byte_offset
        self.bit_pos = 0

    def align(self):
        if self.bit_pos > 0:
            self.byte_pos += 1
            self.bit_pos = 0

    def read_ub(self, n):
        if n == 0:
            return 0
        val = 0
        for _ in range(n):
            b = self.data[self.byte_pos]
            bit = (b >> (7 - self.bit_pos)) & 1
            val = (val << 1) | bit
            self.bit_pos += 1
            if self.bit_pos == 8:
                self.bit_pos = 0
                self.byte_pos += 1
        return val

    def read_sb(self, n):
        if n == 0:
            return 0
        val = self.read_ub(n)
        if val & (1 << (n - 1)):
            val -= (1 << n)
        return val

    def read_fb(self, n):
        return self.read_sb(n) / 65536.0

    def read_rect(self):
        self.align()
        nbits = self.read_ub(5)
        xmin = self.read_sb(nbits) / 20.0
        xmax = self.read_sb(nbits) / 20.0
        ymin = self.read_sb(nbits) / 20.0
        ymax = self.read_sb(nbits) / 20.0
        self.align()
        return (xmin, ymin, xmax, ymax)

    def read_matrix(self):
        self.align()
        sx, sy = 1.0, 1.0
        if self.read_ub(1):
            nbits = self.read_ub(5)
            sx = self.read_fb(nbits)
            sy = self.read_fb(nbits)
        sk0, sk1 = 0.0, 0.0
        if self.read_ub(1):
            nbits = self.read_ub(5)
            sk0 = self.read_fb(nbits)
            sk1 = self.read_fb(nbits)
        nbits = self.read_ub(5)
        tx = self.read_sb(nbits) / 20.0
        ty = self.read_sb(nbits) / 20.0
        self.align()
        return (sx, sk0, sk1, sy, tx, ty)

def skip_filter_list(tdata, pos):
    nfilters = tdata[pos]
    pos += 1
    for _ in range(nfilters):
        fid = tdata[pos]
        pos += 1
        if fid == 0:
            pos += 23
        elif fid == 1:
            pos += 9
        elif fid == 2:
            pos += 15
        elif fid == 3:
            pos += 27
        elif fid == 4:
            nc = tdata[pos]
            pos += 1 + nc * 5 + 19
        elif fid == 5:
            mx, my = tdata[pos], tdata[pos + 1]
            pos += 2 + mx * my * 4 + 13
        elif fid == 6:
            pos += 80
        elif fid == 7:
            nc = tdata[pos]
            pos += 1 + nc * 5 + 19
    return pos

def iter_tags(data, start_pos=0):
    pos = start_pos
    n = len(data)
    while pos + 2 <= n:
        record_header = struct.unpack("<H", data[pos:pos + 2])[0]
        pos += 2
        tag_type = record_header >> 6
        tag_len = record_header & 0x3F
        if tag_len == 0x3F:
            if pos + 4 > n:
                break
            tag_len = struct.unpack("<I", data[pos:pos + 4])[0]
            pos += 4
        tag_data = data[pos:pos + tag_len]
        pos += tag_len
        yield tag_type, tag_data
        if tag_type == 0:
            break

def read_cstring(buf, pos):
    end = buf.find(b"\x00", pos)
    if end == -1:
        return buf[pos:].decode("utf-8", errors="replace"), len(buf)
    return buf[pos:end].decode("utf-8", errors="replace"), end + 1

def parse_place_object2_or_3(tag_type, tdata):
    br = BitReader(tdata, 0)
    if tag_type == 26:
        has_clip_actions = br.read_ub(1)
        has_clip_depth = br.read_ub(1)
        has_name = br.read_ub(1)
        has_ratio = br.read_ub(1)
        has_cxform = br.read_ub(1)
        has_matrix = br.read_ub(1)
        has_char = br.read_ub(1)
        move = br.read_ub(1)
        depth = struct.unpack("<H", tdata[1:3])[0]
        pos = 3
        cid = None
        if has_char:
            cid = struct.unpack("<H", tdata[pos:pos + 2])[0]
            pos += 2
        matrix = None
        if has_matrix:
            mbr = BitReader(tdata, pos)
            matrix = mbr.read_matrix()
            pos = mbr.byte_pos
        if has_cxform:
            cbr = BitReader(tdata, pos)
            has_add = cbr.read_ub(1)
            has_mult = cbr.read_ub(1)
            nbits = cbr.read_ub(4)
            if has_mult:
                cbr.read_ub(nbits * 4)
            if has_add:
                cbr.read_ub(nbits * 4)
            cbr.align()
            pos = cbr.byte_pos
        if has_ratio:
            pos += 2
        name = None
        if has_name:
            name, pos = read_cstring(tdata, pos)
        return {"depth": depth, "cid": cid, "matrix": matrix, "name": name}
    else:
        flags1 = tdata[0]
        flags2 = tdata[1]
        has_name = (flags1 >> 5) & 1
        has_ratio = (flags1 >> 4) & 1
        has_cxform = (flags1 >> 3) & 1
        has_matrix = (flags1 >> 2) & 1
        has_char = (flags1 >> 1) & 1
        has_cache = (flags2 >> 2) & 1
        has_blend = (flags2 >> 1) & 1
        has_filters = flags2 & 1
        has_class_name = (flags2 >> 3) & 1
        depth = struct.unpack("<H", tdata[2:4])[0]
        pos = 4
        if has_class_name:
            _, pos = read_cstring(tdata, pos)
        cid = None
        if has_char:
            cid = struct.unpack("<H", tdata[pos:pos + 2])[0]
            pos += 2
        matrix = None
        if has_matrix:
            mbr = BitReader(tdata, pos)
            matrix = mbr.read_matrix()
            pos = mbr.byte_pos
        if has_cxform:
            cbr = BitReader(tdata, pos)
            has_add = cbr.read_ub(1)
            has_mult = cbr.read_ub(1)
            nbits = cbr.read_ub(4)
            if has_mult:
                cbr.read_ub(nbits * 4)
            if has_add:
                cbr.read_ub(nbits * 4)
            cbr.align()
            pos = cbr.byte_pos
        if has_ratio:
            pos += 2
        name = None
        if has_name:
            name, pos = read_cstring(tdata, pos)
        if flags1 & 0x40:
            pos += 2
        if has_filters:
            pos = skip_filter_list(tdata, pos)
        if has_blend:
            pos += 1
        if has_cache:
            pos += 1
        return {"depth": depth, "cid": cid, "matrix": matrix, "name": name}

def mat_mul(m1, m2):
    a1, c1, b1, d1, tx1, ty1 = m1
    a2, c2, b2, d2, tx2, ty2 = m2
    return (
        a1 * a2 + b1 * c2,
        c1 * a2 + d1 * c2,
        a1 * b2 + b1 * d2,
        c1 * b2 + d1 * d2,
        a1 * tx2 + b1 * ty2 + tx1,
        c1 * tx2 + d1 * ty2 + ty1,
    )

def transform_rect(rect, m):
    xmin, ymin, xmax, ymax = rect
    a, c, b, d, tx, ty = m
    pts = [
        (a * xmin + b * ymin + tx, c * xmin + d * ymin + ty),
        (a * xmax + b * ymin + tx, c * xmax + d * ymin + ty),
        (a * xmin + b * ymax + tx, c * xmin + d * ymax + ty),
        (a * xmax + b * ymax + tx, c * xmax + d * ymax + ty),
    ]
    return (
        min(p[0] for p in pts),
        min(p[1] for p in pts),
        max(p[0] for p in pts),
        max(p[1] for p in pts),
    )

def union_rect(r1, r2):
    if r1 is None:
        return r2
    if r2 is None:
        return r1
    return (min(r1[0], r2[0]), min(r1[1], r2[1]), max(r1[2], r2[2]), max(r1[3], r2[3]))

def parse_swf(swf_path):
    with open(swf_path, "rb") as f:
        raw = f.read()
    sig = raw[:3]
    body = zlib.decompress(raw[8:]) if sig == b"CWS" else raw[8:]
    br = BitReader(body, 0)
    stage_rect = br.read_rect()
    fps_raw = struct.unpack("<H", body[br.byte_pos:br.byte_pos + 2])[0]
    fps = fps_raw / 256.0
    pos = br.byte_pos + 4

    char_bounds = {}
    sprites_info = {}
    symbol_classes = {}
    buttons_info = {}

    for tag_type, tdata in iter_tags(body, pos):
        if tag_type in (2, 22, 32, 83):
            cid = struct.unpack("<H", tdata[:2])[0]
            sbr = BitReader(tdata, 2)
            char_bounds[cid] = sbr.read_rect()
        elif tag_type in (7, 34):
            cid = struct.unpack("<H", tdata[:2])[0]
            buttons_info[cid] = []
            if tag_type == 34:
                action_offset = struct.unpack("<H", tdata[3:5])[0]
                bpos = 5
                limit = 3 + action_offset if action_offset > 0 else len(tdata)
                while bpos < limit and bpos < len(tdata):
                    flags = tdata[bpos]
                    bpos += 1
                    if flags == 0:
                        break
                    bcid = struct.unpack("<H", tdata[bpos:bpos + 2])[0]
                    bpos += 4
                    mbr = BitReader(tdata, bpos)
                    mat = mbr.read_matrix()
                    bpos = mbr.byte_pos
                    cbr = BitReader(tdata, bpos)
                    has_add = cbr.read_ub(1)
                    has_mult = cbr.read_ub(1)
                    nbits = cbr.read_ub(4)
                    if has_mult:
                        cbr.read_ub(nbits * 4)
                    if has_add:
                        cbr.read_ub(nbits * 4)
                    cbr.align()
                    bpos = cbr.byte_pos
                    if flags & 0x10:
                        bpos = skip_filter_list(tdata, bpos)
                    if flags & 0x20:
                        bpos += 1
                    buttons_info[cid].append({"cid": bcid, "matrix": mat})
        elif tag_type == 39:
            cid = struct.unpack("<H", tdata[:2])[0]
            fcount = struct.unpack("<H", tdata[2:4])[0]
            display_list = {}
            frame1_places = []
            all_placements = []
            frame_idx = 0
            for stype, sdata in iter_tags(tdata, 4):
                if stype in (26, 70):
                    p = parse_place_object2_or_3(stype, sdata)
                    d = p["depth"]
                    if d in display_list:
                        if p["cid"] is not None:
                            display_list[d]["cid"] = p["cid"]
                        if p["matrix"] is not None:
                            display_list[d]["matrix"] = p["matrix"]
                        if p["name"] is not None:
                            display_list[d]["name"] = p["name"]
                    else:
                        if p["matrix"] is None:
                            p["matrix"] = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                        display_list[d] = dict(p)
                    if display_list[d].get("cid") is not None:
                        all_placements.append(dict(display_list[d]))
                elif stype == 28:
                    d = struct.unpack("<H", sdata[:2])[0]
                    display_list.pop(d, None)
                elif stype == 1:
                    if frame_idx == 0:
                        frame1_places = [dict(v) for k, v in sorted(display_list.items()) if v.get("cid") is not None]
                    frame_idx += 1
            sprites_info[cid] = {
                "frameCount": fcount,
                "frame1": frame1_places,
                "all_placements": all_placements,
            }
        elif tag_type == 76:
            num = struct.unpack("<H", tdata[:2])[0]
            spos = 2
            for _ in range(num):
                cid = struct.unpack("<H", tdata[spos:spos + 2])[0]
                spos += 2
                name, spos = read_cstring(tdata, spos)
                symbol_classes[cid] = name

    bounds_cache = {}
    def get_char_bounds(cid, visited=None):
        if cid in bounds_cache:
            return bounds_cache[cid]
        if cid in char_bounds:
            bounds_cache[cid] = char_bounds[cid]
            return char_bounds[cid]
        if visited is None:
            visited = set()
        if cid in visited:
            return None
        visited.add(cid)
        rect = None
        if cid in sprites_info:
            for ch in sprites_info[cid]["all_placements"]:
                cb = get_char_bounds(ch["cid"], set(visited))
                if cb is not None:
                    rect = union_rect(rect, transform_rect(cb, ch["matrix"]))
        elif cid in buttons_info:
            for ch in buttons_info[cid]:
                cb = get_char_bounds(ch["cid"], set(visited))
                if cb is not None:
                    rect = union_rect(rect, transform_rect(cb, ch["matrix"]))
        bounds_cache[cid] = rect
        return rect

    for cid in list(sprites_info.keys()) + list(buttons_info.keys()):
        get_char_bounds(cid)

    return {
        "stage_width": int(stage_rect[2] - stage_rect[0]),
        "stage_height": int(stage_rect[3] - stage_rect[1]),
        "fps": fps,
        "char_bounds": char_bounds,
        "sprites_info": sprites_info,
        "buttons_info": buttons_info,
        "symbol_classes": symbol_classes,
        "get_char_bounds": get_char_bounds,
    }

def read_png_size(path):
    with open(path, "rb") as f:
        header = f.read(24)
    if len(header) >= 24 and header[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", header[16:24])
        return w, h
    return 0, 0

# ---------- Game.as Parser ----------
def parse_game_as(game_as_path, temple_id=None):
    with open(game_as_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    m_trans = re.search(r"Translation\s*=\s*new Array\(([^)]+)\)", text)
    trans_items = re.findall(r'"([^"]+)"', m_trans.group(1))

    m_tt = re.search(r"TimeTable\s*=\s*new Array\(([^)]+)\)", text)
    time_items = [int(x.strip()) for x in m_tt.group(1).split(",") if x.strip()]

    num_nodes = len(trans_items)
    adj_sets = {i: set() for i in range(1, num_nodes + 1)}

    # Check for statement-based Adjacencies[a][b] = 1; (Light, Ice, Crystal)
    adj_edges = re.findall(r"this\.Adjacencies\[(\d+)\]\[(\d+)\]\s*=\s*1\s*;", text)
    if adj_edges:
        is_one_based = (temple_id == "crystal")
        for a_str, b_str in adj_edges:
            a = int(a_str)
            b = int(b_str)
            if is_one_based:
                if a <= 0 or b <= 0:
                    continue
                na, nb = a, b
            else:
                na, nb = a + 1, b + 1
            if 1 <= na <= num_nodes and 1 <= nb <= num_nodes and na != nb:
                adj_sets[na].add(nb)
                adj_sets[nb].add(na)
    else:
        m_adj = re.search(r"Adjacencies\s*=\s*new Array\(([^;]+)\);", text)
        if m_adj:
            adj_rows = re.findall(r"\[([^\]]*)\]", m_adj.group(1))
            for idx, r in enumerate(adj_rows):
                n_idx = idx + 1
                if n_idx <= num_nodes:
                    for x in r.split(","):
                        if x.strip():
                            adj_sets[n_idx].add(int(x.strip()))

    type_map = {1: "adventure", 2: "puzzle", 3: "speed", 4: "dark"}
    nodes = []
    for idx, code in enumerate(trans_items):
        t_id, lvl_num = [int(x) for x in code.split("_")]
        n_num = idx + 1
        nodes.append({
            "node": n_num,
            "code": code,
            "typeId": t_id,
            "mode": type_map.get(t_id, "adventure"),
            "levelNum": lvl_num,
            "parTime": time_items[idx] if idx < len(time_items) else 0,
            "nextNodes": sorted(adj_sets.get(n_num, set())),
            "nodeName": f"n{code}",
            "buttonName": f"b{code}",
            "goldName": f"g{code}",
        })
    return {"nodes": nodes, "adjacencies": [sorted(adj_sets[i]) for i in range(1, num_nodes + 1)]}

# ---------- level.as Parser (Light & Ice) ----------
def split_args(arg_str):
    args = []
    depth = 0
    cur = []
    in_str = False
    str_ch = ""
    for ch in arg_str:
        if in_str:
            cur.append(ch)
            if ch == str_ch:
                in_str = False
        else:
            if ch in ('"', "'"):
                in_str = True
                str_ch = ch
                cur.append(ch)
            elif ch in ("(", "["):
                depth += 1
                cur.append(ch)
            elif ch in (")", "]"):
                depth -= 1
                cur.append(ch)
            elif ch == "," and depth == 0:
                args.append("".join(cur).strip())
                cur = []
            else:
                cur.append(ch)
    if cur:
        args.append("".join(cur).strip())
    return args

def eval_num(expr):
    expr = expr.strip().replace("Math.PI", str(math.pi))
    expr = expr.replace("this.freezeColor", "11596281").replace("this.meltColor", "16677980")
    if expr == "true":
        return True
    if expr == "false":
        return False
    try:
        return float(eval(expr, {"__builtins__": {}}, {}))
    except Exception:
        return expr

def parse_vec2(expr):
    m = re.match(r"new b2Vec2\((.+)\)$", expr.strip())
    if not m:
        return None
    parts = split_args(m.group(1))
    return {"x": float(eval_num(parts[0])), "y": float(eval_num(parts[1]))}

def normalize_cell(v):
    v = v.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    try:
        return int(v)
    except ValueError:
        return v

def parse_as_level_block(mode, level_num, block):
    # Extract grid (either .push(new Array(...)) or this.LevelArray = new Array(new Array(...), ...))
    grid = []
    m_la = re.search(r"this\.LevelArray\s*=\s*new Array\((new Array\(.+\))\)\s*;", block)
    if m_la:
        for rm in re.finditer(r"new Array\(([^()]+)\)", m_la.group(1)):
            row_vals = [normalize_cell(x) for x in split_args(rm.group(1))]
            grid.append(row_vals)
    else:
        grid_pattern = re.compile(r"(?:_loc\d+_|LevelArray\d*)\.push\(new Array\(([^;]+)\)\);")
        for m in grid_pattern.finditer(block):
            row_vals = [normalize_cell(x) for x in split_args(m.group(1))]
            grid.append(row_vals)

    bd_count = sum(1 for row in grid for c in row if c == "bd")
    rd_count = sum(1 for row in grid for c in row if c == "rd")
    gr_count = sum(1 for row in grid for c in row if c == "gr")

    start_fire = None
    start_water = None
    finish = None
    slide_platforms = []
    rot_platforms = []
    pushers = []
    levers = []
    winds = []
    balls = []
    moving_boxes = []
    moving_boxes2 = []
    pulleys = []
    hanging_platforms = []
    romans = []
    jumpers = []
    light_beamers = []
    light_pushers = []
    rot_mirrors = []
    infinite_mirrors = []
    moving_mirrors = []
    mirror_sliders = []
    timed_pushers = []
    ice_blocks = []

    my_actuateds = []
    my_actuateds2 = []
    my_actuateds3 = []
    my_actuateds4 = []
    my_actuateds5 = []

    call_re = re.compile(r"([A-Za-z0-9_]+)\(([^;]*)\)\s*;")
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("this.LevelArray") or ".push(new Array(" in line:
            continue
        if "this.StartPosFire" in line:
            m_sf = re.search(r"new b2Vec2\([^)]+\)", line)
            if m_sf:
                start_fire = parse_vec2(m_sf.group(0))
            continue
        if "this.StartPosWater" in line:
            m_sw = re.search(r"new b2Vec2\([^)]+\)", line)
            if m_sw:
                start_water = parse_vec2(m_sw.group(0))
            continue
        # Match statements with `this.Create...` or `addToMechanism` or `myActuateds*.push`
        if "this.Create" in line:
            idx = line.find("this.Create")
            sub = line[idx + 5:]
            m = re.match(r"([A-Za-z0-9_]+)\((.+)\)", sub)
            if not m:
                continue
            fn = m.group(1)
            # Strip trailing ); or )
            raw_args = m.group(2)
            # Find balanced closing paren for fn(
            depth = 1
            end_i = 0
            for ci, ch in enumerate(sub[len(fn) + 1:]):
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        end_i = ci
                        break
            args = split_args(sub[len(fn) + 1:len(fn) + 1 + end_i])

            if fn == "CreateStartFire":
                start_fire = parse_vec2(args[0])
            elif fn == "CreateStartWater":
                start_water = parse_vec2(args[0])
            elif fn == "CreateFinish":
                finish = {"fire": parse_vec2(args[0]), "water": parse_vec2(args[1])}
            elif fn == "CreateSlidePlatform":
                idx_sp = len(slide_platforms)
                if len(args) >= 9:
                    # Light/Ice: CreateSlidePlatform(pos, halfW, halfH, dir, lower, upper, extra, controlledBy, colorId)
                    hw = float(eval_num(args[1]))
                    hh = float(eval_num(args[2]))
                    dir_v = parse_vec2(args[3])
                    lower_v = float(eval_num(args[4]))
                    upper_v = float(eval_num(args[5]))
                    ctrl = normalize_cell(args[7])
                    color_v = int(eval_num(args[8]))
                    slide_platforms.append({
                        "id": idx_sp,
                        "pos": parse_vec2(args[0]),
                        "halfWidth": hw,
                        "halfHeight": hh,
                        "halfSize": {"x": hw, "y": hh},
                        "color": color_v,
                        "axis": dir_v,
                        "dir": dir_v,
                        "lower": lower_v,
                        "upper": upper_v,
                        "distance": abs(lower_v),
                        "controlledBy": ctrl,
                    })
                    if ctrl == "pusher":
                        my_actuateds.append(("slidePlatform", idx_sp))
                    elif ctrl == "lever":
                        my_actuateds2.append(("slidePlatform", idx_sp))
                    elif ctrl == "light":
                        my_actuateds3.append(("slidePlatform", idx_sp))
                    elif ctrl == "timed":
                        my_actuateds5.append(("slidePlatform", idx_sp))
                else:
                    slide_platforms.append({
                        "id": idx_sp,
                        "pos": parse_vec2(args[0]),
                        "halfSize": parse_vec2(args[1]),
                        "color": int(eval_num(args[2])),
                        "dir": parse_vec2(args[3]),
                        "distance": float(eval_num(args[4])),
                        "extra": float(eval_num(args[5])) if len(args) > 5 else 0.0,
                    })
            elif fn == "CreateRotPlatform":
                rot_platforms.append({
                    "id": len(rot_platforms),
                    "pos": parse_vec2(args[0]),
                    "halfSize": parse_vec2(args[1]),
                    "color": int(eval_num(args[2])),
                    "angle": float(eval_num(args[3])) if len(args) > 3 else 0.0,
                })
            elif fn == "CreatePusher":
                pushers.append({
                    "id": len(pushers),
                    "pos": parse_vec2(args[0]),
                    "param2": float(eval_num(args[1])),
                    "color": int(eval_num(args[2])),
                    "soundable": bool(args[3].strip() == "true") if len(args) > 3 else True,
                    "target": None,
                })
            elif fn == "CreateLever":
                a1 = normalize_cell(args[1])
                a2 = normalize_cell(args[2])
                a3 = normalize_cell(args[3])
                if isinstance(a1, (int, float)) and a2 in ("l", "r"):
                    # Light / Ice Temple: CreateLever(pos, colorId, onIs, beginOn, soundable)
                    color_id = int(a1)
                    on_dir = 1 if a2 == "r" else -1
                    begin_on = (a3 == a2)
                else:
                    on_dir = int(eval_num(args[1]))
                    begin_on = bool(args[2].strip() == "true")
                    color_id = int(eval_num(args[3]))
                levers.append({
                    "id": len(levers),
                    "pos": parse_vec2(args[0]),
                    "onDir": on_dir,
                    "beginOn": begin_on,
                    "color": color_id,
                    "target": None,
                })
            elif fn == "CreateLightBeamer":
                light_beamers.append({
                    "id": len(light_beamers),
                    "pos": parse_vec2(args[0]),
                    "angle": float(eval_num(args[1])),
                    "color": int(eval_num(args[2])),
                })
            elif fn == "CreateLightPusher":
                light_pushers.append({
                    "id": len(light_pushers),
                    "pos": parse_vec2(args[0]),
                    "param2": float(eval_num(args[1])),
                    "color": int(eval_num(args[2])),
                    "soundable": bool(args[3].strip() == "true") if len(args) > 3 else True,
                    "target": None,
                })
            elif fn == "CreateTimedPusher":
                timed_pushers.append({
                    "id": len(timed_pushers),
                    "pos": parse_vec2(args[0]),
                    "param2": float(eval_num(args[1])),
                    "color": int(eval_num(args[2])),
                    "soundable": bool(args[3].strip() == "true") if len(args) > 3 else True,
                    "delay": float(eval_num(args[4])) if len(args) > 4 else 5.0,
                    "target": None,
                })
            elif fn == "CreateRotMirror":
                rot_mirrors.append({
                    "id": len(rot_mirrors),
                    "pos": parse_vec2(args[0]),
                    "halfSize": {"x": float(eval_num(args[1])), "y": float(eval_num(args[2]))},
                    "color": int(eval_num(args[3])),
                    "inverted": bool(args[4].strip() == "true") if len(args) > 4 else False,
                })
            elif fn == "CreateInfiniteMirror":
                infinite_mirrors.append({
                    "id": len(infinite_mirrors),
                    "pos": parse_vec2(args[0]),
                    "halfSize": {"x": float(eval_num(args[1])), "y": float(eval_num(args[2]))},
                    "color": int(eval_num(args[3])),
                })
            elif fn == "CreateMovingMirror":
                moving_mirrors.append({
                    "id": len(moving_mirrors),
                    "pos": parse_vec2(args[0]),
                    "halfSize": parse_vec2(args[1]),
                    "angleDeg": float(eval_num(args[2])) if len(args) > 2 else 0.0,
                })
            elif fn == "CreateMirrorSlider":
                mirror_sliders.append({
                    "id": len(mirror_sliders),
                    "pos": parse_vec2(args[0]),
                    "length": float(eval_num(args[1])),
                    "angleDeg": float(eval_num(args[2])),
                    "color": int(eval_num(args[3])),
                    "inverted": bool(args[4].strip() == "true") if len(args) > 4 else False,
                })
            elif fn == "CreateWind":
                winds.append({
                    "id": len(winds),
                    "pos": parse_vec2(args[0]),
                    "lower": parse_vec2(args[1]),
                    "upper": parse_vec2(args[2]),
                    "vert": bool(args[3].strip() == "true") if len(args) > 3 else True,
                    "alwaysOn": bool(args[4].strip() == "true") if len(args) > 4 else False,
                    "color": int(eval_num(args[5])) if len(args) > 5 else 1,
                })
            elif fn == "CreateBall":
                balls.append({"pos": parse_vec2(args[0]), "radius": float(eval_num(args[1])) if len(args) > 1 else 0.7})
            elif fn == "CreateMovingBox":
                moving_boxes.append({"pos": parse_vec2(args[0]), "halfSize": parse_vec2(args[1])})
            elif fn == "CreateMovingBox2":
                moving_boxes2.append({"pos": parse_vec2(args[0]), "halfSize": parse_vec2(args[1])})
            elif fn == "CreateIceBlock":
                ice_blocks.append({
                    "pos": parse_vec2(args[0]),
                    "halfSize": parse_vec2(args[1]),
                    "angle": float(eval_num(args[2])) if len(args) > 2 else 0.0,
                })
            elif fn == "CreatePulley":
                pulleys.append({
                    "anchor1": parse_vec2(args[0]),
                    "anchor2": parse_vec2(args[1]),
                    "size1": parse_vec2(args[2]),
                    "size2": parse_vec2(args[3]),
                    "pos1": parse_vec2(args[4]),
                    "pos2": parse_vec2(args[5]),
                    "inverted": bool(args[6].strip() == "true") if len(args) > 6 else False,
                })
            elif fn == "CreateHangingPlatform":
                hanging_platforms.append({
                    "pos": parse_vec2(args[0]),
                    "halfSize": parse_vec2(args[1]),
                    "ropeLen": float(eval_num(args[2])),
                })
            elif fn == "CreateRoman":
                romans.append({
                    "pos": parse_vec2(args[0]),
                    "param2": float(eval_num(args[1])),
                    "length": float(eval_num(args[2])),
                    "height": float(eval_num(args[3])),
                })
            elif fn == "CreateJumper":
                jumpers.append({"pos": parse_vec2(args[0]), "param2": float(eval_num(args[1]))})

        # Track myActuateds pushes
        for arr_name, target_list in [
            ("myActuateds.push", my_actuateds),
            ("myActuateds2.push", my_actuateds2),
            ("myActuateds3.push", my_actuateds3),
            ("myActuateds4.push", my_actuateds4),
            ("myActuateds5.push", my_actuateds5),
        ]:
            if arr_name in line:
                # Determine which recent object was pushed
                if "CreateSlidePlatform" in line:
                    target_list.append(("slide", len(slide_platforms) - 1))
                elif "CreateRotPlatform" in line:
                    target_list.append(("rot", len(rot_platforms) - 1))
                elif "CreateRotMirror" in line:
                    target_list.append(("rotMirror", len(rot_mirrors) - 1))
                elif "CreateInfiniteMirror" in line:
                    target_list.append(("infiniteMirror", len(infinite_mirrors) - 1))
                elif "CreateMirrorSlider" in line:
                    target_list.append(("mirrorSlider", len(mirror_sliders) - 1))
                elif "CreateWind" in line:
                    target_list.append(("wind", len(winds) - 1))
                elif "mySlidePlatforms" in line:
                    idx_m = re.search(r"mySlidePlatforms\[(\d+)\]", line)
                    if idx_m:
                        target_list.append(("slide", int(idx_m.group(1))))

    # Link actuators
    for i, p in enumerate(pushers):
        if i < len(my_actuateds):
            p["target"] = {"type": my_actuateds[i][0], "index": my_actuateds[i][1]}
    for j, lv in enumerate(levers):
        if j < len(my_actuateds2):
            lv["target"] = {"type": my_actuateds2[j][0], "index": my_actuateds2[j][1]}
    for k, lp in enumerate(light_pushers):
        if k < len(my_actuateds3):
            lp["target"] = {"type": my_actuateds3[k][0], "index": my_actuateds3[k][1]}
    for t, tp in enumerate(timed_pushers):
        if t < len(my_actuateds5):
            tp["target"] = {"type": my_actuateds5[t][0], "index": my_actuateds5[t][1]}

    return {
        "mode": mode,
        "levelNum": level_num,
        "rows": len(grid),
        "cols": len(grid[0]) if grid else 0,
        "bdCount": bd_count,
        "rdCount": rd_count,
        "grCount": gr_count,
        "startFire": start_fire,
        "startWater": start_water,
        "finish": finish,
        "slidePlatforms": slide_platforms,
        "rotPlatforms": rot_platforms,
        "pushers": pushers,
        "levers": levers,
        "lightBeamers": light_beamers,
        "lightPushers": light_pushers,
        "timedPushers": timed_pushers,
        "rotMirrors": rot_mirrors,
        "infiniteMirrors": infinite_mirrors,
        "movingMirrors": moving_mirrors,
        "mirrorSliders": mirror_sliders,
        "winds": winds,
        "balls": balls,
        "movingBoxes": moving_boxes,
        "movingBoxes2": moving_boxes2,
        "iceBlocks": ice_blocks,
        "pulleys": pulleys,
        "hangingPlatforms": hanging_platforms,
        "romans": romans,
        "jumpers": jumpers,
        "portalPairs": [],
        "grid": grid,
    }

def parse_as_levels(level_as_path):
    with open(level_as_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    mode_starts = [(m.group(1), m.start(), m.end()) for m in re.finditer(r'if\(param1 == "(\w+)"\)', text)]
    end_candidates = [
        text.find("function CreateGround("),
        text.find("this.CreateStalactites("),
        text.find("_loc9_ = 3 + Math.round"),
        len(text),
    ]
    last_mode_pos = mode_starts[-1][2] if mode_starts else 0
    valid_ends = [e for e in end_candidates if e > last_mode_pos]
    end_of_modes = min(valid_ends) if valid_ends else len(text)

    levels_by_key = {}
    for idx, (mode, mstart, mend) in enumerate(mode_starts):
        next_start = mode_starts[idx + 1][1] if idx + 1 < len(mode_starts) else end_of_modes
        section = text[mend:next_start]
        if mode == "test":
            levels_by_key["test_1"] = parse_as_level_block("test", 1, section)
        else:
            sub_starts = [(int(m.group(1)), m.start(), m.end()) for m in re.finditer(r'if\(param2 == (\d+)\)', section)]
            for sidx, (lnum, sstart, send) in enumerate(sub_starts):
                snext = sub_starts[sidx + 1][1] if sidx + 1 < len(sub_starts) else len(section)
                block = section[send:snext]
                levels_by_key[f"{mode}_{lnum}"] = parse_as_level_block(mode, lnum, block)
    return levels_by_key

# ---------- Crystal Temple JSON Levels ----------
CRYSTAL_COLORS = [12452093, 59392, 16777215, 16737792, 11596281, 15790080, 2128383]

def crystal_color_uint(color_idx):
    c = int(color_idx)
    if 0 <= c < len(CRYSTAL_COLORS):
        return CRYSTAL_COLORS[c]
    return 16777215

def parse_crystal_levels(json_bin_path, game_nodes):
    with open(json_bin_path, "r", encoding="utf-8") as f:
        raw_list = json.loads(f.read())

    levels_by_key = {}
    for idx, item in enumerate(raw_list):
        data = json.loads(item) if isinstance(item, str) else item
        node = game_nodes[idx]
        raw_grid = data["GroundArray"]
        grid = []
        for row in raw_grid:
            new_row = []
            for cell in row:
                s = str(cell).strip()
                if s in ("-1", "-2", "-3", "-4", "0", "1", "5", "6", "7"):
                    new_row.append(int(s))
                elif s == "53":
                    new_row.append(5)
                else:
                    new_row.append(s)
            grid.append(new_row)

        bd_count = sum(1 for r in grid for c in r if c == "bd")
        rd_count = sum(1 for r in grid for c in r if c == "rd")
        gr_count = sum(1 for r in grid for c in r if c == "gr")

        start_fire = None
        start_water = None
        end_fire = None
        end_water = None
        slide_platforms = []
        rot_platforms = []
        pushers = []
        levers = []
        light_beamers = []
        light_pushers = []
        timed_pushers = []
        rot_mirrors = []
        infinite_mirrors = []
        moving_mirrors = []
        mirror_sliders = []
        winds = []
        balls = []
        moving_boxes = []
        moving_boxes2 = []
        pulleys = []
        hanging_platforms = []
        romans = []
        portal_pairs = []

        # Map mechanism index -> actuator refs
        actuators_by_index = {}

        def reg_act(idx_val, t, i):
            iv = int(idx_val) if idx_val is not None else -1
            if iv >= 0:
                actuators_by_index.setdefault(iv, []).append({"type": t, "index": i})

        def safe_float(val, default=0.0):
            if val is None or val == "":
                return default
            return float(val)

        def safe_int(val, default=0):
            if val is None or val == "":
                return default
            return int(float(val))

        for o in data.get("ObjectsArray", []):
            t = o["type"]
            pos = {"x": safe_float(o["position"]["x"]), "y": safe_float(o["position"]["y"])} if "position" in o else {"x": 0.0, "y": 0.0}
            color_id = safe_int(o.get("color", 1), 1)
            m_idx = safe_int(o.get("index", -1), -1)

            if t == "StartFire":
                start_fire = pos
            elif t == "StartWater":
                start_water = pos
            elif t == "EndFire":
                end_fire = pos
            elif t == "EndWater":
                end_water = pos
            elif t == "SlidePlatform":
                idx_s = len(slide_platforms)
                d = o.get("dir", {"x": 1, "y": 0})
                slide_platforms.append({
                    "id": idx_s,
                    "pos": pos,
                    "halfSize": {"x": float(o.get("length", 3)) * 0.5, "y": 0.3},
                    "color": color_id,
                    "dir": {"x": float(d["x"]), "y": float(d["y"])},
                    "distance": float(o.get("distance", 3)),
                    "extra": 0.0,
                })
                reg_act(m_idx, "slide", idx_s)
            elif t == "Pusher":
                pushers.append({
                    "id": len(pushers),
                    "pos": pos,
                    "param2": 2.0,
                    "color": color_id,
                    "soundable": True,
                    "mechIndex": m_idx,
                    "target": None,
                })
            elif t == "Lever":
                levers.append({
                    "id": len(levers),
                    "pos": pos,
                    "onDir": 1 if o.get("Onis", "r") == "r" else -1,
                    "beginOn": o.get("BeginOn", "l") == o.get("Onis", "r"),
                    "color": color_id,
                    "mechIndex": m_idx,
                    "target": None,
                })
            elif t == "Emitter":
                light_beamers.append({
                    "id": len(light_beamers),
                    "pos": pos,
                    "angle": float(o.get("rotation", 0)) * math.pi / 180.0,
                    "color": crystal_color_uint(color_id),
                    "colorId": color_id,
                })
            elif t == "LightPusher":
                light_pushers.append({
                    "id": len(light_pushers),
                    "pos": pos,
                    "param2": float(o.get("rotation", 0)),
                    "color": crystal_color_uint(color_id),
                    "colorId": color_id,
                    "soundable": True,
                    "mechIndex": m_idx,
                    "target": None,
                })
            elif t == "TimedPusher":
                timed_pushers.append({
                    "id": len(timed_pushers),
                    "pos": pos,
                    "param2": 2.0,
                    "color": color_id,
                    "soundable": True,
                    "delay": float(o.get("delay", 5.0)),
                    "mechIndex": m_idx,
                    "target": None,
                })
            elif t == "RotMirror":
                idx_rm = len(rot_mirrors)
                rot_mirrors.append({
                    "id": idx_rm,
                    "pos": pos,
                    "halfSize": {"x": 0.9, "y": 0.05},
                    "color": color_id,
                    "angleDeg": float(o.get("rotation", 0)),
                    "inverted": False,
                })
                reg_act(m_idx, "rotMirror", idx_rm)
            elif t == "InfiniteMirror":
                idx_im = len(infinite_mirrors)
                infinite_mirrors.append({
                    "id": idx_im,
                    "pos": pos,
                    "halfSize": {"x": 0.9, "y": 0.1},
                    "color": color_id,
                    "angleDeg": float(o.get("rotation", 0)),
                })
                reg_act(m_idx, "infiniteMirror", idx_im)
            elif t == "MovingMirror":
                moving_mirrors.append({
                    "id": len(moving_mirrors),
                    "pos": pos,
                    "halfSize": {"x": 0.9, "y": 0.05},
                    "angleDeg": float(o.get("rotation", 0)),
                })
            elif t == "MirrorSlider":
                idx_ms = len(mirror_sliders)
                mirror_sliders.append({
                    "id": idx_ms,
                    "pos": pos,
                    "length": float(o.get("length", 4)),
                    "angleDeg": float(o.get("shift", 0)),
                    "color": color_id,
                    "inverted": False,
                })
                reg_act(m_idx, "mirrorSlider", idx_ms)
            elif t == "Wind":
                idx_w = len(winds)
                lw = o.get("lowerAA", {"x": 0, "y": 0})
                up = o.get("upperBB", {"x": 3, "y": 10})
                winds.append({
                    "id": idx_w,
                    "pos": pos,
                    "lower": {"x": float(lw["x"]), "y": float(lw["y"])},
                    "upper": {"x": float(up["x"]), "y": float(up["y"])},
                    "vert": bool(int(o.get("vert", 1)) == 1),
                    "alwaysOn": m_idx < 0,
                    "color": color_id,
                })
                reg_act(m_idx, "wind", idx_w)
            elif t == "Ball":
                balls.append({"pos": pos, "radius": 0.7})
            elif t == "MovingBox":
                moving_boxes.append({"pos": pos, "halfSize": {"x": 0.5, "y": 0.5}})
            elif t == "MovingBox2":
                moving_boxes2.append({"pos": pos, "halfSize": {"x": 0.5, "y": 0.5}})
            elif t == "Pulley":
                pulleys.append({
                    "anchor1": {"x": float(o["anchor1"]["x"]), "y": float(o["anchor1"]["y"])},
                    "anchor2": {"x": float(o["anchor2"]["x"]), "y": float(o["anchor2"]["y"])},
                    "size1": {"x": float(o["size1"]["x"]), "y": float(o["size1"]["y"])},
                    "size2": {"x": float(o["size2"]["x"]), "y": float(o["size2"]["y"])},
                    "pos1": {"x": float(o["pos1"]["x"]), "y": float(o["pos1"]["y"])},
                    "pos2": {"x": float(o["pos2"]["x"]), "y": float(o["pos2"]["y"])},
                    "inverted": bool(int(o.get("inverted", 0)) == 1),
                })
            elif t == "HangingPlatform":
                sz = o.get("size", {"x": 2, "y": 0.3})
                hanging_platforms.append({
                    "pos": pos,
                    "halfSize": {"x": float(sz["x"]) * 0.5, "y": float(sz["y"])},
                    "ropeLen": float(o.get("dist", 4)),
                })
            elif t == "Roman":
                romans.append({
                    "pos": pos,
                    "param2": 1.0 if o.get("startup", "r") == "r" else -1.0,
                    "length": float(o.get("Length", 8)),
                    "height": float(o.get("Height", 2)),
                })
            elif t == "PortalPair":
                idx_pp = len(portal_pairs)
                portal_pairs.append({
                    "id": idx_pp,
                    "pos1": {"x": safe_float(o["pos1"]["x"]), "y": safe_float(o["pos1"]["y"])},
                    "ori1": safe_float(o.get("ori1", 0)),
                    "pos2": {"x": safe_float(o["pos2"]["x"]), "y": safe_float(o["pos2"]["y"])},
                    "ori2": safe_float(o.get("ori2", 0)),
                    "color": color_id,
                    "inverted": bool(safe_int(o.get("inverted", 0)) == 1),
                    "alwaysOn": m_idx < 0,
                })
                reg_act(m_idx, "portal", idx_pp)

        for lst in (pushers, levers, light_pushers, timed_pushers):
            for item_a in lst:
                mi = item_a.get("mechIndex", -1)
                if mi in actuators_by_index and actuators_by_index[mi]:
                    item_a["target"] = actuators_by_index[mi][0]
                    item_a["targets"] = actuators_by_index[mi]

        ltype = str(data.get("LevelType") or "a").strip()
        node["gemTypeId"] = 2 if ltype == "p" else (3 if ltype == "s" else 1)
        mode = node["mode"]
        if ltype == "d":
            mode = "dark"

        key = f"{node['mode']}_{node['levelNum']}"
        levels_by_key[key] = {
            "mode": mode,
            "levelNum": node["levelNum"],
            "node": node["node"],
            "code": node["code"],
            "typeId": node["typeId"],
            "parTime": node["parTime"],
            "hasTutorial": False,
            "rows": len(grid),
            "cols": len(grid[0]) if grid else 0,
            "bdCount": bd_count,
            "rdCount": rd_count,
            "grCount": gr_count,
            "startFire": start_fire,
            "startWater": start_water,
            "finish": {"fire": end_fire, "water": end_water},
            "slidePlatforms": slide_platforms,
            "rotPlatforms": rot_platforms,
            "pushers": pushers,
            "levers": levers,
            "lightBeamers": light_beamers,
            "lightPushers": light_pushers,
            "timedPushers": timed_pushers,
            "rotMirrors": rot_mirrors,
            "infiniteMirrors": infinite_mirrors,
            "movingMirrors": moving_mirrors,
            "mirrorSliders": mirror_sliders,
            "winds": winds,
            "balls": balls,
            "movingBoxes": moving_boxes,
            "movingBoxes2": moving_boxes2,
            "iceBlocks": [],
            "pulleys": pulleys,
            "hangingPlatforms": hanging_platforms,
            "romans": romans,
            "jumpers": [],
            "portalPairs": portal_pairs,
            "grid": grid,
        }
    return levels_by_key

def extract_temple(cfg):
    tid = cfg["id"]
    folder = cfg["folder"]
    t_root = os.path.join(WORKSPACE_ROOT, folder)
    swf_path = os.path.join(t_root, cfg["swf"])
    game_as_path = os.path.join(t_root, "scripts", "Game.as")
    level_as_path = os.path.join(t_root, "scripts", "level.as")
    out_js_path = os.path.join(WORKSPACE_ROOT, cfg["out_js"])

    print(f"\n=== Extracting {cfg['title']} ({tid}) ===")
    swf = parse_swf(swf_path)
    game_meta = parse_game_as(game_as_path, tid)

    # Find MainMenu & NodeTree CIDs via symbol_classes; resolve Golden_road from MainMenu child first
    sym_to_cid = {v: k for k, v in swf["symbol_classes"].items()}
    mm_cid = sym_to_cid.get("MainMenu")
    nt_cid = sym_to_cid.get("NodeTree")
    mm_info = swf["sprites_info"].get(mm_cid, {})
    nt_info = swf["sprites_info"].get(nt_cid, {})

    def is_on_stage(tx, ty):
        return 0.0 <= tx <= 640.0 and 0.0 <= ty <= 480.0

    mm_by_name = {}
    for ch in mm_info.get("frame1", []):
        name = ch.get("name")
        if not name:
            continue
        tx, ty = ch["matrix"][4], ch["matrix"][5]
        if name not in mm_by_name or is_on_stage(tx, ty):
            mm_by_name[name] = ch

    # Include NodeTree children (offset by NodeTree placement inside MainMenu, if any)
    nt_ox, nt_oy = 0.0, 0.0
    for ch in mm_info.get("frame1", []):
        if ch["cid"] == nt_cid:
            nt_ox, nt_oy = ch["matrix"][4], ch["matrix"][5]
            break
    for ch in nt_info.get("frame1", []):
        name = ch.get("name")
        if name:
            c_copy = dict(ch)
            m = list(ch["matrix"])
            m[4] += nt_ox
            m[5] += nt_oy
            c_copy["matrix"] = tuple(m)
            if name not in mm_by_name or is_on_stage(m[4], m[5]):
                mm_by_name[name] = c_copy

    gr_cid = mm_by_name["Golden_road"]["cid"] if "Golden_road" in mm_by_name else sym_to_cid.get("Golden_road")
    gr_info = swf["sprites_info"].get(gr_cid, {})
    gr_offset_x, gr_offset_y = 0.0, 0.0
    if "Golden_road" in mm_by_name:
        gr_offset_x = mm_by_name["Golden_road"]["matrix"][4]
        gr_offset_y = mm_by_name["Golden_road"]["matrix"][5]

    gr_by_name = {}
    for ch in gr_info.get("frame1", []):
        name = ch.get("name")
        if not name:
            continue
        gx = gr_offset_x + ch["matrix"][4]
        gy = gr_offset_y + ch["matrix"][5]
        if name not in gr_by_name or is_on_stage(gx, gy):
            gr_by_name[name] = ch

    for node in game_meta["nodes"]:
        n_num = node["node"]
        if tid == "crystal" and n_num > 39:
            # Crystal Game.as only puts node_1..node_39 inside on-stage NodeTree (node_0 is offscreen)
            continue
        b_ch = mm_by_name.get(node["buttonName"]) or mm_by_name.get(f"btn_{n_num}")
        n_ch = mm_by_name.get(node["nodeName"]) or mm_by_name.get(f"node_{n_num}")
        g_ch = gr_by_name.get(node["goldName"]) or gr_by_name.get(f"Gold_{n_num}") or gr_by_name.get(f"node_{n_num}")
        if b_ch:
            node["x"] = round(b_ch["matrix"][4], 2)
            node["y"] = round(b_ch["matrix"][5], 2)
            node["buttonCid"] = b_ch["cid"]
        elif n_ch:
            node["x"] = round(n_ch["matrix"][4], 2)
            node["y"] = round(n_ch["matrix"][5], 2)
        if n_ch:
            node["nodeCid"] = n_ch["cid"]
            node["nodeX"] = round(n_ch["matrix"][4], 2)
            node["nodeY"] = round(n_ch["matrix"][5], 2)
        if g_ch:
            node["goldCid"] = g_ch["cid"]
            node["goldX"] = round(gr_offset_x + g_ch["matrix"][4], 2)
            node["goldY"] = round(gr_offset_y + g_ch["matrix"][5], 2)

    if cfg["json_levels"]:
        levels_by_key = parse_crystal_levels(os.path.join(t_root, cfg["json_levels"]), game_meta["nodes"])
    else:
        levels_by_key = parse_as_levels(level_as_path)
        for node in game_meta["nodes"]:
            k = f"{node['mode']}_{node['levelNum']}"
            if k in levels_by_key:
                lvl = levels_by_key[k]
                lvl["node"] = node["node"]
                lvl["code"] = node["code"]
                lvl["typeId"] = node["typeId"]
                lvl["parTime"] = node["parTime"]
                lvl["hasTutorial"] = False

    # Catalog sprites
    sprites_dir = os.path.join(t_root, "sprites")
    sprite_metas = {}
    sprite_by_cid = {}
    for folder_name in sorted(os.listdir(sprites_dir)):
        full_dir = os.path.join(sprites_dir, folder_name)
        if not os.path.isdir(full_dir) or not folder_name.startswith("DefineSprite_"):
            continue
        parts = folder_name.split("_", 2)
        cid = int(parts[1])
        sym = parts[2] if len(parts) > 2 else swf["symbol_classes"].get(cid, f"sprite_{cid}")
        png_files = [f for f in os.listdir(full_dir) if f.endswith(".png")]
        png1 = os.path.join(full_dir, "1.png")
        pw, ph = read_png_size(png1) if os.path.exists(png1) else (0, 0)
        b = swf["get_char_bounds"](cid)
        ox = round(b[0], 2) if b else round(-pw / 2.0, 2)
        oy = round(b[1], 2) if b else round(-ph / 2.0, 2)
        sinfo = swf["sprites_info"].get(cid, {})
        children = []
        for ch in sinfo.get("frame1", []):
            sx, sk0, sk1, sy, tx, ty = ch["matrix"]
            children.append({
                "depth": ch["depth"], "cid": ch["cid"], "name": ch["name"],
                "tx": round(tx, 2), "ty": round(ty, 2),
                "sx": round(sx, 4), "sy": round(sy, 4),
                "sk0": round(sk0, 4), "sk1": round(sk1, 4),
            })
        meta = {
            "cid": cid, "symbol": sym,
            "folder": f"{folder}/sprites/{folder_name}",
            "frames": len(png_files), "ox": ox, "oy": oy, "w": pw, "h": ph,
            "children": children,
        }
        sprite_metas[sym] = meta
        sprite_by_cid[str(cid)] = meta

    # Catalog buttons
    buttons_dir = os.path.join(t_root, "buttons")
    button_metas = {}
    if os.path.isdir(buttons_dir):
        for folder_name in sorted(os.listdir(buttons_dir)):
            full_dir = os.path.join(buttons_dir, folder_name)
            if not os.path.isdir(full_dir) or not folder_name.startswith("DefineButton2_"):
                continue
            parts = folder_name.split("_", 2)
            cid = int(parts[1])
            sym = parts[2] if len(parts) > 2 else swf["symbol_classes"].get(cid, f"button_{cid}")
            png_files = [f for f in os.listdir(full_dir) if f.endswith(".png")]
            png1 = os.path.join(full_dir, "1.png")
            pw, ph = read_png_size(png1) if os.path.exists(png1) else (0, 0)
            b = swf["get_char_bounds"](cid)
            ox = round(b[0], 2) if b else round(-pw / 2.0, 2)
            oy = round(b[1], 2) if b else round(-ph / 2.0, 2)
            button_metas[str(cid)] = {
                "cid": cid, "symbol": sym,
                "folder": f"{folder}/buttons/{folder_name}",
                "frames": len(png_files), "ox": ox, "oy": oy, "w": pw, "h": ph,
            }

    # Catalog sounds
    sounds_dir = os.path.join(t_root, "sounds")
    assets_dir = os.path.join(t_root, "scripts", "_assets")
    sound_files = {}
    if os.path.isdir(sounds_dir):
        for fname in sorted(os.listdir(sounds_dir)):
            base, ext = os.path.splitext(fname)
            chosen_path = f"{folder}/sounds/{fname}"
            if ext.lower() == ".flv" and os.path.exists(assets_dir):
                for af in os.listdir(assets_dir):
                    if af.startswith(base) and af.lower().endswith((".wav", ".mp3")):
                        chosen_path = f"{folder}/scripts/_assets/{af}"
                        break
            sound_files[base] = chosen_path
            if "_" in base:
                sound_files[base.split("_", 1)[1]] = chosen_path

    # Catalog shapes
    shapes_dir = os.path.join(t_root, "shapes")
    shape_metas = {}
    if os.path.isdir(shapes_dir):
        for fname in sorted(os.listdir(shapes_dir), key=lambda x: int(os.path.splitext(x)[0]) if os.path.splitext(x)[0].isdigit() else 0):
            if not fname.endswith(".svg"):
                continue
            cid = int(os.path.splitext(fname)[0])
            b = swf["char_bounds"].get(cid, (0, 0, 0, 0))
            shape_metas[str(cid)] = {
                "cid": cid, "file": f"{folder}/shapes/{fname}",
                "ox": round(b[0], 2), "oy": round(b[1], 2),
                "w": round(b[2] - b[0], 2), "h": round(b[3] - b[1], 2),
            }

    images_dir = os.path.join(t_root, "images")
    image_files = [f"{folder}/images/{f}" for f in sorted(os.listdir(images_dir)) if f.endswith((".png", ".jpg"))] if os.path.isdir(images_dir) else []
    fonts_dir = os.path.join(t_root, "fonts")
    font_files = [f"{folder}/fonts/{f}" for f in sorted(os.listdir(fonts_dir)) if f.endswith(".ttf")] if os.path.isdir(fonts_dir) else []

    with open(out_js_path, "w", encoding="utf-8") as out:
        out.write(f"// Auto-extracted 100% authentic Fireboy & Watergirl: {cfg['title']} SWF Game Data\n\n")
        out.write(f"export const TEMPLE_ID = {json.dumps(tid)};\n")
        out.write(f"export const TEMPLE_TITLE = {json.dumps(cfg['title'])};\n")
        out.write(f"export const TEMPLE_FOLDER = {json.dumps(folder)};\n")
        out.write(f"export const STAGE_WIDTH = {swf['stage_width']};\n")
        out.write(f"export const STAGE_HEIGHT = {swf['stage_height']};\n")
        out.write(f"export const FPS = {swf['fps']};\n")
        out.write("export const LEVEL_SCALE = 0.8;\n")
        out.write("export const LEVEL_OFFSET_X = 16;\n")
        out.write("export const LEVEL_OFFSET_Y = 16;\n")
        out.write("export const TILE_SIZE = 20;\n")
        out.write("export const BOX2D_TIMESTEP = 1 / 26;\n")
        out.write("export const BOX2D_ITERATIONS = 50;\n")
        out.write("export const BOX2D_GRAVITY = 26;\n\n")
        out.write(f"export const TEMPLE_NODES = {json.dumps(game_meta['nodes'], indent=2)};\n\n")
        out.write(f"export const LEVELS = {json.dumps(levels_by_key, indent=2)};\n\n")
        out.write(f"export const SPRITE_METAS = {json.dumps(sprite_metas, indent=2)};\n\n")
        out.write(f"export const SPRITES_BY_CID = {json.dumps(sprite_by_cid, indent=2)};\n\n")
        out.write(f"export const BUTTON_METAS = {json.dumps(button_metas, indent=2)};\n\n")
        out.write(f"export const SHAPE_METAS = {json.dumps(shape_metas, indent=2)};\n\n")
        out.write(f"export const SOUND_FILES = {json.dumps(sound_files, indent=2)};\n\n")
        out.write(f"export const IMAGE_FILES = {json.dumps(image_files, indent=2)};\n\n")
        out.write(f"export const FONT_FILES = {json.dumps(font_files, indent=2)};\n")

    matched = sum(1 for n in game_meta["nodes"] if f"{n['mode']}_{n['levelNum']}" in levels_by_key)
    print(f"   Nodes: {len(game_meta['nodes'])}, Matched Levels: {matched}/{len(game_meta['nodes'])}, Total Levels: {len(levels_by_key)}")
    print(f"   Sprites: {len(sprite_by_cid)}, Shapes: {len(shape_metas)}, Sounds: {len(sound_files)}, Size: {os.path.getsize(out_js_path):,} bytes")

def main():
    for cfg in TEMPLE_CONFIGS:
        extract_temple(cfg)

if __name__ == "__main__":
    main()
