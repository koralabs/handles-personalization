// Faithful Aiken port of `designer_settings_are_valid` from pers.helios:342-454.
//
// Validates that the redeemer's `designer` property map matches the bg_datum
// `defaults` constraints (the creator-supplied design rules carried in the
// bg's CIP-68 `extra` map), and that the on-chain `designer` IPFS hash
// matches sha2_256 of the redeemer designer payload.
//
// Property categories (per Helios):
//   * simple_props (5)      — `bg_border_colors`, `bg_colors`, `circuit_colors`,
//                             `pfp_border_colors`, `font_shadow_colors`.
//                             defaults["Xs"] is a list of allowed values; the
//                             designer's matching singular `X` (without the
//                             trailing 's') must be one of them when
//                             force_creator_settings == 1.
//   * simp_equal_props (2)  — `qr_bg_color`, `socials_color`. designer must
//                             equal the default exactly.
//   * simp_excl_props (4)   — `text_ribbon_gradient`, `font_color`, `font`,
//                             `qr_image`. Exclusive: designer must equal the
//                             default OR designer must not have the key at all.
//   * qr_props (3)          — `qr_inner_eye`, `qr_outer_eye`, `qr_dot`.
//                             designer matches default OR (when not forced)
//                             starts with "square," (the system default
//                             style).
//   * font_shadow_size      — designer matches default; bounds-check x,y in
//                             [-20,20] and blur in [0,20].
//   * pfp_zoom              — designer matches default; bounds-check 100..200.
//   * pfp_offset            — designer matches default; bounds-check x,y based
//                             on the current pfp_zoom.
//   * text_ribbon_colors    — gradient / single-color rule (lines 444-452).

use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use personalization/datum
use personalization/types

const simple_props_plural: List<ByteArray> =
  [
    "bg_border_colors", "bg_colors", "circuit_colors", "pfp_border_colors",
    "font_shadow_colors",
  ]

const simp_equal_props: List<ByteArray> =
  ["qr_bg_color", "socials_color"]

const simp_excl_props: List<ByteArray> =
  ["text_ribbon_gradient", "font_color", "font", "qr_image"]

const qr_props: List<ByteArray> = ["qr_inner_eye", "qr_outer_eye", "qr_dot"]

const square_prefix: ByteArray = "square,"

// Faithful port of helios `prop_in_designer_array`:
//   default == None || forced == false || (forced && has_val && default_arr.any(== prop))
fn prop_in_designer_array(
  default: Option<Data>,
  property: Option<Data>,
  forced: Bool,
) -> Bool {
  when default is {
    None -> True
    Some(d) ->
      !forced || when property is {
        None -> False
        Some(p) -> {
          expect default_arr: List<ByteArray> = d
          expect prop_bytes: ByteArray = p
          list.any(default_arr, fn(v) { v == prop_bytes })
        }
      }
  }
}

// Faithful port of helios `prop_equals_designer_default`:
//   default == property
//     || ((forced == false || default == None) && (exclusive == false || has_val == False))
fn prop_equals_designer_default(
  default: Option<Data>,
  property: Option<Data>,
  exclusive: Bool,
  forced: Bool,
) -> Bool {
  default == property || (
    ( !forced || default == None ) && ( !exclusive || property == None )
  )
}

// Decode a base58 (Bitcoin alphabet) ASCII byte string into the represented
// big integer. The Bitcoin alphabet skips '0', 'O', 'I', 'l'; for the
// `ipfs://z<cid>` strings we decode here, leading zero bytes are encoded as
// leading '1' chars, but our caller (multihash for sha2-256) always starts
// with 0x12 so we don't special-case leading zeros.
fn b58_value(c: Int) -> Int {
  if c >= 0x31 && c <= 0x39 {
    c - 0x31
  } else if c >= 0x41 && c <= 0x48 {
    c - 0x41 + 9
  } else if c >= 0x4a && c <= 0x4e {
    c - 0x4a + 17
  } else if c >= 0x50 && c <= 0x5a {
    c - 0x50 + 22
  } else if c >= 0x61 && c <= 0x6b {
    c - 0x61 + 33
  } else if c >= 0x6d && c <= 0x7a {
    c - 0x6d + 44
  } else {
    -1
  }
}

fn base58_to_int(s: ByteArray, idx: Int, len: Int, acc: Int) -> Int {
  if idx >= len {
    acc
  } else {
    base58_to_int(s, idx + 1, len, acc * 58 + b58_value(bytearray.at(s, idx)))
  }
}

// Decode a base58btc (CIDv1) string (without the leading "ipfs://z" prefix)
// into raw bytes. `expected_size` is the byte length the decoded integer
// should occupy in big-endian (typically 36 = 4-byte multihash header +
// 32-byte sha2-256 digest).
pub fn base58_decode(s: ByteArray, expected_size: Int) -> ByteArray {
  let n = base58_to_int(s, 0, bytearray.length(s), 0)
  bytearray.from_int_big_endian(n, expected_size)
}

// Designer redeemer map → Plutus Map-Data wrapping. types.DataMap is
// `Pairs<ByteArray, Data>` (a CBOR list-of-pairs), but the bg defaults
// expect Helios's `Map[String]Data` shape (a CBOR Map). Re-wrap each entry
// so `serialise_data` produces byte-equivalent output to Helios's
// `designer.serialize()`.
fn designer_to_plutus_map_data(designer: types.DataMap) -> Data {
  designer
    |> list.map(fn(p) { Pair(builtin.b_data(p.1st), p.2nd) })
    |> builtin.map_data
}

// IPFS multihash check: strip "ipfs://z" (8 chars) → base58 → strip 4-byte
// CIDv1 multihash header (0x01 0x70 0x12 0x20) → compare to sha2_256 of the
// redeemer designer's CBOR. Helios uses `Int::from_base58` plus
// `to_big_endian`; we implement the same semantics inline.
fn multihash_matches(
  designer_redeemer: types.DataMap,
  designer_hash_data: Data,
) -> Bool {
  expect ipfs_uri: ByteArray = designer_hash_data
  let b58 = bytearray.drop(ipfs_uri, 8)
  let decoded = base58_decode(b58, 36)
  let multihash = bytearray.drop(decoded, 4)
  let designer_sha =
    builtin.sha2_256(builtin.serialise_data(designer_to_plutus_map_data(
      designer_redeemer,
    )))
  multihash == designer_sha
}

// In the Helios source, `forced` is sourced from defaults.get_safe(
// "force_creator_settings"); 1 → forced, anything else → not forced.
fn forced_from_defaults(defaults: types.DataMap) -> Bool {
  when datum.map_get(defaults, "force_creator_settings") is {
    None -> False
    Some(d) -> {
      expect i: Int = d
      i != 0
    }
  }
}

fn list_contains(haystack: List<ByteArray>, needle: ByteArray) -> Bool {
  list.any(haystack, fn(x) { x == needle })
}

// One iteration of the `defaults.for_each` loop in Helios:342-404. Each
// default key drives a per-category check against the matching designer
// entry. Returns True when the entry conforms.
fn defaults_entry_valid(
  pair: Pair<ByteArray, Data>,
  designer: types.DataMap,
  forced: Bool,
) -> Bool {
  let key = pair.1st
  let value = pair.2nd
  if list_contains(simple_props_plural, key) {
    // simple_props plural form → check designer at the singular form.
    let key_singular = bytearray.take(key, bytearray.length(key) - 1)
    prop_in_designer_array(
      Some(value),
      datum.map_get(designer, key_singular),
      forced,
    )
  } else if list_contains(simp_excl_props, key) {
    prop_equals_designer_default(
      Some(value),
      datum.map_get(designer, key),
      True,
      forced,
    )
  } else if list_contains(qr_props, key) {
    qr_prop_valid(Some(value), datum.map_get(designer, key), forced)
  } else if list_contains(simp_equal_props, key) {
    prop_equals_designer_default(
      Some(value),
      datum.map_get(designer, key),
      False,
      forced,
    )
  } else if key == "font_shadow_size" {
    prop_equals_designer_default(
      Some(value),
      datum.map_get(designer, key),
      False,
      forced,
    ) && font_shadow_size_in_bounds(datum.map_get(designer, key))
  } else if key == "pfp_zoom" {
    prop_equals_designer_default(
      Some(value),
      datum.map_get(designer, key),
      False,
      forced,
    ) && pfp_zoom_in_bounds(datum.map_get(designer, key))
  } else if key == "pfp_offset" {
    prop_equals_designer_default(
      Some(value),
      datum.map_get(designer, key),
      False,
      forced,
    ) && pfp_offset_in_bounds(
      datum.map_get(designer, key),
      datum.map_get(designer, "pfp_zoom"),
    )
  } else {
    True
  }
}

// One iteration of the `designer.for_each` loop in Helios:406-442. Each
// designer key validates against the matching default (when one exists).
fn designer_entry_valid(
  pair: Pair<ByteArray, Data>,
  defaults: types.DataMap,
  forced: Bool,
) -> Bool {
  let key = pair.1st
  let value = pair.2nd
  let plural_form = bytearray.concat(key, "s")
  if list_contains(simple_props_plural, plural_form) {
    prop_in_designer_array(datum.map_get(defaults, plural_form), Some(value), forced)
  } else if list_contains(simp_excl_props, key) {
    prop_equals_designer_default(
      datum.map_get(defaults, key),
      Some(value),
      True,
      forced,
    )
  } else if list_contains(qr_props, key) {
    qr_prop_valid(datum.map_get(defaults, key), Some(value), forced)
  } else if list_contains(simp_equal_props, key) {
    prop_equals_designer_default(
      datum.map_get(defaults, key),
      Some(value),
      False,
      forced,
    )
  } else {
    True
  }
}

// Helios's qr_props branch (Helios:413-417 and 367-370):
//   def_val == None && val_des.starts_with("square,")
//   || forced && val_def == val_des
//   || !forced && (val_des.starts_with("square,") || val_def == val_des)
fn qr_prop_valid(
  default_opt: Option<Data>,
  designer_opt: Option<Data>,
  forced: Bool,
) -> Bool {
  when designer_opt is {
    None -> True
    Some(des_data) -> {
      expect des_bytes: ByteArray = des_data
      let starts_square = bytearray.starts_with(des_bytes, square_prefix)
      let default_matches =
        when default_opt is {
          None -> False
          Some(def_data) ->
            builtin.choose_data(
              def_data,
              False,
              False,
              False,
              False,
              {
                expect def_bytes: ByteArray = def_data
                def_bytes == des_bytes
              },
            )
        }
      default_opt == None && starts_square || forced && default_matches || !forced && (
        starts_square || default_matches
      )
    }
  }
}

// FontShadowSize is `Constr 0 [x: Int, y: Int, blur: Int]` per Helios.
fn font_shadow_size_in_bounds(designer_value_opt: Option<Data>) -> Bool {
  when designer_value_opt is {
    None -> True
    Some(d) -> {
      let Pair(_, fields) = builtin.un_constr_data(d)
      when fields is {
        [x_data, y_data, blur_data] -> {
          expect x: Int = x_data
          expect y: Int = y_data
          expect blur: Int = blur_data
          x >= -20 && x <= 20 && y >= -20 && y <= 20 && blur >= 0 && blur <= 20
        }
        _ -> False
      }
    }
  }
}

fn pfp_zoom_in_bounds(designer_value_opt: Option<Data>) -> Bool {
  when designer_value_opt is {
    None -> True
    Some(d) -> {
      expect zoom: Int = d
      zoom >= 100 && zoom <= 200
    }
  }
}

// PfpOffset is `Constr 0 [x: Int, y: Int]` per Helios. The bound is
// derived from the current pfp_zoom: offset_max = ((576 * (zoom - 100)) / 100) / 2.
// When pfp_zoom is absent, default zoom is 100 (offset_max = 0).
fn pfp_offset_in_bounds(
  designer_value_opt: Option<Data>,
  pfp_zoom_opt: Option<Data>,
) -> Bool {
  when designer_value_opt is {
    None -> True
    Some(d) -> {
      let zoom =
        when pfp_zoom_opt is {
          None -> 100
          Some(z) -> {
            expect i: Int = z
            i
          }
        }
      let offset_max = 576 * ( zoom - 100 ) / 100 / 2
      let Pair(_, fields) = builtin.un_constr_data(d)
      when fields is {
        [x_data, y_data] -> {
          expect x: Int = x_data
          expect y: Int = y_data
          x >= -offset_max && x <= offset_max && y >= -offset_max && y <= offset_max
        }
        _ -> False
      }
    }
  }
}

// Helios:444-452 — the `text_ribbon_colors` rule. text_ribbon_gradient
// values "radial" or anything starting with "linear" mean the colors must
// match exactly. Otherwise (single ribbon color), the designer's chosen
// color must be one of the creator's allowed palette (or single, if
// undeclared / not forced).
fn text_ribbon_colors_valid(
  defaults: types.DataMap,
  designer: types.DataMap,
  forced: Bool,
) -> Bool {
  let creator_default_opt = datum.map_get(defaults, "text_ribbon_colors")
  let creator_colors =
    when creator_default_opt is {
      None -> []
      Some(d) -> {
        expect arr: List<ByteArray> = d
        arr
      }
    }
  let designer_colors =
    when datum.map_get(designer, "text_ribbon_colors") is {
      None -> []
      Some(d) -> {
        expect arr: List<ByteArray> = d
        arr
      }
    }
  let designer_len = list.length(designer_colors)
  let gradient =
    when datum.map_get(defaults, "text_ribbon_gradient") is {
      None -> False
      Some(gradient_data) ->
        builtin.choose_data(
          gradient_data,
          False,
          False,
          False,
          False,
          {
            expect gb: ByteArray = gradient_data
            gb == "radial" || bytearray.starts_with(gb, "linear")
          },
        )
    }
  // Flatten Helios's 4-way disjunction:
  //   (creator None && designer ≤ 1 ribbon)
  //   || (!forced && designer ≤ 1 ribbon)
  //   || (gradient && colors match exactly)
  //   || (!gradient && designer is single AND that single color is one of creator's)
  creator_default_opt == None && designer_len <= 1 || !forced && designer_len <= 1 || gradient && creator_colors == designer_colors || !gradient && designer_len == 1 && designer_single_in_creator(
    designer_colors,
    creator_colors,
  )
}

fn designer_single_in_creator(
  designer_colors: List<ByteArray>,
  creator_colors: List<ByteArray>,
) -> Bool {
  when designer_colors is {
    [single] -> list.any(creator_colors, fn(c) { c == single })
    _ -> False
  }
}

// Top-level entry point. Faithful to Helios's `designer_settings_are_valid`.
//   - designer: redeemer.designer (Pairs<ByteArray, Data>)
//   - defaults: bg_datum.extra map (Pairs<ByteArray, Data>)
//   - designer_hash_opt: new_extra.get_safe("designer") — the IPFS multihash
//                       URI that should match sha2_256 of designer.
pub fn designer_settings_are_valid(
  designer: types.DataMap,
  defaults: types.DataMap,
  designer_hash_opt: Option<Data>,
) -> Bool {
  when designer_hash_opt is {
    None -> False
    Some(hash_data) -> {
      let forced = forced_from_defaults(defaults)
      multihash_matches(designer, hash_data) && list.all(
        defaults,
        fn(p) { defaults_entry_valid(p, designer, forced) },
      ) && list.all(
        designer,
        fn(p) { designer_entry_valid(p, defaults, forced) },
      ) && text_ribbon_colors_valid(defaults, designer, forced)
    }
  }
}
