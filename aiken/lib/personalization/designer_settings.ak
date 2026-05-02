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

const internal_bg_proof_key: ByteArray = "__bg_proof"

const internal_pfp_proof_key: ByteArray = "__pfp_proof"

fn list_contains(haystack: List<ByteArray>, needle: ByteArray) -> Bool {
  list.any(haystack, fn(x) { x == needle })
}

fn is_internal_designer_key(key: ByteArray) -> Bool {
  key == internal_bg_proof_key || key == internal_pfp_proof_key
}

fn public_designer_entries(designer: types.DataMap) -> types.DataMap {
  list.filter(designer, fn(p) { !is_internal_designer_key(p.1st) })
}

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
// Bitcoin base58 alphabet: 1-9 A-H J-N P-Z a-k m-z (skips 0, O, I, l).
// Used to decode the IPFS multihash CID. `bytearray.index_of` returns the
// position in the alphabet, which is the digit value (or -1 if not found).
const base58_alphabet: ByteArray =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

fn base58_to_int(s: ByteArray, idx: Int, len: Int, acc: Int) -> Int {
  if idx >= len {
    acc
  } else {
    let c = bytearray.at(s, idx)
    let digit =
      when bytearray.index_of(base58_alphabet, builtin.cons_bytearray(c, #"")) is {
        Some((pos, _)) -> pos
        None -> -1
      }
    base58_to_int(s, idx + 1, len, acc * 58 + digit)
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
  public_designer_entries(designer)
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

// One iteration of the `defaults.for_each` loop in Helios:342-404.
// designer_value is precomputed at the call site so we don't re-read
// `designer[key]` once per branch.
fn defaults_entry_valid(
  key: ByteArray,
  value: Data,
  designer_value: Option<Data>,
  designer: types.DataMap,
  forced: Bool,
) -> Bool {
  if list_contains(simple_props_plural, key) {
    let key_singular = bytearray.take(key, bytearray.length(key) - 1)
    prop_in_designer_array(
      Some(value),
      datum.map_get(designer, key_singular),
      forced,
    )
  } else if list_contains(simp_excl_props, key) {
    prop_equals_designer_default(Some(value), designer_value, True, forced)
  } else if list_contains(qr_props, key) {
    qr_prop_valid(Some(value), designer_value, forced)
  } else if list_contains(simp_equal_props, key) {
    prop_equals_designer_default(Some(value), designer_value, False, forced)
  } else if key == "font_shadow_size" {
    prop_equals_designer_default(Some(value), designer_value, False, forced) && font_shadow_size_in_bounds(
      designer_value,
    )
  } else if key == "pfp_zoom" {
    prop_equals_designer_default(Some(value), designer_value, False, forced) && pfp_zoom_in_bounds(
      designer_value,
    )
  } else if key == "pfp_offset" {
    prop_equals_designer_default(Some(value), designer_value, False, forced) && pfp_offset_in_bounds(
      designer_value,
      datum.map_get(designer, "pfp_zoom"),
    )
  } else {
    True
  }
}

// One iteration of the `designer.for_each` loop in Helios:406-442.
fn designer_entry_valid(
  key: ByteArray,
  value: Data,
  defaults: types.DataMap,
  forced: Bool,
) -> Bool {
  let plural_form = bytearray.concat(key, "s")
  if list_contains(simple_props_plural, plural_form) {
    prop_in_designer_array(
      datum.map_get(defaults, plural_form),
      Some(value),
      forced,
    )
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

// Helios structs in legacy personalization maps are list-encoded, not
// Plutus Constr records. The bg datum and redeemer both carry this field as
// `[x, y, blur]`.
fn font_shadow_size_in_bounds(designer_value_opt: Option<Data>) -> Bool {
  when designer_value_opt is {
    None -> True
    Some(d) -> {
      expect fields: List<Data> = d
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

// PfpOffset uses the same legacy list encoding: `[x, y]`. The bound is derived
// from the current pfp_zoom: offset_max = ((576 * (zoom - 100)) / 100) / 2.
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
      expect fields: List<Data> = d
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
        fn(p) {
          let key = p.1st
          defaults_entry_valid(
            key,
            p.2nd,
            datum.map_get(designer, key),
            designer,
            forced,
          )
        },
      ) && list.all(
        designer,
        fn(p) { designer_entry_valid(p.1st, p.2nd, defaults, forced) },
      ) && text_ribbon_colors_valid(defaults, designer, forced)
    }
  }
}

// ----- tests -----
//
// Coverage for the property-validation rules and helpers ported from
// pers.helios:342-454. Tests in this file can call private functions
// directly. End-to-end coverage of `designer_settings_are_valid` is
// exercised via the `persdsg` validator's tests in update.ak.

// base58_decode round-trip via known short vectors. b58_value maps:
// '1'..'9' → 0..8; 'A'..'H' → 9..16; 'J'..'N' → 17..21; 'P'..'Z' → 22..32;
// 'a'..'k' → 33..43; 'm'..'z' → 44..57.
test base58_decode_handles_single_digit_inputs() {
  and {
    base58_decode("2", 1) == #"01",
    base58_decode("9", 1) == #"08",
    base58_decode("A", 1) == #"09",
    base58_decode("z", 1) == #"39",
  }
}

test base58_decode_handles_multi_char_input() {
  // "21" = 1 * 58 + 0 = 58 = 0x3a
  // "zz" = 57 * 58 + 57 = 3363 = 0x0d23
  and {
    base58_decode("21", 1) == #"3a",
    base58_decode("zz", 2) == #"0d23",
  }
}

fn designer_hash(designer: types.DataMap) -> ByteArray {
  builtin.sha2_256(builtin.serialise_data(designer_to_plutus_map_data(designer)))
}

fn live_scope3_designer() -> types.DataMap {
  [
    Pair("pfp_border_color", builtin.b_data(#"12546294")),
    Pair("bg_border_color", builtin.b_data(#"f57f17ff")),
    Pair("bg_color", builtin.b_data(#"3f7ae0ff")),
    Pair("font_shadow_color", builtin.b_data(#"0a1fd3")),
    Pair("pfp_zoom", builtin.i_data(100)),
    Pair("pfp_offset", builtin.list_data([builtin.i_data(0), builtin.i_data(0)])),
    Pair("qr_inner_eye", builtin.b_data("square,#000000")),
    Pair("qr_outer_eye", builtin.b_data("square,#000000")),
    Pair("qr_dot", builtin.b_data("square,#000000")),
    Pair(
      "qr_link",
      builtin.b_data("https://handle.me/lgtbmn77?live-cip30=v3cut-11"),
    ),
    Pair(
      "socials",
      builtin.list_data([
        builtin.map_data([
          Pair(builtin.b_data("display"), builtin.b_data("v3cut-11-s1")),
          Pair(
            builtin.b_data("url"),
            builtin.b_data("https://handle.me/lgtbmn77?social=v3cut-11-s1"),
          ),
        ]),
        builtin.map_data([
          Pair(builtin.b_data("display"), builtin.b_data("v3cut-11-s2")),
          Pair(
            builtin.b_data("url"),
            builtin.b_data("https://handle.me/lgtbmn77?social=v3cut-11-s2"),
          ),
        ]),
      ]),
    ),
    Pair(
      "bg_image",
      builtin.b_data("ipfs://QmSkgqaCapgw99Y2oAZ72tj9iGRb89DzM7kJPetvsj7NND"),
    ),
    Pair(
      "pfp_image",
      builtin.b_data("ipfs://QmY3uZmaBrWiCAisREsKMwhJyaDXSUxk5PiC6hVoVLW1iP"),
    ),
    Pair(
      "bg_asset",
      builtin.b_data(
        #"8ed30c080aba8eb431dabb802ea8dda3a131b0f49c72d2766b25b1eb001bc28068616e646c65735f62675f626f61745f32",
      ),
    ),
    Pair(
      "pfp_asset",
      builtin.b_data(
        #"eb66d2159d51cec7bd469c0daef8a93e0d2066f55d3c1a9cf5bc039354657374203320446973636f536f6c6172697334363031",
      ),
    ),
    Pair(internal_bg_proof_key, builtin.i_data(0)),
    Pair(internal_pfp_proof_key, builtin.i_data(0)),
  ]
}

fn live_scope3_defaults() -> types.DataMap {
  [
    Pair("font", builtin.b_data("Tilt Prism,https://tinyurl.com/2an5pb5a")),
    Pair("price", builtin.i_data(50)),
    Pair("font_color", builtin.b_data(#"ff6130")),
    Pair("qr_dot", builtin.b_data("rounded,#ff6130")),
    Pair("qr_inner_eye", builtin.b_data("square,#f2f285")),
    Pair("qr_outer_eye", builtin.b_data("rounded,#f2f285")),
    Pair(
      "border_colors",
      builtin.list_data([builtin.b_data(#"12546294"), builtin.b_data(#"797986")]),
    ),
    Pair("pfp_border_colors", builtin.list_data([builtin.b_data(#"12546294")])),
    Pair(
      "font_shadow_colors",
      builtin.list_data([
        builtin.b_data(#"0a1fd3"),
        builtin.b_data(#"22d1af"),
        builtin.b_data(#"31bc23"),
      ]),
    ),
    Pair(
      "text_ribbon_colors",
      builtin.list_data([builtin.b_data(#"000000"), builtin.b_data(#"12546294")]),
    ),
    Pair("qr_bg_color", builtin.b_data(#"00000000")),
    Pair("text_ribbon_gradient", builtin.b_data("radial")),
  ]
}

test base58_decode_handles_live_designer_cid() {
  base58_decode("b2rhZg2N5RPi4bwe3E9NuNHvEkC1TKfaHrfmkFjXgiu7geMi", 36) == #"015512202d057483c37f13594c99a90272c24de6a55c3f371a6686dfea86f8e16950659d"
}

test designer_hash_matches_live_scope3_payload() {
  designer_hash(live_scope3_designer()) == #"6857dc623c524755e6bd90c4a9e376b570d6defe65cc0490e7c188209da03692"
}

test designer_settings_accepts_live_scope3_payload() {
  and {
    designer_hash(live_scope3_designer()) == #"6857dc623c524755e6bd90c4a9e376b570d6defe65cc0490e7c188209da03692",
    designer_settings_are_valid(
      live_scope3_designer(),
      live_scope3_defaults(),
      Some(builtin.b_data("ipfs://zb2rhdfbJG94ZPfN5q6pXaxVERCT5qgLyaHCL4cjCHJH2zJc9")),
    ),
  }
}

test designer_hash_ignores_internal_policy_proofs() {
  let public_designer =
    [Pair("bg_image", builtin.b_data("ipfs://public-bg"))]
  let with_internal_proofs =
    [
      Pair("bg_image", builtin.b_data("ipfs://public-bg")),
      Pair(internal_bg_proof_key, builtin.i_data(1)),
      Pair(internal_pfp_proof_key, builtin.i_data(2)),
    ]
  let with_public_change =
    [
      Pair("bg_image", builtin.b_data("ipfs://public-bg")),
      Pair("pfp_image", builtin.b_data("ipfs://public-pfp")),
    ]
  and {
    designer_hash(with_internal_proofs) == designer_hash(public_designer),
    designer_hash(with_public_change) != designer_hash(public_designer),
  }
}

// prop_in_designer_array — pers.helios:357 simple_props rule.
//   default == None || forced == false || (forced && has_val && default_arr.contains(prop))
test prop_in_designer_array_accepts_when_default_missing() {
  // No constraint → accept regardless of property/forced.
  and {
    prop_in_designer_array(None, None, True),
    prop_in_designer_array(None, Some(builtin.b_data("anything")), True),
    prop_in_designer_array(None, None, False),
  }
}

test prop_in_designer_array_accepts_when_not_forced() {
  // Constraint exists but force_creator_settings != 1 → accept.
  let allowed: Data = [#"aabbcc"]
  prop_in_designer_array(Some(allowed), Some(builtin.b_data(#"deadbeef")), False)
}

test prop_in_designer_array_enforces_when_forced() {
  let allowed: Data = [#"aabb", #"ccdd"]
  and {
    // Designer property in allowed list → accept.
    prop_in_designer_array(Some(allowed), Some(builtin.b_data(#"aabb")), True),
    prop_in_designer_array(Some(allowed), Some(builtin.b_data(#"ccdd")), True),
    // Designer property NOT in allowed list → reject.
    !prop_in_designer_array(Some(allowed), Some(builtin.b_data(#"deadbeef")), True),
    // Designer property missing → reject (forced + missing).
    !prop_in_designer_array(Some(allowed), None, True),
  }
}

// prop_equals_designer_default — pers.helios:382 simp_equal/simp_excl rule.
test prop_equals_designer_default_accepts_exact_match() {
  let red: Data = builtin.b_data(#"ff00")
  // Equality: default == property → accept regardless of exclusive/forced.
  and {
    prop_equals_designer_default(Some(red), Some(red), False, True),
    prop_equals_designer_default(Some(red), Some(red), True, True),
    prop_equals_designer_default(Some(red), Some(red), False, False),
  }
}

test prop_equals_designer_default_handles_exclusive() {
  // Function body:
  //   default == property
  //     || ((!forced || default == None) && (!exclusive || property == None))
  // The "exclusive bypass" (property missing) only fires when the loose
  // conditions are met (not forced OR no default).
  let default_val: Data = builtin.b_data(#"ff00")
  let other_val: Data = builtin.b_data(#"00ff")
  and {
    // exclusive=True, property missing, !forced → accept (loose conditions met).
    prop_equals_designer_default(Some(default_val), None, True, False),
    // exclusive=True, property missing, forced + default present → reject (no bypass).
    !prop_equals_designer_default(Some(default_val), None, True, True),
    // exclusive=True, property differs, forced → reject.
    !prop_equals_designer_default(Some(default_val), Some(other_val), True, True),
    // exclusive=False, property differs, !forced → accept (loose mode).
    prop_equals_designer_default(Some(default_val), Some(other_val), False, False),
    // exclusive=False, property differs, forced → reject.
    !prop_equals_designer_default(Some(default_val), Some(other_val), False, True),
  }
}

// qr_prop_valid — pers.helios:413-417 qr_props rule. Allows the system
// default (starts with "square,") even when forced.
test qr_prop_valid_accepts_designer_missing() {
  let default_val: Data = builtin.b_data(#"01")
  qr_prop_valid(Some(default_val), None, True)
}

test qr_prop_valid_accepts_square_prefix() {
  // Function body:
  //   default_opt == None && starts_square
  //   || forced && default_matches
  //   || !forced && (starts_square || default_matches)
  // The "square," bypass fires when EITHER (default missing) OR (!forced).
  // Forced + default present requires EXACT match (no square bypass).
  let designer_val: Data = builtin.b_data("square,whatever")
  let default_val: Data = builtin.b_data(#"01")
  and {
    // Forced + designer="square,..." + default missing → accept.
    qr_prop_valid(None, Some(designer_val), True),
    // !forced + designer="square,..." + default exists → accept.
    qr_prop_valid(Some(default_val), Some(designer_val), False),
    // Forced + designer="square,..." + default exists → REJECT (forced requires exact match).
    !qr_prop_valid(Some(default_val), Some(designer_val), True),
  }
}

test qr_prop_valid_enforces_match_when_forced() {
  let default_val: Data = builtin.b_data(#"01")
  let other_val: Data = builtin.b_data(#"02")
  and {
    // Forced + matching default → accept.
    qr_prop_valid(Some(default_val), Some(default_val), True),
    // Forced + non-matching, non-square → reject.
    !qr_prop_valid(Some(default_val), Some(other_val), True),
    // !forced + matching default → accept.
    qr_prop_valid(Some(default_val), Some(default_val), False),
    // !forced + non-matching, non-square → REJECT (loose mode still requires
    // square bypass OR default match).
    !qr_prop_valid(Some(default_val), Some(other_val), False),
  }
}

// font_shadow_size — pers.helios:392-401. x,y in [-20,20], blur in [0,20].
fn font_shadow_data(x: Int, y: Int, blur: Int) -> Data {
  builtin.list_data([builtin.i_data(x), builtin.i_data(y), builtin.i_data(blur)])
}

test font_shadow_size_in_bounds_accepts_extremes() {
  and {
    font_shadow_size_in_bounds(Some(font_shadow_data(0, 0, 0))),
    font_shadow_size_in_bounds(Some(font_shadow_data(20, 20, 20))),
    font_shadow_size_in_bounds(Some(font_shadow_data(-20, -20, 0))),
    // Designer missing the field → vacuously True.
    font_shadow_size_in_bounds(None),
  }
}

test font_shadow_size_in_bounds_rejects_out_of_range() {
  and {
    !font_shadow_size_in_bounds(Some(font_shadow_data(21, 0, 0))),
    !font_shadow_size_in_bounds(Some(font_shadow_data(0, -21, 0))),
    !font_shadow_size_in_bounds(Some(font_shadow_data(0, 0, -1))),
    !font_shadow_size_in_bounds(Some(font_shadow_data(0, 0, 21))),
  }
}

// pfp_zoom — pers.helios:382-385. 100..200 inclusive.
test pfp_zoom_in_bounds_matrix() {
  and {
    pfp_zoom_in_bounds(None),
    pfp_zoom_in_bounds(Some(builtin.i_data(100))),
    pfp_zoom_in_bounds(Some(builtin.i_data(150))),
    pfp_zoom_in_bounds(Some(builtin.i_data(200))),
    !pfp_zoom_in_bounds(Some(builtin.i_data(99))),
    !pfp_zoom_in_bounds(Some(builtin.i_data(201))),
  }
}

// pfp_offset — pers.helios:386-389. x,y bounds derived from current pfp_zoom:
//   offset_max = ((576 * (zoom - 100)) / 100) / 2
fn pfp_offset_data(x: Int, y: Int) -> Data {
  builtin.list_data([builtin.i_data(x), builtin.i_data(y)])
}

test pfp_offset_in_bounds_with_default_zoom() {
  // No zoom → default 100 → offset_max = 0 → only (0, 0) accepted.
  and {
    pfp_offset_in_bounds(Some(pfp_offset_data(0, 0)), None),
    !pfp_offset_in_bounds(Some(pfp_offset_data(1, 0)), None),
    !pfp_offset_in_bounds(Some(pfp_offset_data(0, 1)), None),
  }
}

test pfp_offset_in_bounds_with_max_zoom() {
  // zoom = 200 → offset_max = ((576 * 100) / 100) / 2 = 288.
  and {
    pfp_offset_in_bounds(Some(pfp_offset_data(288, 288)), Some(builtin.i_data(200))),
    pfp_offset_in_bounds(Some(pfp_offset_data(-288, -288)), Some(builtin.i_data(200))),
    !pfp_offset_in_bounds(Some(pfp_offset_data(289, 0)), Some(builtin.i_data(200))),
  }
}

// text_ribbon_colors_valid — pers.helios:444-452. Four-way disjunction:
//   creator None && designer ≤ 1 ribbon
//   || !forced && designer ≤ 1 ribbon
//   || gradient && colors match exactly
//   || !gradient && designer is single AND that single is in creator's palette
fn ribbon_pairs(
  text_ribbon_colors: Option<List<ByteArray>>,
  text_ribbon_gradient: Option<ByteArray>,
) -> types.DataMap {
  let with_colors =
    when text_ribbon_colors is {
      None -> []
      Some(colors) -> {
        let colors_data: Data = colors
        [Pair(#"746578745f726962626f6e5f636f6c6f7273", colors_data)]
      }
    }
  when text_ribbon_gradient is {
    None -> with_colors
    Some(g) -> {
      let g_data: Data = g
      list.push(with_colors, Pair(#"746578745f726962626f6e5f6772616469656e74", g_data))
    }
  }
}

test text_ribbon_colors_accepts_designer_missing() {
  // Both empty / not set → accepted.
  text_ribbon_colors_valid([], [], True)
}

test text_ribbon_colors_accepts_creator_palette_match_when_not_forced() {
  // Creator palette has [#"aa", #"bb", #"cc"], designer picks #"bb" — should
  // accept under !forced because designer count is 1 ≤ 1.
  let defaults =
    ribbon_pairs(Some([#"aa", #"bb", #"cc"]), Some("solid"))
  let designer = ribbon_pairs(Some([#"bb"]), None)
  text_ribbon_colors_valid(defaults, designer, False)
}

test text_ribbon_colors_enforces_palette_match_when_forced_single_color() {
  let defaults =
    ribbon_pairs(Some([#"aa", #"bb", #"cc"]), Some("solid"))
  // designer picks #"bb" — in creator palette → accept (single color match).
  let good = ribbon_pairs(Some([#"bb"]), None)
  // designer picks #"dd" — NOT in creator palette → reject.
  let bad = ribbon_pairs(Some([#"dd"]), None)
  and {
    text_ribbon_colors_valid(defaults, good, True),
    !text_ribbon_colors_valid(defaults, bad, True),
  }
}

test text_ribbon_colors_accepts_gradient_exact_match() {
  // gradient="radial" → designer's colors must exactly match creator's palette.
  let defaults = ribbon_pairs(Some([#"aa", #"bb"]), Some("radial"))
  let same = ribbon_pairs(Some([#"aa", #"bb"]), None)
  let different = ribbon_pairs(Some([#"aa", #"cc"]), None)
  and {
    text_ribbon_colors_valid(defaults, same, True),
    !text_ribbon_colors_valid(defaults, different, True),
  }
}
