use aiken/merkle_patricia_forestry as mpf

test mpf_dependency_resolves() {
  let root = #"0000000000000000000000000000000000000000000000000000000000000000"

  mpf.from_root(root) == mpf.from_root(root)
}
