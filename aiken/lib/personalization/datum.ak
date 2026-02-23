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
    DatumHashRef(datum_hash) -> transaction.find_datum(tx.outputs, tx.datums, datum_hash)
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
// Full unwrapped Data-return semantics remain blocked and are restored in B-003.
pub fn has_value_unwrapped(data_opt: Option<Data>) -> Bool {
  when data_opt is {
    Some(_) -> True
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

test parse_asset_handles_empty_and_split_bytes() {
  let policy = #"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c"
  let asset_name = "bg_token"
  let bytes = bytearray.concat(policy, asset_name)

  and {
    parse_asset_bytes("") == empty_asset,
    parse_asset_bytes(bytes) == AssetClass { policy_id: policy, asset_name },
  }
}
