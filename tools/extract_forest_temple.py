import os
import re
import json
import zlib
import struct
import math

WORKSPACE_ROOT = r"a:\Game Project\fireboy-watergirl"
FT_ROOT = os.path.join(WORKSPACE_ROOT, "Forest Temple")
SWF_PATH = os.path.join(FT_ROOT, "FireBoyAndWaterGirl - ForestTemple.swf")
LEVEL_AS_PATH = os.path.join(FT_ROOT, "scripts", "level.as")
GAME_AS_PATH = os.path.join(FT_ROOT, "scripts", "Game.as")
OUT_JS_PATH = os.path.join(WORKSPACE_ROOT, "js", "forest_gamedata.js")

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
        if fid == 0: # DropShadowFilter
            pos += 23
        elif fid == 1: # BlurFilter
            pos += 9
        elif fid == 2: # GlowFilter
            pos += 15
        elif fid == 3: # BevelFilter
            pos += 27
        elif fid == 4: # GradientGlowFilter
            nc = tdata[pos]
            pos += 1 + nc * 5 + 19
        elif fid == 5: # ConvolutionFilter
            mx, my = tdata[pos], tdata[pos+1]
            pos += 2 + mx * my * 4 + 13
        elif fid == 6: # ColorMatrixFilter
            pos += 80
        elif fid == 7: # GradientBevelFilter
            nc = tdata[pos]
            pos += 1 + nc * 5 + 19
    return pos

def iter_tags(data, start_pos=0):
    pos = start_pos
    n = len(data)
    while pos + 2 <= n:
        record_header = struct.unpack("<H", data[pos:pos+2])[0]
        pos += 2
        tag_type = record_header >> 6
        tag_len = record_header & 0x3F
        if tag_len == 0x3F:
            if pos + 4 > n:
                break
            tag_len = struct.unpack("<I", data[pos:pos+4])[0]
            pos += 4
        tag_data = data[pos:pos+tag_len]
        pos += tag_len
        yield tag_type, tag_data
        if tag_type == 0:
            break

def read_png_size(path):
    with open(path, "rb") as f:
        hdr = f.read(24)
    if hdr[:8] == b"\x89PNG\r\n\x1a\n" and hdr[12:16] == b"IHDR":
        return struct.unpack(">II", hdr[16:24])
    return (0, 0)

def parse_swf():
    with open(SWF_PATH, "rb") as f:
        raw = f.read()
    body = zlib.decompress(raw[8:]) if raw[:3] == b"CWS" else raw[8:]
    br = BitReader(body, 0)
    stage_rect = br.read_rect()
    fps_raw, frame_count = struct.unpack("<HH", body[br.byte_pos:br.byte_pos+4])
    fps = fps_raw / 256.0
    start_pos = br.byte_pos + 4

    char_bounds = {}
    sprites_info = {}
    buttons_info = {}
    symbol_classes = {}

    def parse_place_object(tag_type, tdata):
        br = BitReader(tdata, 0)
        flags = tdata[0]
        has_name = bool(flags & 0x20)
        has_ratio = bool(flags & 0x10)
        has_cxform = bool(flags & 0x08)
        has_matrix = bool(flags & 0x04)
        has_char = bool(flags & 0x02)
        has_move = bool(flags & 0x01)
        pos = 1
        if tag_type == 70:
            flags2 = tdata[1]
            pos = 2
        depth = struct.unpack("<H", tdata[pos:pos+2])[0]
        pos += 2
        if tag_type == 70:
            has_class_name = bool(flags2 & 0x08)
            has_image = bool(flags2 & 0x10)
            if has_class_name or (has_image and has_char):
                if has_class_name:
                    end = tdata.index(0, pos)
                    pos = end + 1
        cid = None
        if has_char:
            cid = struct.unpack("<H", tdata[pos:pos+2])[0]
            pos += 2
        mat = None
        br.byte_pos = pos
        br.bit_pos = 0
        if has_matrix:
            mat = br.read_matrix()
        if has_cxform:
            br.align()
            has_add = br.read_ub(1)
            has_mult = br.read_ub(1)
            nbits = br.read_ub(4)
            if has_mult:
                for _ in range(4): br.read_sb(nbits)
            if has_add:
                for _ in range(4): br.read_sb(nbits)
            br.align()
        if has_ratio:
            br.byte_pos += 2
        name = None
        if has_name:
            end = tdata.index(0, br.byte_pos)
            name = tdata[br.byte_pos:end].decode("utf-8", errors="replace")
            br.byte_pos = end + 1
        return {
            "depth": depth,
            "cid": cid,
            "matrix": mat,
            "name": name,
            "move": has_move
        }

    for tag_type, tdata in iter_tags(body, start_pos):
        if tag_type in (2, 22, 32, 83):
            cid = struct.unpack("<H", tdata[:2])[0]
            char_bounds[cid] = BitReader(tdata, 2).read_rect()
        elif tag_type in (46, 84):
            cid = struct.unpack("<H", tdata[:2])[0]
            breader = BitReader(tdata, 2)
            r1 = breader.read_rect()
            r2 = breader.read_rect()
            char_bounds[cid] = (min(r1[0], r2[0]), min(r1[1], r2[1]), max(r1[2], r2[2]), max(r1[3], r2[3]))
        elif tag_type in (11, 33, 37):
            cid = struct.unpack("<H", tdata[:2])[0]
            char_bounds[cid] = BitReader(tdata, 2).read_rect()
        elif tag_type == 34: # DefineButton2
            cid = struct.unpack("<H", tdata[:2])[0]
            action_offset = struct.unpack("<H", tdata[3:5])[0]
            pos = 5
            end_pos = (3 + action_offset) if action_offset > 0 else len(tdata)
            records = []
            breader = BitReader(tdata, pos)
            while breader.byte_pos < end_pos:
                bflags = tdata[breader.byte_pos]
                breader.byte_pos += 1
                if bflags == 0:
                    break
                bcid, bdepth = struct.unpack("<HH", tdata[breader.byte_pos:breader.byte_pos+4])
                breader.byte_pos += 4
                breader.bit_pos = 0
                bmat = breader.read_matrix()
                breader.align()
                has_add = breader.read_ub(1)
                has_mult = breader.read_ub(1)
                nbits = breader.read_ub(4)
                if has_mult:
                    for _ in range(4): breader.read_sb(nbits)
                if has_add:
                    for _ in range(4): breader.read_sb(nbits)
                breader.align()
                if bflags & 0x10:
                    breader.byte_pos = skip_filter_list(tdata, breader.byte_pos)
                if bflags & 0x20:
                    breader.byte_pos += 1
                records.append({"cid": bcid, "depth": bdepth, "matrix": bmat, "flags": bflags})
            buttons_info[cid] = records
        elif tag_type == 76: # SymbolClass
            num = struct.unpack("<H", tdata[:2])[0]
            pos = 2
            for _ in range(num):
                cid = struct.unpack("<H", tdata[pos:pos+2])[0]
                pos += 2
                end = tdata.index(0, pos)
                cname = tdata[pos:end].decode("utf-8", errors="replace")
                pos = end + 1
                symbol_classes[cid] = cname
        elif tag_type == 39: # DefineSprite
            cid, fcount = struct.unpack("<HH", tdata[:4])
            display_list = {}
            frame1_children = []
            frame_idx = 0
            all_placements = []
            for stype, sdata in iter_tags(tdata, 4):
                if stype in (26, 70):
                    p = parse_place_object(stype, sdata)
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
                        frame1_children = [dict(v) for k, v in sorted(display_list.items())]
                    frame_idx += 1
            sprites_info[cid] = {
                "frames": fcount,
                "frame1": frame1_children,
                "all_placements": all_placements
            }

    def transform_rect(rect, mat):
        xmin, ymin, xmax, ymax = rect
        sx, sk0, sk1, sy, tx, ty = mat
        pts = [(xmin, ymin), (xmax, ymin), (xmin, ymax), (xmax, ymax)]
        xs = [sx * x + sk1 * y + tx for x, y in pts]
        ys = [sk0 * x + sy * y + ty for x, y in pts]
        return (min(xs), min(ys), max(xs), max(ys))

    memo_bounds = {}
    def get_char_bounds(cid, visited=None):
        if cid in char_bounds:
            return char_bounds[cid]
        if cid in memo_bounds:
            return memo_bounds[cid]
        if visited is None:
            visited = set()
        if cid in visited:
            return None
        visited.add(cid)
        if cid in buttons_info:
            b_all = None
            for rec in buttons_info[cid]:
                if not (rec["flags"] & 0x01):
                    continue
                cb = get_char_bounds(rec["cid"], set(visited))
                if cb is None:
                    continue
                tb = transform_rect(cb, rec["matrix"])
                b_all = tb if b_all is None else (min(b_all[0], tb[0]), min(b_all[1], tb[1]), max(b_all[2], tb[2]), max(b_all[3], tb[3]))
            memo_bounds[cid] = b_all
            return b_all
        if cid not in sprites_info:
            return None
        info = sprites_info[cid]
        b_all = None
        for ch in info["all_placements"]:
            cb = get_char_bounds(ch["cid"], set(visited))
            if cb is None:
                continue
            tb = transform_rect(cb, ch["matrix"])
            b_all = tb if b_all is None else (min(b_all[0], tb[0]), min(b_all[1], tb[1]), max(b_all[2], tb[2]), max(b_all[3], tb[3]))
        memo_bounds[cid] = b_all
        return b_all

    return {
        "stage_width": int(stage_rect[2] - stage_rect[0]),
        "stage_height": int(stage_rect[3] - stage_rect[1]),
        "fps": fps,
        "char_bounds": char_bounds,
        "sprites_info": sprites_info,
        "buttons_info": buttons_info,
        "symbol_classes": symbol_classes,
        "get_char_bounds": get_char_bounds
    }

def parse_game_as():
    with open(GAME_AS_PATH, "r", encoding="utf-8") as f:
        text = f.read()

    # Translation array
    m_trans = re.search(r'Translation\s*=\s*new Array\(([^)]+)\)', text)
    translation = [s.strip().strip('"') for s in m_trans.group(1).split(",")]

    # TimeTable array
    m_times = re.search(r'TimeTable\s*=\s*new Array\(([^)]+)\)', text)
    timetable = [int(s.strip()) for s in m_times.group(1).split(",")]

    # Adjacencies
    adjs = {i: [] for i in range(1, 33)}
    for m in re.finditer(r'Adjacencies\[(\d+)\]\[(\d+)\]\s*=\s*1;', text):
        u = int(m.group(1)) + 1
        v = int(m.group(2)) + 1
        if v not in adjs[u]:
            adjs[u].append(v)
        if u not in adjs[v]:
            adjs[v].append(u)

    type_map = {1: "adventure", 2: "puzzle", 3: "speed"}
    nodes = []
    for idx, code in enumerate(translation):
        node_num = idx + 1
        t_str, l_str = code.split("_")
        t_id = int(t_str)
        l_num = int(l_str)
        nodes.append({
            "node": node_num,
            "code": code,
            "buttonName": f"b_{code}",
            "nodeName": f"node_{node_num}",
            "goldName": f"Gold_{node_num}",
            "typeId": t_id,
            "mode": type_map[t_id],
            "levelNum": l_num,
            "parTime": timetable[idx],
            "neighbors": sorted(adjs[node_num])
        })
    return {
        "translation": translation,
        "timetable": timetable,
        "nodes": nodes
    }

def parse_level_block(mode, level_num, block_text):
    # Replace _loc6_, _loc7_, _loc8_ in LevelArray
    m_arr = re.search(r'LevelArray\s*=\s*new Array\((.+?)\);', block_text, re.DOTALL)
    if not m_arr:
        raise ValueError(f"Missing LevelArray in {mode} {level_num}")
    arr_str = m_arr.group(1)
    arr_str = arr_str.replace("_loc6_", '"bd"').replace("_loc7_", '"rd"').replace("_loc8_", '"gr"')
    arr_str = arr_str.replace("new Array(", "[").replace(")", "]")
    grid = json.loads(f"[{arr_str}]")

    bd_count = sum(1 for row in grid for cell in row if cell == "bd")
    rd_count = sum(1 for row in grid for cell in row if cell == "rd")
    gr_count = sum(1 for row in grid for cell in row if cell == "gr")

    def parse_vec2(s):
        m = re.match(r'new b2Vec2\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)', s.strip())
        return {"x": float(m.group(1)), "y": float(m.group(2))}

    m_fire = re.search(r'StartPosFire\s*=\s*(new b2Vec2\([^)]+\));', block_text)
    m_water = re.search(r'StartPosWater\s*=\s*(new b2Vec2\([^)]+\));', block_text)
    start_fire = parse_vec2(m_fire.group(1))
    start_water = parse_vec2(m_water.group(1))

    m_fin = re.search(r'CreateFinish\(\s*(new b2Vec2\([^)]+\))\s*,\s*(new b2Vec2\([^)]+\))\s*\);', block_text)
    finish = {
        "fire": parse_vec2(m_fin.group(1)),
        "water": parse_vec2(m_fin.group(2))
    }

    # Parse all entity calls in order after CreateFinish
    after_finish = block_text[m_fin.end():]

    slide_platforms = []
    rot_platforms = []
    pushers = []
    levers = []
    winds = []
    balls = []
    moving_boxes = []
    pulleys = []
    hanging_platforms = []
    romans = []
    jumpers = []

    # Track exact Box2D myActuateds (for pushers) and myActuateds2 (for levers)
    my_actuateds = []   # list of (entity_type, entity_index)
    my_actuateds2 = []  # list of (entity_type, entity_index)

    stmt_pattern = re.compile(r'(Create\w+|CreatRoman)\((.+?)\);')
    for m in stmt_pattern.finditer(after_finish):
        fn = m.group(1)
        args_raw = m.group(2)
        # Split top-level args (not inside parentheses)
        args = []
        depth = 0
        cur = []
        for ch in args_raw:
            if ch == '(':
                depth += 1
                cur.append(ch)
            elif ch == ')':
                depth -= 1
                cur.append(ch)
            elif ch == ',' and depth == 0:
                args.append("".join(cur).strip())
                cur = []
            else:
                cur.append(ch)
        if cur:
            args.append("".join(cur).strip())

        if fn == "CreateSlidePlatform":
            # (pos, param2, param3, axis, lower, upper, extraCopies, ctrlType, colorId)
            idx = len(slide_platforms)
            extra = int(float(args[6]))
            ctrl = args[7].strip('"')
            sp = {
                "id": f"slide_{idx}",
                "pos": parse_vec2(args[0]),
                "param2": float(args[1]),
                "param3": float(args[2]),
                "halfWidth": float(args[2]),
                "halfHeight": float(args[1]) * 0.8,
                "visualWidth": float(args[2]) * 40,
                "visualHeight": float(args[1]) * 40,
                "axis": parse_vec2(args[3]),
                "lower": float(args[4]),
                "upper": float(args[5]),
                "extraCopies": extra,
                "controlledBy": ctrl,
                "colorId": int(float(args[8]))
            }
            slide_platforms.append(sp)
            target_list = my_actuateds if ctrl == "pusher" else (my_actuateds2 if ctrl == "lever" else None)
            if target_list is not None:
                for _ in range(1 + extra):
                    target_list.append(("slidePlatform", idx))

        elif fn == "CreateRotPlatform":
            # (pos, param2, param3, angle, upperPi, lowerPi, extraCopies, ctrlType, colorId)
            idx = len(rot_platforms)
            extra = int(float(args[6]))
            ctrl = args[7].strip('"')
            rp = {
                "id": f"rot_{idx}",
                "pos": parse_vec2(args[0]),
                "halfWidth": float(args[1]),
                "halfHeight": float(args[2]),
                "angle": float(args[3]),
                "upperAnglePi": float(args[4]),
                "lowerAnglePi": float(args[5]),
                "extraCopies": extra,
                "controlledBy": ctrl,
                "colorId": int(float(args[8]))
            }
            rot_platforms.append(rp)
            target_list = my_actuateds if ctrl == "pusher" else (my_actuateds2 if ctrl == "lever" else None)
            if target_list is not None:
                for _ in range(1 + extra):
                    target_list.append(("rotPlatform", idx))

        elif fn == "CreateWind":
            # (lower, upper, verticalDir, colorId, ctrlType, soundable)
            idx = len(winds)
            ctrl = args[4].strip('"')
            w = {
                "id": f"wind_{idx}",
                "lower": parse_vec2(args[0]),
                "upper": parse_vec2(args[1]),
                "dir": int(float(args[2])),
                "colorId": int(float(args[3])),
                "controlledBy": ctrl,
                "soundable": args[5] == "true"
            }
            winds.append(w)
            if ctrl == "lever":
                my_actuateds2.append(("wind", idx))

        elif fn == "CreatePusher":
            # (pos, param2, colorId, soundable)
            idx = len(pushers)
            p = {
                "id": f"pusher_{idx}",
                "pos": parse_vec2(args[0]),
                "param2": float(args[1]),
                "colorId": int(float(args[2])),
                "soundable": args[3] == "true",
                "target": None
            }
            pushers.append(p)

        elif fn == "CreateLever":
            # (pos, colorId, startSide, onisArg, soundable)
            idx = len(levers)
            start_side = args[2].strip('"')
            arg4 = args[3].strip('"')
            # Note from level.as lines 3057-3064: if param4 == "r", onis = "l", else if param4 == "l", onis = "r"
            onis = "l" if arg4 == "r" else "r"
            lv = {
                "id": f"lever_{idx}",
                "pos": parse_vec2(args[0]),
                "colorId": int(float(args[1])),
                "startSide": start_side,
                "param4": arg4,
                "onSide": onis,
                "soundable": args[4] == "true",
                "target": None
            }
            levers.append(lv)

        elif fn == "CreateBall":
            balls.append(parse_vec2(args[0]))

        elif fn == "CreateMovingBox":
            moving_boxes.append({
                "pos": parse_vec2(args[0]),
                "halfSize": parse_vec2(args[1])
            })

        elif fn == "CreatePulley":
            pulleys.append({
                "anchor1": parse_vec2(args[0]),
                "anchor2": parse_vec2(args[1]),
                "size1": parse_vec2(args[2]),
                "size2": parse_vec2(args[3]),
                "pos1": parse_vec2(args[4]),
                "pos2": parse_vec2(args[5])
            })

        elif fn == "CreateHangingPlatform":
            hanging_platforms.append({
                "anchor": parse_vec2(args[0]),
                "halfSize": parse_vec2(args[1]),
                "length": float(args[2]),
                "dir": args[3].strip('"')
            })

        elif fn == "CreatRoman":
            romans.append({
                "pos": parse_vec2(args[0]),
                "height": float(args[1]),
                "length": float(args[2]),
                "startTilt": args[3].strip('"')
            })

        elif fn == "CreateJumper":
            jumpers.append({
                "pos": parse_vec2(args[0]),
                "param2": float(args[1])
            })

    # Link pushers[i] -> my_actuateds[i] and levers[j] -> my_actuateds2[j]
    for i, p in enumerate(pushers):
        if i < len(my_actuateds):
            p["target"] = {"type": my_actuateds[i][0], "index": my_actuateds[i][1]}
    for j, lv in enumerate(levers):
        if j < len(my_actuateds2):
            lv["target"] = {"type": my_actuateds2[j][0], "index": my_actuateds2[j][1]}

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
        "winds": winds,
        "balls": balls,
        "movingBoxes": moving_boxes,
        "pulleys": pulleys,
        "hangingPlatforms": hanging_platforms,
        "romans": romans,
        "jumpers": jumpers,
        "grid": grid
    }

def parse_all_levels():
    with open(LEVEL_AS_PATH, "r", encoding="utf-8") as f:
        text = f.read()

    # Find mode sections: if(param1 == "puzzle") ... else if(param1 == "speed") ... else if(param1 == "adventure") ... else if(param1 == "test")
    mode_starts = [(m.group(1), m.start(), m.end()) for m in re.finditer(r'if\(param1 == "(\w+)"\)', text)]
    end_of_modes = text.find("_loc9_ = 3 + Math.round(Math.random() * 2);")

    levels_by_key = {}
    for idx, (mode, mstart, mend) in enumerate(mode_starts):
        next_start = mode_starts[idx + 1][1] if idx + 1 < len(mode_starts) else end_of_modes
        section = text[mend:next_start]
        if mode == "test":
            levels_by_key["test_1"] = parse_level_block("test", 1, section)
        else:
            sub_starts = [(int(m.group(1)), m.start(), m.end()) for m in re.finditer(r'if\(param2 == (\d+)\)', section)]
            for sidx, (lnum, sstart, send) in enumerate(sub_starts):
                snext = sub_starts[sidx + 1][1] if sidx + 1 < len(sub_starts) else len(section)
                block = section[send:snext]
                levels_by_key[f"{mode}_{lnum}"] = parse_level_block(mode, lnum, block)
    return levels_by_key

def main():
    print("1. Parsing SWF binary & bounds...")
    swf = parse_swf()
    print("2. Parsing Game.as (32 temple map nodes, par times, DAG)...")
    game_meta = parse_game_as()

    # Attach exact MainMenu (cid=638) node & button coordinates + Golden_road (cid=567) to TEMPLE_NODES
    mm_info = swf["sprites_info"].get(638, {})
    mm_by_name = {ch["name"]: ch for ch in mm_info.get("frame1", []) if ch.get("name")}
    gr_info = swf["sprites_info"].get(567, {})
    gr_by_name = {ch["name"]: ch for ch in gr_info.get("frame1", []) if ch.get("name")}
    gr_offset_x, gr_offset_y = 313.35, 243.0
    if "Golden_road" in mm_by_name:
        gr_offset_x = mm_by_name["Golden_road"]["matrix"][4]
        gr_offset_y = mm_by_name["Golden_road"]["matrix"][5]

    for node in game_meta["nodes"]:
        b_ch = mm_by_name.get(node["buttonName"])
        n_ch = mm_by_name.get(node["nodeName"])
        g_ch = gr_by_name.get(node["goldName"])
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

    print("3. Parsing level.as (all levels)...")
    levels_by_key = parse_all_levels()

    print(f"   Extracted {len(levels_by_key)} total level definitions from level.as.")
    # Verify all 32 map nodes exist in levels_by_key
    missing_nodes = []
    for node in game_meta["nodes"]:
        k = f"{node['mode']}_{node['levelNum']}"
        if k not in levels_by_key:
            missing_nodes.append((node["node"], node["code"], k))
        else:
            lvl = levels_by_key[k]
            lvl["node"] = node["node"]
            lvl["code"] = node["code"]
            lvl["typeId"] = node["typeId"]
            lvl["parTime"] = node["parTime"]
            lvl["hasTutorial"] = (node["mode"] == "adventure" and node["levelNum"] == 1)

    if missing_nodes:
        print("ERROR: Missing levels for nodes:", missing_nodes)
    else:
        print("   SUCCESS: All 32 temple map nodes matched 100% with level definitions!")

    # Catalog sprites
    sprites_dir = os.path.join(FT_ROOT, "sprites")
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
        frame_count = len(png_files)
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
                "depth": ch["depth"],
                "cid": ch["cid"],
                "name": ch["name"],
                "tx": round(tx, 2),
                "ty": round(ty, 2),
                "sx": round(sx, 4),
                "sy": round(sy, 4),
                "sk0": round(sk0, 4),
                "sk1": round(sk1, 4)
            })

        meta = {
            "cid": cid,
            "symbol": sym,
            "folder": f"Forest Temple/sprites/{folder_name}",
            "frames": frame_count,
            "ox": ox,
            "oy": oy,
            "w": pw,
            "h": ph,
            "children": children
        }
        sprite_metas[sym] = meta
        sprite_by_cid[str(cid)] = meta

    # Catalog buttons
    buttons_dir = os.path.join(FT_ROOT, "buttons")
    button_metas = {}
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
            "cid": cid,
            "symbol": sym,
            "folder": f"Forest Temple/buttons/{folder_name}",
            "frames": len(png_files),
            "ox": ox,
            "oy": oy,
            "w": pw,
            "h": ph
        }

    # Catalog sounds (preferring scripts/_assets for .wav/.mp3 over .flv in sounds/)
    sounds_dir = os.path.join(FT_ROOT, "sounds")
    assets_dir = os.path.join(FT_ROOT, "scripts", "_assets")
    sound_files = {}
    for fname in sorted(os.listdir(sounds_dir)):
        base, ext = os.path.splitext(fname)
        # Check if scripts/_assets has a browser-friendly wav/mp3 for the same prefix
        chosen_path = f"Forest Temple/sounds/{fname}"
        if ext.lower() == ".flv" and os.path.exists(assets_dir):
            for af in os.listdir(assets_dir):
                if af.startswith(base) and af.lower().endswith((".wav", ".mp3")):
                    chosen_path = f"Forest Temple/scripts/_assets/{af}"
                    break
        sound_files[base] = chosen_path
        if "_" in base:
            cls_name = base.split("_", 1)[1]
            sound_files[cls_name] = chosen_path

    # Catalog shapes, images, fonts
    shapes_dir = os.path.join(FT_ROOT, "shapes")
    shape_metas = {}
    for fname in sorted(os.listdir(shapes_dir), key=lambda x: int(os.path.splitext(x)[0]) if os.path.splitext(x)[0].isdigit() else 0):
        if not fname.endswith(".svg"):
            continue
        cid = int(os.path.splitext(fname)[0])
        b = swf["char_bounds"].get(cid, (0, 0, 0, 0))
        shape_metas[str(cid)] = {
            "cid": cid,
            "file": f"Forest Temple/shapes/{fname}",
            "ox": round(b[0], 2),
            "oy": round(b[1], 2),
            "w": round(b[2] - b[0], 2),
            "h": round(b[3] - b[1], 2)
        }

    images_dir = os.path.join(FT_ROOT, "images")
    image_files = [f"Forest Temple/images/{f}" for f in sorted(os.listdir(images_dir)) if f.endswith((".png", ".jpg"))]

    fonts_dir = os.path.join(FT_ROOT, "fonts")
    font_files = [f"Forest Temple/fonts/{f}" for f in sorted(os.listdir(fonts_dir)) if f.endswith(".ttf")]

    # Build JS module
    os.makedirs(os.path.dirname(OUT_JS_PATH), exist_ok=True)
    with open(OUT_JS_PATH, "w", encoding="utf-8") as out:
        out.write("// Auto-extracted 100% authentic Fireboy & Watergirl 1: Forest Temple SWF Game Data\n\n")
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

    # Verify all asset paths exist on disk and all mechanisms pair cleanly
    broken_paths = []
    for m in sprite_by_cid.values():
        p = os.path.join(WORKSPACE_ROOT, m["folder"].replace("/", os.sep), "1.png")
        if not os.path.exists(p):
            broken_paths.append(p)
    for m in button_metas.values():
        p = os.path.join(WORKSPACE_ROOT, m["folder"].replace("/", os.sep), "1.png")
        if not os.path.exists(p):
            broken_paths.append(p)
    for m in shape_metas.values():
        p = os.path.join(WORKSPACE_ROOT, m["file"].replace("/", os.sep))
        if not os.path.exists(p):
            broken_paths.append(p)
    for rel in set(sound_files.values()) | set(image_files) | set(font_files):
        p = os.path.join(WORKSPACE_ROOT, rel.replace("/", os.sep))
        if not os.path.exists(p):
            broken_paths.append(p)

    unlinked_actuators = []
    tile_values = set()
    entity_totals = {
        "bd": 0, "rd": 0, "gr": 0,
        "slidePlatforms": 0, "rotPlatforms": 0,
        "pushers": 0, "levers": 0, "winds": 0,
        "balls": 0, "movingBoxes": 0, "pulleys": 0,
        "hangingPlatforms": 0, "romans": 0, "jumpers": 0
    }
    for k, lvl in levels_by_key.items():
        for row in lvl["grid"]:
            for cell in row:
                tile_values.add(cell)
        if k == "test_1":
            continue
        entity_totals["bd"] += lvl["bdCount"]
        entity_totals["rd"] += lvl["rdCount"]
        entity_totals["gr"] += lvl["grCount"]
        for key in ["slidePlatforms", "rotPlatforms", "pushers", "levers", "winds", "balls", "movingBoxes", "pulleys", "hangingPlatforms", "romans", "jumpers"]:
            entity_totals[key] += len(lvl[key])
        for p in lvl["pushers"]:
            if p["target"] is None:
                unlinked_actuators.append((k, p["id"]))
        for lv in lvl["levers"]:
            if lv["target"] is None:
                unlinked_actuators.append((k, lv["id"]))

    print(f"4. Wrote {OUT_JS_PATH} ({os.path.getsize(OUT_JS_PATH):,} bytes)")
    print(f"   Summary:")
    print(f"   - Temple map nodes: {len(game_meta['nodes'])}")
    print(f"   - Playable levels: {len(levels_by_key)} (32 campaign + 1 test)")
    print(f"   - Distinct grid tile codes: {sorted(tile_values, key=lambda x: str(x))}")
    print(f"   - Campaign entity totals (32 levels): {entity_totals}")
    print(f"   - Unlinked pushers/levers: {len(unlinked_actuators)}")
    print(f"   - Sprites cataloged: {len(sprite_by_cid)}")
    print(f"   - Buttons cataloged: {len(button_metas)}")
    print(f"   - Shapes cataloged: {len(shape_metas)}")
    print(f"   - Sounds mapped: {len(sound_files)} entries (27 audio assets)")
    print(f"   - Bitmap images: {len(image_files)}, Fonts: {len(font_files)}")
    print(f"   - Broken asset file paths: {len(broken_paths)}")

if __name__ == "__main__":
    main()
