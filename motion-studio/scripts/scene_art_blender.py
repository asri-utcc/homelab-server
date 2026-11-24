"""Procedural 3D Scene Art generator for Motion Studio (Blender bpy).

Supports two execution modes:
  1. CLI: `blender -b --python scene_art_blender.py -- --spec spec.json [--out out.png]`
          `blender -b --python scene_art_blender.py -- --list-props`
  2. Embedded spec (for `agent-ctl blender --script`, which passes no argv):
     Replace the SPEC_JSON placeholder assignment (marked with the at-at SPEC at-at comment) with a JSON string literal.

Only standard library + bpy + mathutils imports are used.
"""

import json
import math
import os
import random
import sys

import bpy
import mathutils

BUILDER_VERSION = "2"
SPEC_JSON = None  # @@SPEC@@

try:
    live_snapshot
except NameError:
    def live_snapshot(label=""):
        pass

try:
    live_progress
except NameError:
    def live_progress(pct, msg=""):
        print(f"LAB_PROGRESS {pct} {msg}", flush=True)


# ---------------------------------------------------------------------------
# Color & Material Helpers
# ---------------------------------------------------------------------------

def _srgb_to_linear(c):
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def hex_to_rgba(value, default=(0.95, 0.62, 0.08, 1.0)):
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        r, g, b = float(value[0]), float(value[1]), float(value[2])
        if max(r, g, b) > 1.0:
            r, g, b = r / 255.0, g / 255.0, b / 255.0
        a = float(value[3]) if len(value) >= 4 else 1.0
        return (_srgb_to_linear(max(0.0, min(1.0, r))),
                _srgb_to_linear(max(0.0, min(1.0, g))),
                _srgb_to_linear(max(0.0, min(1.0, b))),
                max(0.0, min(1.0, a)))
    if not isinstance(value, str):
        return default
    s = value.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    if len(s) != 6:
        return default
    try:
        r = int(s[0:2], 16) / 255.0
        g = int(s[2:4], 16) / 255.0
        b = int(s[4:6], 16) / 255.0
        return (_srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b), 1.0)
    except ValueError:
        return default


def tint_rgba(rgba, factor=1.0, mix_white=0.0):
    r, g, b, a = rgba
    r = r * factor * (1.0 - mix_white) + mix_white
    g = g * factor * (1.0 - mix_white) + mix_white
    b = b * factor * (1.0 - mix_white) + mix_white
    return (max(0.0, min(1.0, r)), max(0.0, min(1.0, g)), max(0.0, min(1.0, b)), a)


def _set_input(node, name, value):
    if node and name in node.inputs:
        node.inputs[name].default_value = value


def make_material(name, rgba, preset="clay", emission_strength=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if not bsdf:
        return mat

    _set_input(bsdf, "Base Color", rgba)
    preset = str(preset or "clay").lower()

    if preset == "glossy":
        _set_input(bsdf, "Metallic", 0.08)
        _set_input(bsdf, "Roughness", 0.16)
        _set_input(bsdf, "Coat Weight", 0.65)
        _set_input(bsdf, "Coat Roughness", 0.08)
    elif preset == "metal":
        _set_input(bsdf, "Metallic", 0.92)
        _set_input(bsdf, "Roughness", 0.22)
        _set_input(bsdf, "Coat Weight", 0.15)
    elif preset == "glass":
        _set_input(bsdf, "Metallic", 0.04)
        _set_input(bsdf, "Roughness", 0.08)
        _set_input(bsdf, "IOR", 1.45)
        _set_input(bsdf, "Transmission Weight", 0.72)
        _set_input(bsdf, "Coat Weight", 0.35)
    elif preset == "toon":
        _set_input(bsdf, "Metallic", 0.0)
        _set_input(bsdf, "Roughness", 0.95)
        _set_input(bsdf, "Specular IOR Level", 0.06)
        emission_strength = max(emission_strength, 0.22)
    else:  # clay
        _set_input(bsdf, "Metallic", 0.02)
        _set_input(bsdf, "Roughness", 0.68)
        _set_input(bsdf, "Coat Weight", 0.05)

    if emission_strength > 0.0:
        _set_input(bsdf, "Emission Color", rgba)
        _set_input(bsdf, "Emission Strength", emission_strength)

    return mat


def build_material_bundle(palette, preset="clay", lighting="studio"):
    accent = hex_to_rgba(palette.get("accent"), (0.95, 0.55, 0.06, 1.0))
    accent2 = hex_to_rgba(palette.get("accent2"), (0.12, 0.68, 0.96, 1.0))
    fg = hex_to_rgba(palette.get("fg"), (0.92, 0.94, 0.98, 1.0))
    bg = hex_to_rgba(palette.get("bg"), (0.04, 0.06, 0.12, 1.0))

    glow_boost = 1.6 if lighting == "neon" else 0.75

    return {
        "primary": make_material("SA_Primary", accent, preset),
        "secondary": make_material("SA_Secondary", accent2, preset),
        "fg": make_material("SA_Fg", fg, preset),
        "dark": make_material("SA_Dark", tint_rgba(bg, factor=1.35, mix_white=0.05), preset),
        "metal": make_material("SA_Metal", tint_rgba(fg, factor=0.82), "metal"),
        "glass": make_material("SA_Glass", tint_rgba(accent2, factor=0.9, mix_white=0.35), "glass"),
        "glow1": make_material("SA_Glow1", accent, preset, emission_strength=glow_boost),
        "glow2": make_material("SA_Glow2", accent2, preset, emission_strength=glow_boost),
    }


# ---------------------------------------------------------------------------
# Geometry Primitive Helpers
# ---------------------------------------------------------------------------

def _collection():
    return bpy.context.scene.collection


def _new_empty(name, parent=None, location=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.25
    obj.location = location
    _collection().objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def _assign_mat(obj, mat):
    if mat is None or obj.type != "MESH":
        return
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def _smooth(obj, enable=True):
    if obj.type != "MESH":
        return
    for poly in obj.data.polygons:
        poly.use_smooth = enable


def _bevel(obj, width=0.03, segments=3):
    if obj.type != "MESH":
        return
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30.0)


def _solidify(obj, thickness=0.04, offset=0.0):
    if obj.type != "MESH":
        return
    mod = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset


def _add_box(name, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0),
             mat=None, parent=None, bevel=0.03, segments=3):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    if bevel and bevel > 0:
        _bevel(obj, width=bevel, segments=segments)
    _smooth(obj, True)
    _assign_mat(obj, mat)
    if parent is not None:
        obj.parent = parent
    return obj


def _add_cyl(name, radius=0.5, depth=1.0, vertices=32, loc=(0, 0, 0),
             rot=(0, 0, 0), mat=None, parent=None, bevel=0.02):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot
    )
    obj = bpy.context.active_object
    obj.name = name
    if bevel and bevel > 0:
        _bevel(obj, width=bevel, segments=2)
    _smooth(obj, True)
    _assign_mat(obj, mat)
    if parent is not None:
        obj.parent = parent
    return obj


def _add_cone(name, r1=0.5, r2=0.0, depth=1.0, vertices=32, loc=(0, 0, 0),
              rot=(0, 0, 0), mat=None, parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot
    )
    obj = bpy.context.active_object
    obj.name = name
    if bevel and bevel > 0:
        _bevel(obj, width=bevel, segments=2)
    _smooth(obj, True)
    _assign_mat(obj, mat)
    if parent is not None:
        obj.parent = parent
    return obj


def _add_sphere(name, radius=0.5, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0),
                mat=None, parent=None, segments=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=loc, rotation=rot
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    _smooth(obj, True)
    _assign_mat(obj, mat)
    if parent is not None:
        obj.parent = parent
    return obj


def _add_torus(name, major=0.5, minor=0.08, loc=(0, 0, 0), rot=(0, 0, 0),
               mat=None, parent=None, major_seg=36, minor_seg=14):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=major_seg, minor_segments=minor_seg,
        location=loc, rotation=rot,
    )
    obj = bpy.context.active_object
    obj.name = name
    _smooth(obj, True)
    _assign_mat(obj, mat)
    if parent is not None:
        obj.parent = parent
    return obj


def _add_segment(name, p1, p2, radius=0.06, mat=None, parent=None):
    v1 = mathutils.Vector(p1)
    v2 = mathutils.Vector(p2)
    diff = v2 - v1
    length = diff.length
    if length < 1e-5:
        return None
    mid = (v1 + v2) * 0.5
    quat = diff.to_track_quat("Z", "Y")
    return _add_cyl(
        name, radius=radius, depth=length, vertices=20,
        loc=tuple(mid), rot=quat.to_euler(), mat=mat, parent=parent, bevel=0.008,
    )


def _aux_mat(mat_primary, mat_secondary, kind="dark"):
    bundle = _ACTIVE_MATS
    if bundle and kind in bundle:
        return bundle[kind]
    return mat_secondary if kind in ("secondary", "glow2", "glass") else mat_primary


_ACTIVE_MATS = {}


# ---------------------------------------------------------------------------
# Procedural Prop Library (20 Props, each within ~2.0 unit bounding box)
# ---------------------------------------------------------------------------

def build_coin_stack(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_CoinStack")
    stacks = [
        (-0.42, -0.10, 7, 0.40),
        (0.36, 0.14, 5, 0.38),
        (0.08, -0.44, 3, 0.34),
    ]
    coin_h = 0.11
    for s_idx, (sx, sy, count, rad) in enumerate(stacks):
        mat_use = mat_primary if s_idx != 1 else mat_secondary
        for i in range(count):
            jx = rng.uniform(-0.025, 0.025)
            jy = rng.uniform(-0.025, 0.025)
            z = -0.65 + i * (coin_h + 0.015)
            _add_cyl(f"Coin_{s_idx}_{i}", radius=rad, depth=coin_h, vertices=32,
                     loc=(sx + jx, sy + jy, z), mat=mat_use, parent=root, bevel=0.022)
            if i == count - 1:
                _add_torus(f"CoinRim_{s_idx}", major=rad * 0.72, minor=0.022,
                           loc=(sx + jx, sy + jy, z + coin_h * 0.5),
                           mat=_aux_mat(mat_primary, mat_secondary, "glow1"), parent=root)
    # Floating tilted hero coin
    _add_cyl("CoinHero", radius=0.42, depth=0.10, vertices=36,
             loc=(0.15, 0.05, 0.52), rot=(math.radians(68), math.radians(-18), math.radians(24)),
             mat=mat_primary, parent=root, bevel=0.025)
    _add_torus("CoinHeroRim", major=0.30, minor=0.025,
               loc=(0.15, 0.05, 0.52), rot=(math.radians(68), math.radians(-18), math.radians(24)),
               mat=_aux_mat(mat_primary, mat_secondary, "fg"), parent=root)
    return root


def build_banknote_fan(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_BanknoteFan")
    fg = _aux_mat(mat_primary, mat_secondary, "fg")
    count = 7
    for i in range(count):
        t = (i / (count - 1)) - 0.5
        angle = math.radians(t * 58.0)
        dx = math.sin(angle) * 0.42
        dz = math.cos(angle) * 0.16 - 0.12
        dy = (i - count * 0.5) * 0.055
        mat_use = mat_primary if i % 2 == 0 else mat_secondary
        bill = _add_box(f"Bill_{i}", size=(1.28, 0.032, 0.62),
                        loc=(dx, dy, dz), rot=(0.0, -angle, 0.0),
                        mat=mat_use, parent=root, bevel=0.012, segments=2)
        _add_box(f"BillBand_{i}", size=(0.24, 0.042, 0.64),
                 loc=(dx, dy, dz), rot=(0.0, -angle, 0.0),
                 mat=fg, parent=root, bevel=0.008, segments=2)
        if i == count // 2:
            _add_cyl("BillEmblem", radius=0.15, depth=0.05, vertices=24,
                     loc=(dx, dy - 0.02, dz), rot=(math.radians(90), 0, 0),
                     mat=_aux_mat(mat_primary, mat_secondary, "glow1"), parent=root, bevel=0.01)
            _ = bill
    return root


def build_candle_chart(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_CandleChart")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    fg = _aux_mat(mat_primary, mat_secondary, "fg")
    _add_box("ChartBase", size=(1.95, 0.42, 0.10), loc=(0, 0, -0.78),
             mat=dark, parent=root, bevel=0.03)
    candles = [
        (-0.72, -0.35, 0.38, True),
        (-0.48, -0.18, 0.52, True),
        (-0.24, -0.22, 0.34, False),
        (0.00, 0.05, 0.60, True),
        (0.24, 0.12, 0.42, False),
        (0.48, 0.30, 0.62, True),
        (0.72, 0.48, 0.56, True),
    ]
    pts = []
    for idx, (x, cy, h, bull) in enumerate(candles):
        h_var = h * rng.uniform(0.88, 1.12)
        mat_use = mat_primary if bull else mat_secondary
        _add_box(f"CandleBody_{idx}", size=(0.16, 0.16, h_var),
                 loc=(x, 0.0, cy), mat=mat_use, parent=root, bevel=0.025)
        _add_cyl(f"CandleWick_{idx}", radius=0.022, depth=h_var + 0.42,
                 loc=(x, 0.0, cy), mat=fg, parent=root, bevel=0.004)
        pts.append((x, -0.14, cy + h_var * 0.35))
    for i in range(len(pts) - 1):
        _add_segment(f"TrendSeg_{i}", pts[i], pts[i + 1], radius=0.024,
                     mat=_aux_mat(mat_primary, mat_secondary, "glow1"), parent=root)
    return root


def build_bar_chart(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_BarChart")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    _add_box("BarBase", size=(1.90, 0.52, 0.12), loc=(0, 0, -0.80),
             mat=dark, parent=root, bevel=0.03)
    heights = [0.42, 0.68, 0.96, 1.24, 1.56]
    for i, h in enumerate(heights):
        x = -0.68 + i * 0.34
        hv = h * rng.uniform(0.92, 1.06)
        mat_use = mat_primary if i >= 3 else mat_secondary
        _add_box(f"Bar_{i}", size=(0.24, 0.28, hv),
                 loc=(x, 0.0, -0.74 + hv * 0.5), mat=mat_use, parent=root, bevel=0.035)
    # Rising accent bar cap orb
    _add_sphere("BarPeakOrb", radius=0.14, loc=(0.68, 0.0, 0.96),
                mat=_aux_mat(mat_primary, mat_secondary, "glow1"), parent=root)
    return root


def build_line_graph_arrow(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_LineGraphArrow")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    _add_box("GraphBack", size=(1.85, 0.10, 1.35), loc=(0, 0.18, -0.05),
             mat=dark, parent=root, bevel=0.04)
    pts = [
        (-0.78, -0.02, -0.52),
        (-0.36, -0.02, -0.15),
        (0.02, -0.02, -0.28),
        (0.42, -0.02, 0.25),
        (0.76, -0.02, 0.62),
    ]
    for i in range(len(pts) - 1):
        _add_segment(f"LineSeg_{i}", pts[i], pts[i + 1], radius=0.065,
                     mat=mat_primary, parent=root)
    for i, p in enumerate(pts[:-1]):
        _add_sphere(f"Node_{i}", radius=0.10, loc=p, mat=mat_secondary, parent=root)
    # Arrowhead at end
    p_prev = mathutils.Vector(pts[-2])
    p_end = mathutils.Vector(pts[-1])
    direction = (p_end - p_prev).normalized()
    quat = direction.to_track_quat("Z", "Y")
    _add_cone("ArrowHead", r1=0.22, r2=0.0, depth=0.42, vertices=24,
              loc=tuple(p_end + direction * 0.14), rot=quat.to_euler(),
              mat=_aux_mat(mat_primary, mat_secondary, "glow1"), parent=root)
    return root


def build_robot_bot(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_RobotBot")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    glow2 = _aux_mat(mat_primary, mat_secondary, "glow2")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    # Head
    _add_box("BotHead", size=(0.92, 0.68, 0.66), loc=(0, 0, 0.36),
             mat=mat_primary, parent=root, bevel=0.14, segments=4)
    _add_box("BotVisor", size=(0.72, 0.10, 0.34), loc=(0, -0.33, 0.36),
             mat=dark, parent=root, bevel=0.04, segments=3)
    _add_sphere("BotEyeL", radius=0.085, loc=(-0.18, -0.39, 0.38), mat=glow2, parent=root)
    _add_sphere("BotEyeR", radius=0.085, loc=(0.18, -0.39, 0.38), mat=glow2, parent=root)
    # Antenna
    _add_cyl("BotAntStem", radius=0.032, depth=0.26, loc=(0, 0, 0.78),
             mat=mat_secondary, parent=root, bevel=0.005)
    _add_sphere("BotAntOrb", radius=0.095, loc=(0, 0, 0.94), mat=glow1, parent=root)
    # Body
    _add_box("BotBody", size=(0.74, 0.52, 0.64), loc=(0, 0, -0.32),
             mat=mat_secondary, parent=root, bevel=0.12, segments=4)
    _add_cyl("BotCore", radius=0.14, depth=0.08, loc=(0, -0.26, -0.28),
             rot=(math.radians(90), 0, 0), mat=glow1, parent=root, bevel=0.02)
    # Arms
    _add_cyl("BotArmL", radius=0.10, depth=0.46, loc=(-0.54, 0, -0.26),
             rot=(0, math.radians(18), 0), mat=mat_primary, parent=root, bevel=0.04)
    _add_cyl("BotArmR", radius=0.10, depth=0.46, loc=(0.54, 0, -0.26),
             rot=(0, math.radians(-18), 0), mat=mat_primary, parent=root, bevel=0.04)
    # Hover ring
    _add_torus("BotHover", major=0.46, minor=0.045, loc=(0, 0, -0.82),
               mat=glow2, parent=root)
    return root


def build_laptop(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Laptop")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    glow2 = _aux_mat(mat_primary, mat_secondary, "glow2")
    metal = _aux_mat(mat_primary, mat_secondary, "metal")
    # Base deck
    _add_box("LapBase", size=(1.55, 1.05, 0.08), loc=(0, 0.0, -0.45),
             mat=metal, parent=root, bevel=0.025, segments=3)
    _add_box("LapKeys", size=(1.32, 0.56, 0.03), loc=(0, -0.06, -0.40),
             mat=dark, parent=root, bevel=0.01)
    _add_box("LapPad", size=(0.42, 0.24, 0.02), loc=(0, -0.36, -0.40),
             mat=mat_secondary, parent=root, bevel=0.008)
    # Hinged lid
    lid_tilt = math.radians(-108)
    lid_pivot = _new_empty("LapLidPivot", parent=root, location=(0, 0.50, -0.41))
    lid_pivot.rotation_euler = (lid_tilt, 0, 0)
    _add_box("LapLid", size=(1.54, 1.00, 0.06), loc=(0, 0.50, 0.0),
             mat=mat_primary, parent=lid_pivot, bevel=0.022)
    _add_box("LapScreen", size=(1.40, 0.86, 0.02), loc=(0, 0.50, -0.035),
             mat=dark, parent=lid_pivot, bevel=0.006)
    # UI bars on screen
    for i, (w, z_off) in enumerate([(0.95, 0.72), (0.68, 0.54), (1.08, 0.36)]):
        _add_box(f"LapUI_{i}", size=(w, 0.10, 0.025),
                 loc=(-0.60 + w * 0.5, z_off, -0.052),
                 mat=glow2 if i % 2 == 0 else mat_primary, parent=lid_pivot, bevel=0.008)
    return root


def build_smartphone(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Smartphone")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    glow2 = _aux_mat(mat_primary, mat_secondary, "glow2")
    _add_box("PhoneBody", size=(0.94, 0.14, 1.78), loc=(0, 0, 0),
             mat=mat_primary, parent=root, bevel=0.06, segments=4)
    _add_box("PhoneScreen", size=(0.82, 0.04, 1.60), loc=(0, -0.065, 0),
             mat=dark, parent=root, bevel=0.03, segments=3)
    # Floating UI cards
    _add_box("PhoneCard1", size=(0.66, 0.05, 0.42), loc=(0, -0.12, 0.42),
             mat=glow2, parent=root, bevel=0.02)
    _add_box("PhoneCard2", size=(0.66, 0.05, 0.28), loc=(0, -0.12, -0.04),
             mat=mat_secondary, parent=root, bevel=0.02)
    _add_box("PhoneCard3", size=(0.48, 0.05, 0.22), loc=(-0.09, -0.12, -0.42),
             mat=glow1, parent=root, bevel=0.02)
    # Rear camera bump
    _add_box("PhoneCamBump", size=(0.30, 0.06, 0.42), loc=(0.22, 0.08, 0.52),
             mat=dark, parent=root, bevel=0.02)
    _add_cyl("PhoneLens1", radius=0.08, depth=0.05, loc=(0.22, 0.11, 0.61),
             rot=(math.radians(90), 0, 0), mat=glow2, parent=root, bevel=0.01)
    _add_cyl("PhoneLens2", radius=0.08, depth=0.05, loc=(0.22, 0.11, 0.42),
             rot=(math.radians(90), 0, 0), mat=glow2, parent=root, bevel=0.01)
    return root


def build_shield_lock(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_ShieldLock")
    metal = _aux_mat(mat_primary, mat_secondary, "metal")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    # Shield body (6-sided stretched prism)
    _add_cyl("ShieldBody", radius=0.86, depth=0.22, vertices=6,
             loc=(0, 0.10, 0.02), rot=(math.radians(90), 0, math.radians(30)),
             mat=mat_secondary, parent=root, bevel=0.05)
    _add_cyl("ShieldInner", radius=0.70, depth=0.26, vertices=6,
             loc=(0, 0.08, 0.02), rot=(math.radians(90), 0, math.radians(30)),
             mat=mat_primary, parent=root, bevel=0.04)
    # Padlock on front
    _add_box("LockBody", size=(0.56, 0.26, 0.46), loc=(0, -0.14, -0.14),
             mat=metal, parent=root, bevel=0.05, segments=3)
    _add_torus("LockShackle", major=0.18, minor=0.05,
               loc=(0, -0.14, 0.18), rot=(math.radians(90), 0, 0),
               mat=metal, parent=root)
    _add_cyl("LockKeyhole", radius=0.06, depth=0.06, loc=(0, -0.27, -0.12),
             rot=(math.radians(90), 0, 0), mat=glow1, parent=root, bevel=0.01)
    return root


def build_rocket(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Rocket")
    fg = _aux_mat(mat_primary, mat_secondary, "fg")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    glass = _aux_mat(mat_primary, mat_secondary, "glass")
    # Fuselage
    _add_cyl("RocketBody", radius=0.34, depth=0.92, vertices=32,
             loc=(0, 0, -0.04), mat=fg, parent=root, bevel=0.04)
    _add_cone("RocketNose", r1=0.34, r2=0.02, depth=0.58, vertices=32,
              loc=(0, 0, 0.68), mat=mat_primary, parent=root)
    # Window
    _add_torus("RocketWinFrame", major=0.14, minor=0.035,
               loc=(0, -0.33, 0.16), rot=(math.radians(90), 0, 0),
               mat=mat_secondary, parent=root)
    _add_sphere("RocketWinGlass", radius=0.12, scale=(1, 0.45, 1),
                loc=(0, -0.32, 0.16), mat=glass, parent=root)
    # 3 Fins
    for i in range(3):
        ang = i * (2.0 * math.pi / 3.0) + math.radians(30)
        fx = math.cos(ang) * 0.40
        fy = math.sin(ang) * 0.40
        _add_box(f"RocketFin_{i}", size=(0.34, 0.06, 0.42),
                 loc=(fx, fy, -0.36), rot=(0, math.radians(18), ang),
                 mat=mat_primary, parent=root, bevel=0.015)
    # Nozzle & flame
    _add_cone("RocketNozzle", r1=0.22, r2=0.15, depth=0.22, vertices=24,
              loc=(0, 0, -0.58), mat=mat_secondary, parent=root)
    _add_cone("RocketFlame", r1=0.16, r2=0.0, depth=0.40, vertices=20,
              loc=(0, 0, -0.84), rot=(math.radians(180), 0, 0),
              mat=glow1, parent=root)
    root.rotation_euler = (math.radians(-12), math.radians(18), 0)
    return root


def _make_gear(name, radius, teeth, thickness, loc, rot, mat, hub_mat, parent):
    g_root = _new_empty(name, parent=parent, location=loc)
    g_root.rotation_euler = rot
    _add_cyl(f"{name}_Rim", radius=radius, depth=thickness, vertices=32,
             mat=mat, parent=g_root, bevel=0.02)
    _add_torus(f"{name}_Ring", major=radius * 0.56, minor=thickness * 0.36,
               mat=hub_mat, parent=g_root)
    _add_cyl(f"{name}_Hub", radius=radius * 0.28, depth=thickness * 1.28, vertices=24,
             mat=hub_mat, parent=g_root, bevel=0.015)
    tooth_w = (2.0 * math.pi * radius / teeth) * 0.46
    for i in range(teeth):
        ang = i * (2.0 * math.pi / teeth)
        tx = math.cos(ang) * (radius + 0.08)
        ty = math.sin(ang) * (radius + 0.08)
        _add_box(f"{name}_T{i}", size=(0.20, tooth_w, thickness * 0.92),
                 loc=(tx, ty, 0), rot=(0, 0, ang), mat=mat, parent=g_root, bevel=0.015)
    return g_root


def build_gear_pair(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_GearPair")
    metal = _aux_mat(mat_primary, mat_secondary, "metal")
    _make_gear("GearBig", 0.58, 12, 0.22, (-0.34, 0, -0.12),
               (math.radians(90), 0, 0), mat_primary, metal, root)
    _make_gear("GearSmall", 0.40, 8, 0.20, (0.58, 0.04, 0.36),
               (math.radians(90), math.radians(22), 0), mat_secondary, metal, root)
    return root


def build_lightbulb(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Lightbulb")
    metal = _aux_mat(mat_primary, mat_secondary, "metal")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    # Glass bulb
    _add_sphere("BulbGlass", radius=0.58, loc=(0, 0, 0.30), mat=mat_primary, parent=root)
    _add_cone("BulbNeck", r1=0.28, r2=0.48, depth=0.40, vertices=32,
              loc=(0, 0, -0.18), mat=mat_primary, parent=root)
    # Inner glowing halo ring
    _add_torus("BulbHalo", major=0.72, minor=0.032, loc=(0, 0, 0.30),
               rot=(math.radians(25), math.radians(-18), 0), mat=glow1, parent=root)
    # Screw base rings
    for i in range(4):
        _add_torus(f"BulbThread_{i}", major=0.24 - i * 0.012, minor=0.048,
                   loc=(0, 0, -0.44 - i * 0.095), mat=metal, parent=root)
    _add_sphere("BulbTip", radius=0.14, scale=(1, 1, 0.6), loc=(0, 0, -0.82),
                mat=mat_secondary, parent=root)
    return root


def build_globe(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Globe")
    metal = _aux_mat(mat_primary, mat_secondary, "metal")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    sphere_root = _new_empty("GlobeTilt", parent=root, location=(0, 0, 0.12))
    sphere_root.rotation_euler = (math.radians(14), math.radians(-22), 0)
    _add_sphere("GlobeCore", radius=0.64, mat=mat_secondary, parent=sphere_root)
    for deg in (-35, 0, 35):
        r = math.cos(math.radians(deg)) * 0.65
        z = math.sin(math.radians(deg)) * 0.65
        _add_torus(f"Lat_{deg}", major=r, minor=0.022, loc=(0, 0, z),
                   mat=mat_primary, parent=sphere_root)
    for deg in (0, 60, 120):
        _add_torus(f"Lon_{deg}", major=0.65, minor=0.022,
                   rot=(math.radians(90), 0, math.radians(deg)),
                   mat=mat_primary, parent=sphere_root)
    # Orbit & satellite
    _add_torus("GlobeOrbit", major=0.92, minor=0.024,
               rot=(math.radians(66), math.radians(-20), 0), mat=glow1, parent=root)
    _add_sphere("GlobeSat", radius=0.09, loc=(0.82, -0.22, 0.36), mat=glow1, parent=root)
    # Base stand
    _add_cyl("GlobeStem", radius=0.08, depth=0.36, loc=(0, 0, -0.64),
             mat=metal, parent=root, bevel=0.01)
    _add_cyl("GlobeBase", radius=0.46, depth=0.10, loc=(0, 0, -0.82),
             mat=metal, parent=root, bevel=0.025)
    return root


def build_server_rack(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_ServerRack")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    glow2 = _aux_mat(mat_primary, mat_secondary, "glow2")
    _add_box("RackChassis", size=(1.08, 0.78, 1.76), loc=(0, 0, 0),
             mat=dark, parent=root, bevel=0.045, segments=3)
    for i in range(5):
        z = -0.60 + i * 0.30
        _add_box(f"Blade_{i}", size=(0.94, 0.08, 0.22), loc=(0, -0.38, z),
                 mat=mat_secondary if i % 2 == 0 else mat_primary,
                 parent=root, bevel=0.015)
        _add_sphere(f"LedA_{i}", radius=0.036, loc=(-0.34, -0.43, z),
                    mat=glow1 if i % 2 == 0 else glow2, parent=root)
        _add_sphere(f"LedB_{i}", radius=0.036, loc=(-0.22, -0.43, z),
                    mat=glow2, parent=root)
        _add_box(f"Vent_{i}", size=(0.42, 0.04, 0.06), loc=(0.14, -0.42, z),
                 mat=dark, parent=root, bevel=0.006)
    return root


def build_piggy_bank(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_PiggyBank")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    # Body
    _add_sphere("PigBody", radius=0.66, scale=(1.22, 0.92, 0.94), loc=(0, 0, -0.02),
                mat=mat_primary, parent=root)
    # Snout
    _add_cyl("PigSnout", radius=0.22, depth=0.22, vertices=24,
             loc=(0.82, 0, -0.04), rot=(0, math.radians(90), 0),
             mat=mat_secondary, parent=root, bevel=0.04)
    _add_sphere("PigNostrilL", radius=0.042, loc=(0.93, -0.07, -0.02), mat=dark, parent=root)
    _add_sphere("PigNostrilR", radius=0.042, loc=(0.93, 0.07, -0.02), mat=dark, parent=root)
    # Eyes
    _add_sphere("PigEyeL", radius=0.065, loc=(0.56, -0.36, 0.24), mat=dark, parent=root)
    _add_sphere("PigEyeR", radius=0.065, loc=(0.56, 0.36, 0.24), mat=dark, parent=root)
    # Ears
    _add_cone("PigEarL", r1=0.16, r2=0.03, depth=0.26, loc=(0.32, -0.34, 0.56),
              rot=(math.radians(-28), math.radians(15), 0), mat=mat_primary, parent=root)
    _add_cone("PigEarR", r1=0.16, r2=0.03, depth=0.26, loc=(0.32, 0.34, 0.56),
              rot=(math.radians(28), math.radians(15), 0), mat=mat_primary, parent=root)
    # Legs
    for idx, (lx, ly) in enumerate([(-0.42, -0.28), (-0.42, 0.28), (0.36, -0.28), (0.36, 0.28)]):
        _add_cyl(f"PigLeg_{idx}", radius=0.13, depth=0.34, loc=(lx, ly, -0.58),
                 mat=mat_primary, parent=root, bevel=0.035)
    # Coin slot & coin dropping in
    _add_box("PigSlot", size=(0.36, 0.06, 0.06), loc=(0.0, 0, 0.60),
             mat=dark, parent=root, bevel=0.01)
    _add_cyl("PigCoin", radius=0.24, depth=0.06, vertices=28,
             loc=(0.0, 0, 0.78), rot=(math.radians(90), 0, 0),
             mat=glow1, parent=root, bevel=0.015)
    return root


def build_hourglass(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Hourglass")
    glass = _aux_mat(mat_primary, mat_secondary, "glass")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    # Top & bottom caps
    _add_cyl("HgTop", radius=0.62, depth=0.12, loc=(0, 0, 0.84),
             mat=mat_secondary, parent=root, bevel=0.03)
    _add_cyl("HgBot", radius=0.62, depth=0.12, loc=(0, 0, -0.84),
             mat=mat_secondary, parent=root, bevel=0.03)
    # 3 Pillars
    for i in range(3):
        ang = i * (2.0 * math.pi / 3.0) + math.radians(30)
        _add_cyl(f"HgPillar_{i}", radius=0.048, depth=1.64,
                 loc=(math.cos(ang) * 0.50, math.sin(ang) * 0.50, 0),
                 mat=mat_primary, parent=root, bevel=0.008)
    # Glass cones
    _add_cone("HgGlassTop", r1=0.06, r2=0.46, depth=0.76, vertices=32,
              loc=(0, 0, 0.40), mat=glass, parent=root)
    _add_cone("HgGlassBot", r1=0.46, r2=0.06, depth=0.76, vertices=32,
              loc=(0, 0, -0.40), mat=glass, parent=root)
    # Sand inside
    _add_cone("HgSandTop", r1=0.04, r2=0.30, depth=0.38, vertices=24,
              loc=(0, 0, 0.24), mat=glow1, parent=root)
    _add_cone("HgSandBot", r1=0.36, r2=0.04, depth=0.34, vertices=24,
              loc=(0, 0, -0.60), mat=glow1, parent=root)
    _add_cyl("HgSandStream", radius=0.022, depth=0.50, loc=(0, 0, -0.22),
             mat=glow1, parent=root, bevel=0.002)
    return root


def build_trophy(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Trophy")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    # Pedestal
    _add_box("TrophyBase1", size=(0.82, 0.82, 0.24), loc=(0, 0, -0.78),
             mat=dark, parent=root, bevel=0.03)
    _add_cyl("TrophyBase2", radius=0.32, depth=0.14, loc=(0, 0, -0.60),
             mat=mat_secondary, parent=root, bevel=0.025)
    _add_cyl("TrophyStem", radius=0.11, depth=0.46, loc=(0, 0, -0.32),
             mat=mat_primary, parent=root, bevel=0.02)
    # Cup
    _add_cone("TrophyCup", r1=0.24, r2=0.54, depth=0.76, vertices=36,
              loc=(0, 0, 0.26), mat=mat_primary, parent=root)
    _add_torus("TrophyRim", major=0.54, minor=0.045, loc=(0, 0, 0.64),
               mat=glow1, parent=root)
    # Handles
    _add_torus("TrophyHandleL", major=0.24, minor=0.042, loc=(-0.54, 0, 0.30),
               rot=(math.radians(90), 0, 0), mat=mat_secondary, parent=root)
    _add_torus("TrophyHandleR", major=0.24, minor=0.042, loc=(0.54, 0, 0.30),
               rot=(math.radians(90), 0, 0), mat=mat_secondary, parent=root)
    # Floating top emblem
    _add_sphere("TrophyOrb", radius=0.14, loc=(0, 0, 0.90), mat=glow1, parent=root)
    return root


def build_target_dart(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_TargetDart")
    fg = _aux_mat(mat_primary, mat_secondary, "fg")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    rings = [
        (0.86, 0.14, mat_primary),
        (0.64, 0.17, fg),
        (0.42, 0.20, mat_secondary),
        (0.20, 0.23, glow1),
    ]
    for i, (r, d, m) in enumerate(rings):
        _add_cyl(f"TargetRing_{i}", radius=r, depth=d, vertices=40,
                 loc=(0, 0.12 - i * 0.015, 0), rot=(math.radians(90), 0, 0),
                 mat=m, parent=root, bevel=0.02)
    # Dart stuck in bullseye
    dart = _new_empty("DartRoot", parent=root, location=(0, -0.02, 0))
    dart.rotation_euler = (math.radians(14), math.radians(-16), 0)
    _add_cyl("DartShaft", radius=0.045, depth=0.92, loc=(0, -0.46, 0),
             rot=(math.radians(90), 0, 0), mat=mat_secondary, parent=dart, bevel=0.008)
    _add_cone("DartTip", r1=0.05, r2=0.005, depth=0.16, loc=(0, -0.02, 0),
              rot=(math.radians(-90), 0, 0), mat=fg, parent=dart)
    for i in range(4):
        ang = i * (math.pi / 2.0) + math.radians(45)
        _add_box(f"DartFin_{i}", size=(0.03, 0.28, 0.22),
                 loc=(math.cos(ang) * 0.10, -0.80, math.sin(ang) * 0.10),
                 rot=(0, ang, 0), mat=mat_primary, parent=dart, bevel=0.006)
    return root


def build_magnifier(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_Magnifier")
    glass = _aux_mat(mat_primary, mat_secondary, "glass")
    metal = _aux_mat(mat_primary, mat_secondary, "metal")
    glow2 = _aux_mat(mat_primary, mat_secondary, "glow2")
    rig = _new_empty("MagRig", parent=root, location=(0, 0, 0.10))
    rig.rotation_euler = (0, math.radians(-28), 0)
    _add_torus("MagRim", major=0.58, minor=0.095, loc=(0, 0, 0.26),
               rot=(math.radians(90), 0, 0), mat=mat_primary, parent=rig)
    _add_cyl("MagLens", radius=0.54, depth=0.07, vertices=36,
             loc=(0, 0, 0.26), rot=(math.radians(90), 0, 0),
             mat=glass, parent=rig, bevel=0.015)
    _add_cyl("MagCollar", radius=0.11, depth=0.16, loc=(0, 0, -0.40),
             mat=metal, parent=rig, bevel=0.02)
    _add_cyl("MagHandle", radius=0.095, depth=0.72, loc=(0, 0, -0.82),
             mat=mat_secondary, parent=rig, bevel=0.03)
    # Floating data cube being inspected
    _add_box("MagTarget", size=(0.30, 0.30, 0.30), loc=(0.45, 0.28, 0.34),
             rot=(math.radians(32), math.radians(24), math.radians(18)),
             mat=glow2, parent=root, bevel=0.04)
    return root


def build_warning_sign(mat_primary, mat_secondary, rng):
    root = _new_empty("Prop_WarningSign")
    dark = _aux_mat(mat_primary, mat_secondary, "dark")
    glow1 = _aux_mat(mat_primary, mat_secondary, "glow1")
    # 3-sided rounded triangle prism via 3-vertex cylinder + bevel
    _add_cyl("WarnBack", radius=0.96, depth=0.20, vertices=3,
             loc=(0, 0.04, -0.10), rot=(math.radians(90), 0, math.radians(30)),
             mat=mat_primary, parent=root, bevel=0.08)
    _add_cyl("WarnInner", radius=0.74, depth=0.24, vertices=3,
             loc=(0, 0.02, -0.10), rot=(math.radians(90), 0, math.radians(30)),
             mat=dark, parent=root, bevel=0.05)
    # Exclamation mark
    _add_box("WarnBar", size=(0.16, 0.14, 0.56), loc=(0, -0.12, 0.08),
             mat=glow1, parent=root, bevel=0.035)
    _add_sphere("WarnDot", radius=0.10, loc=(0, -0.12, -0.34),
                mat=glow1, parent=root)
    return root


PROP_LIBRARY = {
    "coin-stack": build_coin_stack,
    "banknote-fan": build_banknote_fan,
    "candle-chart": build_candle_chart,
    "bar-chart": build_bar_chart,
    "line-graph-arrow": build_line_graph_arrow,
    "robot-bot": build_robot_bot,
    "laptop": build_laptop,
    "smartphone": build_smartphone,
    "shield-lock": build_shield_lock,
    "rocket": build_rocket,
    "gear-pair": build_gear_pair,
    "lightbulb": build_lightbulb,
    "globe": build_globe,
    "server-rack": build_server_rack,
    "piggy-bank": build_piggy_bank,
    "hourglass": build_hourglass,
    "trophy": build_trophy,
    "target-dart": build_target_dart,
    "magnifier": build_magnifier,
    "warning-sign": build_warning_sign,
}

ALIAS = {
    # DIRECTION_PROPS mappings
    "laptop": "laptop",
    "mug": "lightbulb",
    "cup-tower": "coin-stack",
    "calendar": "hourglass",
    "clock": "hourglass",
    "resume": "laptop",
    "chair": "server-rack",
    "phone": "smartphone",
    "bulb": "lightbulb",
    "money": "banknote-fan",
    "trophy": "trophy",
    "plant": "globe",
    "window": "laptop",
    "briefcase": "shield-lock",
    "rocket": "rocket",
    "chart": "candle-chart",
    "question": "magnifier",
    "check": "target-dart",
    "cross": "warning-sign",
    "robot": "robot-bot",
    "book": "laptop",
    "star": "trophy",
    "heart": "piggy-bank",
    "fire": "rocket",
    # DIRECTION_CAST mappings
    "hero": "trophy",
    "interviewer": "magnifier",
    "boss": "banknote-fan",
    "friend": "robot-bot",
    "crowd": "globe",
    # Common domain aliases
    "cash": "banknote-fan",
    "banknote": "banknote-fan",
    "bill": "banknote-fan",
    "dollar": "banknote-fan",
    "baht": "banknote-fan",
    "coin": "coin-stack",
    "coins": "coin-stack",
    "gold": "coin-stack",
    "crypto": "coin-stack",
    "bitcoin": "coin-stack",
    "bot": "robot-bot",
    "ai": "robot-bot",
    "agent": "robot-bot",
    "trading-bot": "robot-bot",
    "candle": "candle-chart",
    "candlestick": "candle-chart",
    "stock": "candle-chart",
    "trade": "candle-chart",
    "bar": "bar-chart",
    "bars": "bar-chart",
    "stats": "bar-chart",
    "data": "bar-chart",
    "graph": "line-graph-arrow",
    "line": "line-graph-arrow",
    "growth": "line-graph-arrow",
    "profit": "line-graph-arrow",
    "trend": "line-graph-arrow",
    "mobile": "smartphone",
    "app": "smartphone",
    "computer": "laptop",
    "code": "laptop",
    "shield": "shield-lock",
    "lock": "shield-lock",
    "security": "shield-lock",
    "safe": "shield-lock",
    "gear": "gear-pair",
    "gears": "gear-pair",
    "cog": "gear-pair",
    "settings": "gear-pair",
    "system": "gear-pair",
    "idea": "lightbulb",
    "lamp": "lightbulb",
    "brain": "lightbulb",
    "earth": "globe",
    "world": "globe",
    "network": "globe",
    "internet": "globe",
    "server": "server-rack",
    "cloud": "server-rack",
    "database": "server-rack",
    "piggy": "piggy-bank",
    "saving": "piggy-bank",
    "savings": "piggy-bank",
    "bank": "piggy-bank",
    "time": "hourglass",
    "timer": "hourglass",
    "sand": "hourglass",
    "award": "trophy",
    "winner": "trophy",
    "cup": "trophy",
    "target": "target-dart",
    "goal": "target-dart",
    "dart": "target-dart",
    "bullseye": "target-dart",
    "search": "magnifier",
    "lens": "magnifier",
    "zoom": "magnifier",
    "inspect": "magnifier",
    "warning": "warning-sign",
    "alert": "warning-sign",
    "danger": "warning-sign",
    "risk": "warning-sign",
    "error": "warning-sign",
}


def resolve_prop(name):
    if not name:
        return "gear-pair"
    key = str(name).strip().lower().replace("_", "-").replace(" ", "-")
    if key in PROP_LIBRARY:
        return key
    if key in ALIAS:
        return ALIAS[key]
    for alias_k, prop_k in ALIAS.items():
        if alias_k in key:
            return prop_k
    return "gear-pair"


# ---------------------------------------------------------------------------
# Composition, Camera, Lighting, Render
# ---------------------------------------------------------------------------

def _spawn_prop(prop_key, mats, rng, swap_colors=False):
    resolved = resolve_prop(prop_key)
    builder = PROP_LIBRARY[resolved]
    m1 = mats["secondary"] if swap_colors else mats["primary"]
    m2 = mats["primary"] if swap_colors else mats["secondary"]
    return builder(m1, m2, rng)


def apply_composition(hero_key, supporting_keys, composition, mats, rng):
    comp = str(composition or "hero-center").lower()
    sup_keys = [k for k in (supporting_keys or []) if k][:3]

    hero_obj = _spawn_prop(hero_key, mats, rng, swap_colors=False)
    target_loc = (0.0, 0.0, 0.0)

    if comp == "hero-left":
        hero_obj.location = (-0.62, 0.0, 0.0)
        hero_obj.scale = (1.02, 1.02, 1.02)
        hero_obj.rotation_euler.z += math.radians(16)
        slots = [
            ((0.92, 0.20, 0.42), 0.50, -18),
            ((0.98, -0.12, -0.42), 0.46, 14),
            ((0.46, 0.55, 0.84), 0.38, -8),
        ]
        for i, sk in enumerate(sup_keys):
            obj = _spawn_prop(sk, mats, rng, swap_colors=(i % 2 == 0))
            pos, sc, rz = slots[i]
            obj.location = pos
            obj.scale = (sc, sc, sc)
            obj.rotation_euler.z += math.radians(rz)
        target_loc = (0.05, 0.0, 0.0)

    elif comp == "orbit":
        hero_obj.location = (0.0, 0.0, 0.0)
        hero_obj.scale = (0.98, 0.98, 0.98)
        _add_torus("CompOrbitRing", major=1.48, minor=0.022,
                   rot=(math.radians(72), math.radians(-16), 0),
                   mat=mats["glow2"], parent=None)
        count = max(1, len(sup_keys))
        for i, sk in enumerate(sup_keys):
            ang = i * (2.0 * math.pi / count) + math.radians(30)
            r = 1.48
            obj = _spawn_prop(sk, mats, rng, swap_colors=(i % 2 == 0))
            obj.location = (math.cos(ang) * r, math.sin(ang) * r * 0.45, math.sin(ang) * 0.65)
            obj.scale = (0.44, 0.44, 0.44)
            obj.rotation_euler.z += ang

    elif comp == "stack":
        hero_obj.location = (0.0, 0.0, -0.36)
        hero_obj.scale = (0.96, 0.96, 0.96)
        z_cursor = 0.74
        for i, sk in enumerate(sup_keys):
            sc = max(0.36, 0.52 - i * 0.09)
            obj = _spawn_prop(sk, mats, rng, swap_colors=(i % 2 == 0))
            obj.location = (rng.uniform(-0.14, 0.14), rng.uniform(-0.10, 0.10), z_cursor)
            obj.scale = (sc, sc, sc)
            obj.rotation_euler.z += math.radians((-1) ** i * 18)
            z_cursor += sc * 1.45
        target_loc = (0.0, 0.0, 0.16)

    elif comp == "exploded":
        hero_obj.location = (0.0, 0.0, 0.0)
        hero_obj.scale = (0.92, 0.92, 0.92)
        hero_obj.rotation_euler.x += math.radians(-10)
        hero_obj.rotation_euler.y += math.radians(12)
        dirs = [
            (1.22, -0.35, 0.72),
            (-1.18, 0.25, 0.68),
            (0.88, 0.42, -0.82),
        ]
        for i, sk in enumerate(sup_keys):
            obj = _spawn_prop(sk, mats, rng, swap_colors=(i % 2 == 0))
            obj.location = dirs[i]
            obj.scale = (0.48, 0.48, 0.48)
            obj.rotation_euler.x += math.radians(rng.uniform(-22, 22))
            obj.rotation_euler.y += math.radians(rng.uniform(-22, 22))

    elif comp == "duo-versus":
        hero_obj.location = (-0.78, 0.0, 0.0)
        hero_obj.scale = (0.86, 0.86, 0.86)
        hero_obj.rotation_euler.z += math.radians(22)
        rival_key = sup_keys[0] if sup_keys else "shield-lock"
        rival = _spawn_prop(rival_key, mats, rng, swap_colors=True)
        rival.location = (0.78, 0.0, 0.0)
        rival.scale = (0.84, 0.84, 0.84)
        rival.rotation_euler.z += math.radians(-22)
        for i, sk in enumerate(sup_keys[1:]):
            obj = _spawn_prop(sk, mats, rng, swap_colors=(i % 2 == 1))
            obj.location = (0.0, 0.55, 0.88 - i * 1.65)
            obj.scale = (0.38, 0.38, 0.38)

    else:  # hero-center
        hero_obj.location = (0.0, 0.0, 0.0)
        hero_obj.scale = (1.10, 1.10, 1.10)
        slots = [
            ((-1.15, 0.36, -0.28), 0.46, 20),
            ((1.15, 0.32, 0.34), 0.46, -20),
            ((0.0, 0.62, 0.96), 0.38, 10),
        ]
        for i, sk in enumerate(sup_keys):
            obj = _spawn_prop(sk, mats, rng, swap_colors=(i % 2 == 0))
            pos, sc, rz = slots[i]
            obj.location = pos
            obj.scale = (sc, sc, sc)
            obj.rotation_euler.z += math.radians(rz)

    return hero_obj, target_loc


def setup_camera(cam_cfg, target_loc=(0.0, 0.0, 0.0)):
    angle = str(cam_cfg.get("angle") or "eye").lower()
    lens = float(cam_cfg.get("lens") or 50.0)
    lens = max(24.0, min(85.0, lens))
    orbit_deg = float(cam_cfg.get("orbitDeg") if cam_cfg.get("orbitDeg") is not None else 25.0)

    elev_map = {
        "low": -8.0,
        "eye": 14.0,
        "high": 36.0,
        "top": 66.0,
        "dutch": 15.0,
    }
    elev_deg = elev_map.get(angle, 14.0)
    roll_deg = 14.0 if angle == "dutch" else 0.0

    # Distance scales gently with focal length so ~2.5-unit cluster fills frame cleanly
    dist = 5.4 * (lens / 50.0)
    dist = max(3.6, min(8.6, dist))

    az = math.radians(orbit_deg)
    el = math.radians(elev_deg)
    cx = target_loc[0] + dist * math.cos(el) * math.sin(az)
    cy = target_loc[1] - dist * math.cos(el) * math.cos(az)
    cz = target_loc[2] + dist * math.sin(el)

    target = _new_empty("CamTarget", location=target_loc)

    rig = _new_empty("CamRig", location=(cx, cy, cz))
    track = rig.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    cam_data = bpy.data.cameras.new(name="SceneArtCamera")
    cam_data.lens = lens
    cam_data.clip_start = 0.05
    cam_data.clip_end = 100.0
    cam_obj = bpy.data.objects.new("SceneArtCamera", cam_data)
    _collection().objects.link(cam_obj)
    cam_obj.parent = rig
    cam_obj.location = (0.0, 0.0, 0.0)
    cam_obj.rotation_euler = (0.0, 0.0, math.radians(roll_deg))

    bpy.context.scene.camera = cam_obj
    return cam_obj


def _add_area_light(name, loc, target_loc, energy, color, size=2.4):
    ldata = bpy.data.lights.new(name=name, type="AREA")
    ldata.energy = energy
    ldata.color = color[:3]
    ldata.size = size
    lobj = bpy.data.objects.new(name=name, object_data=ldata)
    _collection().objects.link(lobj)
    lobj.location = loc
    direction = mathutils.Vector(target_loc) - mathutils.Vector(loc)
    lobj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return lobj


def setup_lighting(preset, palette, target_loc=(0.0, 0.0, 0.0)):
    preset = str(preset or "studio").lower()
    accent = hex_to_rgba(palette.get("accent"), (0.95, 0.55, 0.06, 1.0))
    accent2 = hex_to_rgba(palette.get("accent2"), (0.12, 0.68, 0.96, 1.0))

    world = bpy.data.worlds.new("SceneArtWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")

    if preset == "rim":
        if bg_node:
            bg_node.inputs[0].default_value = (0.03, 0.04, 0.06, 1.0)
            bg_node.inputs[1].default_value = 0.35
        _add_area_light("RimKey", (-3.8, 2.8, 2.4), target_loc, 480, accent, size=2.2)
        _add_area_light("RimBack", (3.8, 2.6, 1.8), target_loc, 420, accent2, size=2.2)
        _add_area_light("RimFill", (0.2, -4.4, 0.6), target_loc, 110, (0.92, 0.95, 1.0), size=3.4)

    elif preset == "neon":
        if bg_node:
            bg_node.inputs[0].default_value = (0.02, 0.02, 0.05, 1.0)
            bg_node.inputs[1].default_value = 0.25
        _add_area_light("NeonLeft", (-3.6, -1.8, 1.8), target_loc, 460, accent, size=2.4)
        _add_area_light("NeonRight", (3.6, -1.2, 2.0), target_loc, 460, accent2, size=2.4)
        _add_area_light("NeonTop", (0.0, 1.5, 4.2), target_loc, 240, (0.85, 0.90, 1.0), size=2.8)

    elif preset == "sunset":
        if bg_node:
            bg_node.inputs[0].default_value = (0.12, 0.06, 0.08, 1.0)
            bg_node.inputs[1].default_value = 0.45
        _add_area_light("SunKey", (-4.2, -2.4, 1.4), target_loc, 520, (1.0, 0.42, 0.14), size=2.6)
        _add_area_light("SunFill", (3.8, -1.6, 2.4), target_loc, 240, (0.58, 0.22, 0.88), size=3.2)
        _add_area_light("SunRim", (0.5, 3.8, 2.8), target_loc, 300, (1.0, 0.72, 0.35), size=2.4)

    elif preset == "noir":
        if bg_node:
            bg_node.inputs[0].default_value = (0.01, 0.01, 0.02, 1.0)
            bg_node.inputs[1].default_value = 0.15
        _add_area_light("NoirKey", (-3.4, -2.6, 3.6), target_loc, 560, (0.98, 0.98, 1.0), size=1.1)
        _add_area_light("NoirRim", (3.2, 3.0, 2.0), target_loc, 280, accent2, size=1.4)
        _add_area_light("NoirBounce", (1.6, -3.5, -1.2), target_loc, 45, (0.6, 0.65, 0.75), size=3.0)

    else:  # studio 3-point
        if bg_node:
            bg_node.inputs[0].default_value = (0.08, 0.10, 0.14, 1.0)
            bg_node.inputs[1].default_value = 0.60
        _add_area_light("StudioKey", (-3.6, -3.4, 3.4), target_loc, 420, (1.0, 0.96, 0.92), size=2.8)
        _add_area_light("StudioFill", (3.8, -2.6, 1.6), target_loc, 190, (0.78, 0.88, 1.0), size=3.4)
        _add_area_light("StudioRim", (0.6, 3.8, 2.8), target_loc, 320, accent, size=2.2)


def _configure_cycles_gpu(scene):
    scene.cycles.samples = 32
    try:
        scene.cycles.use_denoising = False
    except Exception:
        pass
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev_type in ("OPTIX", "CUDA", "HIP", "METAL"):
            try:
                prefs.compute_device_type = dev_type
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == dev_type]
                if gpus:
                    for d in prefs.devices:
                        d.use = (d.type == dev_type)
                    scene.cycles.device = "GPU"
                    return
            except Exception:
                continue
    except Exception:
        pass
    scene.cycles.device = "CPU"


def _can_use_eevee():
    if os.environ.get("SCENE_ART_FORCE_CYCLES") == "1":
        return False
    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
        egl_candidates = (
            "/usr/lib/x86_64-linux-gnu/libEGL.so.1",
            "/usr/lib/aarch64-linux-gnu/libEGL.so.1",
            "/usr/lib/libEGL.so.1",
            "/usr/lib64/libEGL.so.1",
        )
        if not any(os.path.exists(p) for p in egl_candidates):
            return False
    return True


def render_scene(preview_path):
    scene = bpy.context.scene
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = os.path.abspath(preview_path)

    parent_dir = os.path.dirname(scene.render.filepath)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)

    for vt in ("AgX", "Filmic", "Standard"):
        try:
            scene.view_settings.view_transform = vt
            break
        except Exception:
            continue

    engines = ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES") if _can_use_eevee() else ("CYCLES",)
    last_err = None
    for eng in engines:
        try:
            scene.render.engine = eng
            if eng == "CYCLES":
                _configure_cycles_gpu(scene)
            elif eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
                try:
                    scene.eevee.taa_render_samples = 32
                except Exception:
                    pass
            bpy.ops.render.render(write_still=True)
            if os.path.isfile(scene.render.filepath) and os.path.getsize(scene.render.filepath) > 0:
                print(f"[scene_art] rendered with {eng} -> {scene.render.filepath}", flush=True)
                return eng
        except Exception as exc:
            last_err = exc
            print(f"[scene_art] engine {eng} failed: {exc}", flush=True)
            continue

    raise RuntimeError(f"All render engines failed; last error: {last_err}")


def export_glb_safe(glb_path):
    if not glb_path:
        return
    try:
        abs_glb = os.path.abspath(glb_path)
        parent_dir = os.path.dirname(abs_glb)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=abs_glb, export_format="GLB")
        print(f"[scene_art] exported glb -> {abs_glb}", flush=True)
    except Exception as exc:
        print(f"[scene_art] glb export warning (non-fatal): {exc}", flush=True)


# ---------------------------------------------------------------------------
# CLI & Spec Loading
# ---------------------------------------------------------------------------

DEFAULT_SPEC = {
    "version": 1,
    "sceneId": "scene-01",
    "seed": 42,
    "palette": {
        "bg": "#0F172A",
        "accent": "#F59E0B",
        "accent2": "#38BDF8",
        "fg": "#F8FAFC",
    },
    "hero": "coin-stack",
    "supporting": [],
    "composition": "hero-center",
    "camera": {"angle": "eye", "lens": 50, "orbitDeg": 25},
    "lighting": "studio",
    "material": "clay",
    "motionHint": "float",
}


def parse_cli_args():
    argv = sys.argv
    if "--" in argv:
        extra = argv[argv.index("--") + 1:]
    else:
        extra = []
    opts = {"list_props": False, "spec_path": None, "out_path": None, "glb_path": None}
    i = 0
    while i < len(extra):
        arg = extra[i]
        if arg == "--list-props":
            opts["list_props"] = True
        elif arg == "--spec" and i + 1 < len(extra):
            i += 1
            opts["spec_path"] = extra[i]
        elif arg == "--out" and i + 1 < len(extra):
            i += 1
            opts["out_path"] = extra[i]
        elif arg == "--glb" and i + 1 < len(extra):
            i += 1
            opts["glb_path"] = extra[i]
        i += 1
    return opts


def load_spec(spec_path=None):
    raw = {}
    if SPEC_JSON is not None:
        if isinstance(SPEC_JSON, str):
            raw = json.loads(SPEC_JSON)
        elif isinstance(SPEC_JSON, dict):
            raw = SPEC_JSON
    elif spec_path:
        with open(spec_path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)

    spec = dict(DEFAULT_SPEC)
    if isinstance(raw, dict):
        spec.update(raw)
        pal = dict(DEFAULT_SPEC["palette"])
        if isinstance(raw.get("palette"), dict):
            pal.update(raw["palette"])
        spec["palette"] = pal

        cam = dict(DEFAULT_SPEC["camera"])
        if isinstance(raw.get("camera"), dict):
            cam.update(raw["camera"])
        spec["camera"] = cam

        sup = raw.get("supporting")
        spec["supporting"] = list(sup)[:3] if isinstance(sup, list) else []
    return spec


def main():
    global _ACTIVE_MATS
    opts = parse_cli_args()
    if opts["list_props"]:
        print(json.dumps(list(PROP_LIBRARY.keys())))
        return

    spec = load_spec(opts["spec_path"])
    preview_file = opts["out_path"] or os.environ.get("BLENDER_PREVIEW_FILE", "scene_art.png")
    glb_file = opts["glb_path"] or os.environ.get("BLENDER_OUTPUT_FILE", "scene_art.glb")
    blend_file = os.environ.get("BLENDER_SAVE_BLEND", "")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    live_progress(5, f"เตรียมฉาก {spec.get('sceneId', '')}")

    seed = int(spec.get("seed") or 42)
    rng = random.Random(seed)

    _ACTIVE_MATS = build_material_bundle(
        spec["palette"],
        preset=spec.get("material", "clay"),
        lighting=spec.get("lighting", "studio"),
    )
    live_progress(20, f"สร้างวัสดุ ({spec.get('material', 'clay')}) และพร็อพ {spec.get('hero', '')}")

    _, target_loc = apply_composition(
        spec.get("hero", "coin-stack"),
        spec.get("supporting", []),
        spec.get("composition", "hero-center"),
        _ACTIVE_MATS,
        rng,
    )
    live_progress(50, "จัดวางองค์ประกอบ 3D ครบแล้ว")
    live_snapshot("จัดวางพร็อพครบ")

    setup_camera(spec["camera"], target_loc=target_loc)
    setup_lighting(spec.get("lighting", "studio"), spec["palette"], target_loc=target_loc)
    live_progress(70, f"ตั้งกล้อง ({spec['camera'].get('angle')}) และแสง ({spec.get('lighting')})")

    live_progress(90, "กำลังเรนเดอร์ PNG โปร่งใส 1080x1080")
    render_scene(preview_file)

    export_glb_safe(glb_file)

    if blend_file:
        try:
            abs_blend = os.path.abspath(blend_file)
            os.makedirs(os.path.dirname(abs_blend), exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=abs_blend)
        except Exception as exc:
            print(f"[scene_art] save blend warning (non-fatal): {exc}", flush=True)

    live_progress(100, "เรนเดอร์ Scene Art เสร็จสมบูรณ์")
    live_snapshot("เสร็จสมบูรณ์")


if __name__ == "__main__":
    main()
