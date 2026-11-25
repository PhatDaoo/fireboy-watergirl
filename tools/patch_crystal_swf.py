#!/usr/bin/env python3
"""
Pure-Python SWF / AVM2 ABC binary patcher for Fireboy & Watergirl 4: Crystal Temple.

Fixes three issues in the original Crystal Temple .swf when played in Ruffle / Flash:
1. Game.APISetup() calls SpilGamesServices.connect() targeting dead http://api.configar.org
   without any IOError/SecurityError handler, causing a permanent black screen.
   -> Patched to set `this.brandingManager = BrandingManager.getInstance()` and call
      `this.CreatePreloader(false)` directly (also bypassing the 12s CPMStar ad delay).
2. Game.CreateTeaser() plays a 5-second A10.com teaser animation before GameReady().
   -> Patched to call `this.GameReady()` directly so the game opens straight to the Title Screen.
3. BrandingManager.getCurrentLanguage() & getLocalizedString() dereference null `_brandingSystem`
   when SpilGamesServices is offline, throwing a TypeError inside TutLayer/button frame1()
   before `stop()` runs — causing tutorial text MovieClips to loop/flicker at 30fps.
   -> Patched to return "en-US" and look up all 62 embedded English strings directly from
      the SWF's own LocalizationPack XML data.
"""

import html
import os
import re
import struct
import subprocess
import sys
import zlib


def read_u30(buf, pos):
    val = 0
    shift = 0
    for _ in range(5):
        b = buf[pos]
        pos += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return val, pos


def read_s32(buf, pos):
    val, pos = read_u30(buf, pos)
    if val & 0x80000000:
        val -= 0x100000000
    return val, pos


def write_u30(val):
    out = bytearray()
    while True:
        b = val & 0x7F
        val >>= 7
        if val:
            out.append(b | 0x80)
        else:
            out.append(b)
            break
    return bytes(out)


def write_s24(val):
    if val < 0:
        val += 1 << 24
    return bytes((val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF))


def skip_traits(buf, pos):
    count, pos = read_u30(buf, pos)
    traits = []
    for _ in range(count):
        name_idx, pos = read_u30(buf, pos)
        kind_byte = buf[pos]
        pos += 1
        kind = kind_byte & 0x0F
        attrs = kind_byte >> 4
        info = {}
        if kind in (0, 6):  # Slot, Const
            slot_id, pos = read_u30(buf, pos)
            type_name, pos = read_u30(buf, pos)
            vindex, pos = read_u30(buf, pos)
            if vindex != 0:
                pos += 1  # vkind
            info = {"kind": kind, "slot_id": slot_id, "type": type_name}
        elif kind in (1, 2, 3):  # Method, Getter, Setter
            disp_id, pos = read_u30(buf, pos)
            method_idx, pos = read_u30(buf, pos)
            info = {"kind": kind, "disp_id": disp_id, "method": method_idx}
        elif kind == 4:  # Class
            slot_id, pos = read_u30(buf, pos)
            classi, pos = read_u30(buf, pos)
            info = {"kind": kind, "slot_id": slot_id, "classi": classi}
        elif kind == 5:  # Function
            slot_id, pos = read_u30(buf, pos)
            func_idx, pos = read_u30(buf, pos)
            info = {"kind": kind, "slot_id": slot_id, "func": func_idx}
        else:
            raise ValueError(f"Unknown trait kind: {kind}")

        if attrs & 0x04:  # ATTR_Metadata
            mcount, pos = read_u30(buf, pos)
            for _ in range(mcount):
                _, pos = read_u30(buf, pos)
        traits.append((name_idx, info))
    return traits, pos


def patch_abc(abc_bytes, skip_teaser=True):
    buf = abc_bytes
    pos = 0
    minor, major = struct.unpack_from("<HH", buf, pos)
    pos += 4

    # Constant pool
    # integers
    n, pos = read_u30(buf, pos)
    for _ in range(max(0, n - 1)):
        _, pos = read_s32(buf, pos)
    # uintegers
    n, pos = read_u30(buf, pos)
    for _ in range(max(0, n - 1)):
        _, pos = read_u30(buf, pos)
    # doubles
    n, pos = read_u30(buf, pos)
    pos += max(0, n - 1) * 8

    # strings (remember exact bounds so we can append new strings cleanly!)
    str_count_start = pos
    str_count, pos = read_u30(buf, pos)
    str_count_end = pos
    strings = [""]
    for _ in range(max(0, str_count - 1)):
        slen, pos = read_u30(buf, pos)
        strings.append(buf[pos : pos + slen].decode("utf-8", "replace"))
        pos += slen
    str_pool_end = pos

    # Extract embedded en-US localization strings from LocalizationPack XML in string pool
    loc_pairs = []
    for s in strings:
        if "<localizedText>" in s:
            for k, v in re.findall(r'<item id="([^"]+)">.*?<en-US[^>]*>([^<]*)</en-US>', s):
                loc_pairs.append((k, html.unescape(v)))
            break

    # Helper to get or append string in ABC string pool (never shifts existing indices)
    str_to_idx = {}
    for idx, s in enumerate(strings):
        if idx > 0 and s not in str_to_idx:
            str_to_idx[s] = idx
    appended_strings = []

    def ensure_string(s):
        if s in str_to_idx:
            return str_to_idx[s]
        idx = len(strings) + len(appended_strings)
        appended_strings.append(s)
        str_to_idx[s] = idx
        return idx

    # namespaces
    n, pos = read_u30(buf, pos)
    namespaces = [(0, "")]
    for _ in range(max(0, n - 1)):
        ns_kind = buf[pos]
        pos += 1
        name_idx, pos = read_u30(buf, pos)
        namespaces.append((ns_kind, strings[name_idx]))
    # ns_sets
    n, pos = read_u30(buf, pos)
    for _ in range(max(0, n - 1)):
        cnt, pos = read_u30(buf, pos)
        for _ in range(cnt):
            _, pos = read_u30(buf, pos)
    # multinames
    n, pos = read_u30(buf, pos)
    multinames = [None]
    for _ in range(max(0, n - 1)):
        mkind = buf[pos]
        pos += 1
        if mkind in (0x07, 0x0D):  # QName, QNameA
            ns_idx, pos = read_u30(buf, pos)
            name_idx, pos = read_u30(buf, pos)
            multinames.append((mkind, namespaces[ns_idx][1], strings[name_idx]))
        elif mkind in (0x0F, 0x10):  # RTQName, RTQNameA
            name_idx, pos = read_u30(buf, pos)
            multinames.append((mkind, "", strings[name_idx]))
        elif mkind in (0x11, 0x12):  # RTQNameL, RTQNameLA
            multinames.append((mkind, "", ""))
        elif mkind in (0x09, 0x0E):  # Multiname, MultinameA
            name_idx, pos = read_u30(buf, pos)
            ns_set_idx, pos = read_u30(buf, pos)
            multinames.append((mkind, "*", strings[name_idx]))
        elif mkind in (0x1B, 0x1C):  # MultinameL, MultinameLA
            ns_set_idx, pos = read_u30(buf, pos)
            multinames.append((mkind, "*", ""))
        elif mkind == 0x1D:  # TypeName (Vector.<T>)
            qname_idx, pos = read_u30(buf, pos)
            pcount, pos = read_u30(buf, pos)
            for _ in range(pcount):
                _, pos = read_u30(buf, pos)
            multinames.append((mkind, "", ""))
        else:
            raise ValueError(f"Unknown multiname kind: {hex(mkind)}")

    def find_multiname(name, ns=None):
        for idx, mn in enumerate(multinames):
            if mn is None:
                continue
            mkind, mns, mname = mn
            if mname == name and mkind in (0x07, 0x09):
                if ns is None or mns == ns:
                    return idx
        raise KeyError(f"Multiname not found: {ns}:{name}")

    # method_info
    method_count, pos = read_u30(buf, pos)
    for _ in range(method_count):
        pcount, pos = read_u30(buf, pos)
        _, pos = read_u30(buf, pos)  # return_type
        for _ in range(pcount):
            _, pos = read_u30(buf, pos)  # param_type
        _, pos = read_u30(buf, pos)  # name
        flags = buf[pos]
        pos += 1
        if flags & 0x08:  # HAS_OPTIONAL
            ocount, pos = read_u30(buf, pos)
            for _ in range(ocount):
                _, pos = read_u30(buf, pos)  # val
                pos += 1  # kind
        if flags & 0x80:  # HAS_PARAM_NAMES
            for _ in range(pcount):
                _, pos = read_u30(buf, pos)

    # metadata_info
    meta_count, pos = read_u30(buf, pos)
    for _ in range(meta_count):
        _, pos = read_u30(buf, pos)  # name
        icount, pos = read_u30(buf, pos)
        for _ in range(icount):
            _, pos = read_u30(buf, pos)  # key
            _, pos = read_u30(buf, pos)  # value

    # instance_info & class_info
    class_count, pos = read_u30(buf, pos)
    target_methods = {}
    for _ in range(class_count):
        cname_idx, pos = read_u30(buf, pos)
        _, pos = read_u30(buf, pos)  # super_name
        cflags = buf[pos]
        pos += 1
        if cflags & 0x08:  # ClassProtectedNs
            _, pos = read_u30(buf, pos)
        icount, pos = read_u30(buf, pos)
        for _ in range(icount):
            _, pos = read_u30(buf, pos)
        _, pos = read_u30(buf, pos)  # iinit
        traits, pos = skip_traits(buf, pos)
        cname = multinames[cname_idx][2] if multinames[cname_idx] else ""
        if cname == "Game":
            for tname_idx, tinfo in traits:
                tname = multinames[tname_idx][2] if multinames[tname_idx] else ""
                if tinfo.get("kind") == 1 and tname in ("APISetup", "CreateTeaser"):
                    target_methods[tinfo["method"]] = ("Game", tname)
        elif cname == "BrandingManager":
            for tname_idx, tinfo in traits:
                tname = multinames[tname_idx][2] if multinames[tname_idx] else ""
                if tinfo.get("kind") == 1 and tname in (
                    "getCurrentLanguage",
                    "getLocalizedString",
                    "showBrandingBar",
                    "hideBrandingBar",
                ):
                    target_methods[tinfo["method"]] = ("BrandingManager", tname)

    if not target_methods:
        return None  # Not the DoABC tag containing Game / BrandingManager

    for _ in range(class_count):
        _, pos = read_u30(buf, pos)  # cinit
        _, pos = skip_traits(buf, pos)

    # script_info
    script_count, pos = read_u30(buf, pos)
    for _ in range(script_count):
        _, pos = read_u30(buf, pos)  # init
        _, pos = skip_traits(buf, pos)

    # Build replacement bytecodes
    mn_branding_mgr = find_multiname("BrandingManager", "com.spilgames.bs")
    mn_get_instance = find_multiname("getInstance", "")
    mn_branding_prop = find_multiname("brandingManager", "")
    mn_create_preloader = find_multiname("CreatePreloader", "")
    mn_game_ready = find_multiname("GameReady", "")

    # 1) Game.APISetup()
    api_setup_code = (
        b"\xd0"  # getlocal_0
        b"\x30"  # pushscope
        b"\xd0"  # getlocal_0
        b"\x60" + write_u30(mn_branding_mgr) +  # getlex BrandingManager
        b"\x46" + write_u30(mn_get_instance) + b"\x00" +  # callproperty getInstance, 0
        b"\x61" + write_u30(mn_branding_prop) +  # setproperty brandingManager
        b"\xd0"  # getlocal_0
        b"\x27"  # pushfalse
        b"\x4f" + write_u30(mn_create_preloader) + b"\x01" +  # callpropvoid CreatePreloader, 1
        b"\x47"  # returnvoid
    )

    # 2) Game.CreateTeaser()
    create_teaser_code = (
        b"\xd0"  # getlocal_0
        b"\x30"  # pushscope
        b"\xd0"  # getlocal_0
        b"\x4f" + write_u30(mn_game_ready) + b"\x00" +  # callpropvoid GameReady, 0
        b"\x47"  # returnvoid
    )

    # 3) BrandingManager.getCurrentLanguage() -> "en-US"
    idx_en_us = ensure_string("en-US")
    get_lang_code = (
        b"\xd0"  # getlocal_0
        b"\x30"  # pushscope
        b"\x2c" + write_u30(idx_en_us) +  # pushstring "en-US"
        b"\x48"  # returnvalue
    )

    # 4) BrandingManager.getLocalizedString(param1, param2="SpilGames_Game")
    #    if (param1 == k) return v; ... return param1;
    loc_code = bytearray(b"\xd0\x30")  # getlocal_0; pushscope
    for k, v in loc_pairs:
        k_idx = ensure_string(k)
        v_idx = ensure_string(v)
        ret_block = b"\x2c" + write_u30(v_idx) + b"\x48"  # pushstring v; returnvalue
        loc_code.extend(b"\xd1")  # getlocal_1
        loc_code.extend(b"\x2c" + write_u30(k_idx))  # pushstring k
        loc_code.extend(b"\x14" + write_s24(len(ret_block)))  # ifne skip ret_block
        loc_code.extend(ret_block)
    loc_code.extend(b"\xd1\x48")  # fallback: return param1
    get_loc_code = bytes(loc_code)

    # 5) BrandingManager.showBrandingBar() / hideBrandingBar() -> false
    return_false_code = b"\xd0\x30\x27\x48"  # getlocal_0; pushscope; pushfalse; returnvalue

    # method_body_info — collect edits as (start, end, replacement)
    body_count, pos = read_u30(buf, pos)
    edits = []
    for _ in range(body_count):
        method_idx, pos = read_u30(buf, pos)
        max_stack_start = pos
        max_stack, pos = read_u30(buf, pos)
        max_stack_end = pos
        local_count, pos = read_u30(buf, pos)
        init_scope, pos = read_u30(buf, pos)
        max_scope, pos = read_u30(buf, pos)

        code_len_start = pos
        code_len, pos = read_u30(buf, pos)
        code_end = pos + code_len
        pos = code_end

        exc_count, pos = read_u30(buf, pos)
        for _ in range(exc_count):
            _, pos = read_u30(buf, pos)
            _, pos = read_u30(buf, pos)
            _, pos = read_u30(buf, pos)
            _, pos = read_u30(buf, pos)
            _, pos = read_u30(buf, pos)
        _, pos = skip_traits(buf, pos)

        if method_idx in target_methods:
            cname, mname = target_methods[method_idx]
            if exc_count != 0:
                raise RuntimeError(f"{cname}.{mname} has unexpected exception handlers: {exc_count}")
            new_code = None
            req_stack = max_stack
            if cname == "Game" and mname == "APISetup":
                new_code = api_setup_code
            elif cname == "Game" and mname == "CreateTeaser" and skip_teaser:
                new_code = create_teaser_code
            elif cname == "BrandingManager" and mname == "getCurrentLanguage":
                new_code = get_lang_code
                req_stack = max(max_stack, 2)
            elif cname == "BrandingManager" and mname == "getLocalizedString":
                new_code = get_loc_code
                req_stack = max(max_stack, 3)
            elif cname == "BrandingManager" and mname in ("showBrandingBar", "hideBrandingBar"):
                new_code = return_false_code
                req_stack = max(max_stack, 2)
            if new_code is None:
                continue

            print(
                f"  Patched {cname}.{mname}() [method #{method_idx}]: "
                f"{code_len}B -> {len(new_code)}B (max_stack={req_stack}, locals={local_count})"
            )
            if req_stack != max_stack:
                edits.append((max_stack_start, max_stack_end, write_u30(req_stack)))
            edits.append((code_len_start, code_end, write_u30(len(new_code)) + new_code))

    if not edits:
        raise RuntimeError("No target methods found to patch")

    # Also append any newly added strings to the string constant pool
    if appended_strings:
        new_str_bytes = bytearray()
        for s in appended_strings:
            b = s.encode("utf-8")
            new_str_bytes.extend(write_u30(len(b)))
            new_str_bytes.extend(b)
        new_str_count = len(strings) + len(appended_strings)
        edits.append((str_pool_end, str_pool_end, bytes(new_str_bytes)))
        edits.append((str_count_start, str_count_end, write_u30(new_str_count)))
        print(
            f"  Embedded {len(loc_pairs)} en-US localization strings "
            f"(+{len(appended_strings)} new ABC strings)"
        )

    # Apply edits from highest offset to lowest so earlier offsets stay valid
    edits.sort(key=lambda e: (e[0], e[1]), reverse=True)
    out = bytearray(buf)
    for start, end, repl in edits:
        out[start:end] = repl
    return bytes(out)


def patch_swf_bytes(raw, dst_path, skip_teaser=True):
    sig = raw[:3].decode("ascii")
    ver = raw[3]
    if sig == "CWS":
        body = zlib.decompress(raw[8:])
    elif sig == "FWS":
        body = raw[8:]
    else:
        raise ValueError(f"Unsupported SWF signature: {sig}")

    nbits = body[0] >> 3
    rect_bytes = (5 + nbits * 4 + 7) // 8
    header_end = rect_bytes + 4

    out_body = bytearray(body[:header_end])
    pos = header_end
    patched = False

    while pos < len(body):
        tag_start = pos
        code_len = struct.unpack_from("<H", body, pos)[0]
        pos += 2
        code = code_len >> 6
        length = code_len & 0x3F
        if length == 0x3F:
            length = struct.unpack_from("<I", body, pos)[0]
            pos += 4
        payload = body[pos : pos + length]
        pos += length

        if code == 82 and not patched:  # DoABC2
            flags = payload[:4]
            nul = payload.index(b"\x00", 4)
            name_bytes = payload[4 : nul + 1]
            abc_data = payload[nul + 1 :]
            new_abc = patch_abc(abc_data, skip_teaser=skip_teaser)
            if new_abc is not None:
                patched = True
                new_payload = flags + name_bytes + new_abc
                new_hdr = struct.pack("<HI", (code << 6) | 0x3F, len(new_payload))
                out_body.extend(new_hdr)
                out_body.extend(new_payload)
                continue

        out_body.extend(body[tag_start:pos])
        if code == 0:
            break

    if not patched:
        raise RuntimeError("Did not find class Game in any DoABC tag")

    uncompressed_len = 8 + len(out_body)
    compressed = zlib.compress(bytes(out_body), level=9)
    out_swf = b"CWS" + bytes([ver]) + struct.pack("<I", uncompressed_len) + compressed

    os.makedirs(os.path.dirname(os.path.abspath(dst_path)), exist_ok=True)
    with open(dst_path, "wb") as f:
        f.write(out_swf)

    print(
        f"OK: Wrote patched SWF -> {dst_path} "
        f"({len(raw):,}B -> {len(out_swf):,}B, CWS v{ver}, uncompressed {uncompressed_len:,}B)"
    )


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "swf", "crystal-temple.swf")
    if len(sys.argv) > 1:
        with open(sys.argv[1], "rb") as f:
            raw = f.read()
    else:
        raw = subprocess.check_output(
            ["git", "-C", root, "show", "7fecbd7:Crystal Temple/FireBoyAndWaterGirl - Crystal Temple.swf"]
        )
    patch_swf_bytes(raw, dst, skip_teaser=True)
