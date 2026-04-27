import { Proof, Trie } from "@aiken-lang/merkle-patricia-forestry";

const HEX_PREFIX = "#";

function hexToBuffer(value) {
  const normalized = value.startsWith(HEX_PREFIX) ? value.slice(1) : value;
  return Buffer.from(normalized, "hex");
}

function normalizePolicyId(policyId) {
  if (Buffer.isBuffer(policyId)) {
    return policyId;
  }
  if (typeof policyId === "string") {
    return hexToBuffer(policyId);
  }
  throw new Error("policyId must be a hex string or Buffer");
}

function normalizeAssetName(assetName) {
  if (Buffer.isBuffer(assetName)) {
    return assetName;
  }
  if (typeof assetName === "string") {
    // accept hex strings prefixed with #, otherwise treat as raw bytes
    return assetName.startsWith(HEX_PREFIX)
      ? hexToBuffer(assetName)
      : Buffer.from(assetName);
  }
  throw new Error("assetName must be a hex string or Buffer");
}

// Single-byte CBOR encoding for nsfw flag (0 or 1). Matches encode_nsfw in
// aiken/lib/personalization/policy_index_mpf.ak.
export function encodeNsfw(nsfw) {
  if (nsfw !== 0 && nsfw !== 1) {
    throw new Error("nsfw must be 0 or 1");
  }
  return Buffer.from([nsfw]);
}

export function policyKey(policyId) {
  return normalizePolicyId(policyId);
}

export function overrideKey(policyId, assetName) {
  return Buffer.concat([
    normalizePolicyId(policyId),
    normalizeAssetName(assetName),
  ]);
}

// Build the MPF trie for one category (bg or pfp).
//
// entries: array of
//   - { type: "policy", policyId, nsfw }
//   - { type: "override", policyId, assetName, nsfw }
export async function buildPolicyIndexTrie(entries) {
  const items = entries.map((entry) => {
    if (entry.type === "policy") {
      return {
        key: policyKey(entry.policyId),
        value: encodeNsfw(entry.nsfw),
      };
    }
    if (entry.type === "override") {
      return {
        key: overrideKey(entry.policyId, entry.assetName),
        value: encodeNsfw(entry.nsfw),
      };
    }
    throw new Error(`unknown entry type: ${entry.type}`);
  });

  return Trie.fromList(items);
}

// Convert MPF JSON proof steps into the Aiken-side `mpf.Proof` shape
// (Branch / Fork / Leaf constructors).
export function proofJsonToAikenProof(proofJson) {
  return proofJson.map((step) => {
    switch (step.type) {
      case "branch":
        return {
          Branch: {
            skip: step.skip,
            neighbors: Buffer.from(step.neighbors, "hex"),
          },
        };
      case "fork":
        return {
          Fork: {
            skip: step.skip,
            neighbor: {
              nibble: step.neighbor.nibble,
              prefix: Buffer.from(step.neighbor.prefix, "hex"),
              root: Buffer.from(step.neighbor.root, "hex"),
            },
          },
        };
      case "leaf":
        return {
          Leaf: {
            skip: step.skip,
            key: Buffer.from(step.neighbor.key, "hex"),
            value: Buffer.from(step.neighbor.value, "hex"),
          },
        };
      default:
        throw new Error(`unknown proof step type: ${step.type}`);
    }
  });
}

async function membershipProof(trie, key) {
  const proof = await trie.prove(key);
  return proofJsonToAikenProof(proof.toJSON());
}

async function nonMembershipProof(trie, key) {
  // MPF JS lib exposes `prove(key, allowMissing=true)` which yields a proof
  // whose Proof.fromJSON(key, undefined, steps).verify() reproduces the trie
  // root, exactly the witness the on-chain `mpf.miss(...)` accepts.
  const proof = await trie.prove(key, true);
  return proofJsonToAikenProof(proof.toJSON());
}

// Build the redeemer payload (Aiken-shaped PolicyApprovalProof) for one
// asset slot (bg or pfp).
//
// args:
//   trie:      built via buildPolicyIndexTrie
//   policyId:  hex string or Buffer (28 bytes)
//   policyNsfw: 0 or 1, the registered policy default
//   assetName: hex string (with #-prefix) or raw utf8 string or Buffer
//   override:  optional { nsfw: 0|1 } if a per-asset override exists
//
// returns: { policy_nsfw, policy_proof, override }
export async function buildPolicyApprovalRedeemer({
  trie,
  policyId,
  policyNsfw,
  assetName,
  override = null,
}) {
  const polKey = policyKey(policyId);
  const ovrKey = overrideKey(policyId, assetName);

  if (override === null) {
    return {
      policy_nsfw: policyNsfw,
      policy_proof: await membershipProof(trie, polKey),
      override: {
        NoOverride: {
          proof: await nonMembershipProof(trie, ovrKey),
        },
      },
    };
  }

  return {
    policy_nsfw: policyNsfw,
    // policy_proof is unused in the WithOverride branch on-chain, but the
    // redeemer type still requires it. Provide the real proof so the witness
    // remains verifiable off-chain end-to-end.
    policy_proof: await membershipProof(trie, polKey),
    override: {
      WithOverride: {
        nsfw: override.nsfw,
        proof: await membershipProof(trie, ovrKey),
      },
    },
  };
}
