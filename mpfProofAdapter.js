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

function normalizePrefix(prefix) {
  if (Buffer.isBuffer(prefix)) {
    return prefix;
  }
  if (typeof prefix === "string") {
    return Buffer.from(prefix);
  }
  throw new Error("prefix must be a utf8 string or Buffer");
}

function encodeCborUInt(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("flags must be non-negative integers");
  }
  if (value < 24) {
    return Buffer.from([value]);
  }
  if (value <= 0xff) {
    return Buffer.from([0x18, value]);
  }
  if (value <= 0xffff) {
    return Buffer.from([0x19, value >> 8, value & 0xff]);
  }
  if (value <= 0xffffffff) {
    return Buffer.from([
      0x1a,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  throw new Error("flags must fit in 32-bit unsigned integers");
}

export function policyIndexKey(policyId, prefix) {
  return Buffer.concat([normalizePolicyId(policyId), normalizePrefix(prefix)]);
}

export function encodePolicyFlags(flags) {
  return Buffer.concat([
    encodeCborUInt(flags.nsfw),
    encodeCborUInt(flags.trial),
    encodeCborUInt(flags.aux),
  ]);
}

export async function buildPolicyIndexTrie(entries) {
  const items = entries.map((entry) => ({
    key: policyIndexKey(entry.policyId, entry.prefix),
    value: encodePolicyFlags(entry.flags),
  }));

  return Trie.fromList(items);
}

export async function buildPolicyApprovalProof(trie, entry) {
  const key = policyIndexKey(entry.policyId, entry.prefix);
  const value = encodePolicyFlags(entry.flags);
  const proof = await trie.prove(key);
  const proofJson = proof.toJSON();
  const verifiedRoot = Proof.fromJSON(key, value, proofJson).verify();

  if (!verifiedRoot || !verifiedRoot.equals(trie.hash)) {
    throw new Error("generated proof does not verify against trie root");
  }

  return {
    policy_id: normalizePolicyId(entry.policyId),
    prefix: normalizePrefix(entry.prefix),
    flags: {
      nsfw: entry.flags.nsfw,
      trial: entry.flags.trial,
      aux: entry.flags.aux,
    },
    proof: proofJson,
    proof_cbor_hex: proof.toCBOR().toString("hex"),
  };
}

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

export async function buildPolicyApprovalRedeemer(trie, entry) {
  const proofPayload = await buildPolicyApprovalProof(trie, entry);

  return {
    policy_id: proofPayload.policy_id,
    prefix: proofPayload.prefix,
    flags: proofPayload.flags,
    proof: proofJsonToAikenProof(proofPayload.proof),
  };
}
