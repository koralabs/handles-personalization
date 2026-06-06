use aiken/collection/pairs
use cardano/assets.{PolicyId}

// DSH-301 — `$handle_policies` registry membership (decentralized policy validation).
//
// pz historically hardcodes the legacy handle policy `f0ff48bb`. DeMi handles mint under the DeMi
// policy `6c32db33`, so pz must validate a handle's policy against the on-chain `$handle_policies`
// admin registry (read by api.handle.me `/policies`) instead of a hardcoded id — otherwise DeMi
// handles can't be personalized/migrated/revoked/burned at all. This is the decentralized fix:
// "governed on-chain, not by a held key".
//
// The `$handle_policies` admin datum maps each VALID handle policy id to a 3-int minting window
// `(first_minting_slot, last_minting_slot, sunset_slot)`. Membership = the policy is listed (the
// window itself only gates minting sunset, which pz does not enforce). Mirrors the proven
// decentralized-minting `find_policy_window` decode.
//
// Confirmed on-chain shape (api.handle.me `/handles/handle_policies/datum`, GET /policies):
//   List[ Map( policy_id(bytes) -> [first_minting_slot, last_minting_slot, sunset_slot] ) ]
// i.e. a one-element Data list wrapping a Data map of 3-int lists (NOT CIP-68-wrapped, NOT a
// Constr). The registry handle itself is the legacy handle `handle_policies`; its CIP-68 ref (100)
// token carries this datum, attached to each pz tx as a reference input.

// Is `policy_id` listed in the `$handle_policies` registry datum? This replaces pz's hardcoded
// `policy == f0ff48bb` checks so any registry-listed policy (legacy AND DeMi) is accepted.
pub fn policy_is_registered(handle_policies: Data, policy_id: PolicyId) -> Bool {
  expect [policy_map]: List<Pairs<PolicyId, (Int, Int, Int)>> = handle_policies
  when pairs.get_first(policy_map, policy_id) is {
    Some(_) -> True
    None -> False
  }
}

// --- tests: decode + membership against the real on-chain datum shape ---

const legacy_policy: PolicyId =
  #"f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a"

const demi_policy: PolicyId =
  #"6c32db33a422e0bc2cb535bb850b5a6e9a9572222056d6ddc9cbc26e"

// One-element list wrapping a map of policy -> (first, last, sunset), matching the on-chain shape.
// Typed concretely; aiken upcasts it to `Data` at the `policy_is_registered` call site.
fn fixture_handle_policies() -> List<Pairs<PolicyId, (Int, Int, Int)>> {
  [[Pair(legacy_policy, (0, 0, 0)), Pair(demi_policy, (0, 0, 0))]]
}

test registered_policy_is_member() {
  policy_is_registered(fixture_handle_policies(), demi_policy)
}

test legacy_policy_still_a_member() {
  policy_is_registered(fixture_handle_policies(), legacy_policy)
}

test unlisted_policy_is_not_a_member() {
  !policy_is_registered(fixture_handle_policies(), #"deadbeef")
}
