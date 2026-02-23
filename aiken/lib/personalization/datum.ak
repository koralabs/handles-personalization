use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/transaction
use personalization/types

pub type AssetClass {
  AssetClass { policy_id: ByteArray, asset_name: ByteArray }
}

pub const empty_data: Data = ""

pub const empty_asset: AssetClass = AssetClass { policy_id: "", asset_name: "" }

pub fn get_extra(extra: Data) -> types.DataMap {
  builtin.choose_data(
    extra,
    {
      let Pair(_, fields) = builtin.un_constr_data(extra)
      when fields is {
        [] -> []
        [first, ..] ->
          builtin.choose_data(
            first,
            [],
            first
              |> builtin.un_map_data
              |> list.map(
                  fn(entry) { Pair(builtin.un_b_data(entry.1st), entry.2nd) },
                ),
            [],
            [],
            [],
          )
      }
    },
    extra
      |> builtin.un_map_data
      |> list.map(fn(entry) { Pair(builtin.un_b_data(entry.1st), entry.2nd) }),
    [],
    [],
    [],
  )
}

pub type OutputDatum {
  DatumHashRef(ByteArray)
  InlineDatumRef(Data)
  NoDatumRef
}

pub fn get_datum_opt(
  output_datum: transaction.Datum,
  tx: transaction.Transaction,
) -> Option<Data> {
  when from_transaction_datum(output_datum) is {
    DatumHashRef(datum_hash) ->
      transaction.find_datum(tx.outputs, tx.datums, datum_hash)
    InlineDatumRef(inline_data) -> Some(inline_data)
    NoDatumRef -> None
  }
}

pub fn map_get(map: types.DataMap, key: ByteArray) -> Option<Data> {
  when list.find(map, fn(entry) { entry.1st == key }) is {
    Some(entry) -> Some(entry.2nd)
    None -> None
  }
}

pub fn int_or(data_opt: Option<Data>, fallback: Int) -> Int {
  when data_opt is {
    Some(data) -> {
      expect int_data: Int = data
      int_data
    }
    None -> fallback
  }
}

// Compiler-safe fallback for v1.1.21: presence check only.
// Uses serialized-data prefix checks to avoid compiler crash patterns around
// direct `Data` deconstruction from `Option<Data>`.
pub fn has_value_unwrapped(data_opt: Option<Data>) -> Bool {
  when data_opt is {
    Some(data) -> {
      let serialized = builtin.serialise_data(data)
      let prefix = bytearray.take(serialized, 1)
      let is_int = builtin.less_than_bytearray(prefix, #"40")
      let is_bytes = !is_int && builtin.less_than_bytearray(prefix, #"60")

      is_int || is_bytes && serialized != #"40"
    }
    None -> False
  }
}

pub fn from_transaction_datum(output_datum: transaction.Datum) -> OutputDatum {
  when output_datum is {
    transaction.DatumHash(datum_hash) -> DatumHashRef(datum_hash)
    transaction.InlineDatum(inline_data) -> InlineDatumRef(inline_data)
    transaction.NoDatum -> NoDatumRef
  }
}

pub fn parse_asset_bytes(asset_bytes: ByteArray) -> AssetClass {
  if asset_bytes == "" {
    empty_asset
  } else {
    let policy_id = bytearray.take(asset_bytes, 28)
    let asset_name = bytearray.drop(asset_bytes, 28)

    AssetClass { policy_id, asset_name }
  }
}

test empty_asset_is_zero() {
  empty_asset == AssetClass { policy_id: "", asset_name: "" }
}

test get_extra_defaults_to_empty_map() {
  get_extra("anything") == []
}

test get_extra_ignores_non_map_shapes() {
  and {
    get_extra(42) == [],
    get_extra([1, 2]) == [],
    get_extra((1, [42])) == [],
  }
}

test from_transaction_datum_maps_variants() {
  and {
    from_transaction_datum(transaction.NoDatum) == NoDatumRef,
    from_transaction_datum(transaction.InlineDatum("inline")) == InlineDatumRef(
      "inline",
    ),
    from_transaction_datum(
      transaction.DatumHash(
        #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ) == DatumHashRef(
      #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ),
  }
}

test get_datum_opt_inline_is_present() {
  has_value_unwrapped(
    get_datum_opt(transaction.InlineDatum(1), transaction.placeholder),
  )
}

test get_datum_opt_hash_without_witness_is_absent() {
  !has_value_unwrapped(
    get_datum_opt(
      transaction.DatumHash(
        #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
      transaction.placeholder,
    ),
  )
}

test map_get_missing_key_is_absent() {
  !has_value_unwrapped(map_get([], "missing"))
}

test int_or_uses_fallback_when_absent() {
  int_or(map_get([], "k"), 7) == 7
}

test has_value_unwrapped_rejects_empty_inline_bytes() {
  !has_value_unwrapped(
    get_datum_opt(transaction.InlineDatum(""), transaction.placeholder),
  )
}

test has_value_unwrapped_accepts_non_empty_inline_bytes() {
  has_value_unwrapped(
    get_datum_opt(transaction.InlineDatum("bg"), transaction.placeholder),
  )
}

test has_value_unwrapped_rejects_inline_list() {
  !has_value_unwrapped(
    get_datum_opt(transaction.InlineDatum([1]), transaction.placeholder),
  )
}

test parse_asset_handles_empty_and_split_bytes() {
  let policy = #"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"
  let asset_name = "bg_token"
  let bytes = bytearray.concat(policy, asset_name)

  and {
    parse_asset_bytes("") == empty_asset,
    parse_asset_bytes(bytes) == AssetClass { policy_id: policy, asset_name },
  }
}
