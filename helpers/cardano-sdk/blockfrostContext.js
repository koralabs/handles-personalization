import { Cardano } from "./index.js";

const toNumber = (value, label) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  throw new Error(`Invalid Blockfrost ${label}: expected a finite number`);
};

const getBlockfrostHost = (network) => `https://cardano-${network}.blockfrost.io/api/v0`;

const fetchBlockfrostJson = async (path, apiKey, network, fetchFn) => {
  const url = `${getBlockfrostHost(network)}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetchFn(url, {
    headers: { "Content-Type": "application/json", project_id: apiKey },
  });
  if (!response.ok) {
    throw new Error(`Blockfrost ${path}: HTTP ${response.status}`);
  }
  return response.json();
};

const mapCostModels = (value) => {
  const costModels = new Map();
  if (!value) return costModels;
  const versionByName = {
    PlutusV1: Cardano.PlutusLanguageVersion.V1,
    PlutusV2: Cardano.PlutusLanguageVersion.V2,
    PlutusV3: Cardano.PlutusLanguageVersion.V3,
  };
  for (const [name, model] of Object.entries(value)) {
    const version = versionByName[name];
    if (version === undefined || !Array.isArray(model)) continue;
    costModels.set(version, model.map((cost, index) => toNumber(cost, `cost model ${name}[${index}]`)));
  }
  return costModels;
};

const mapBlockfrostProtocolParameters = (response) => ({
  coinsPerUtxoByte: toNumber(
    response.coins_per_utxo_size ?? response.coins_per_utxo_word ?? response.min_utxo ?? 0,
    "epoch_parameters.coins_per_utxo_size"
  ),
  maxTxSize: toNumber(response.max_tx_size, "epoch_parameters.max_tx_size"),
  maxBlockBodySize: toNumber(response.max_block_size, "epoch_parameters.max_block_size"),
  maxBlockHeaderSize: toNumber(response.max_block_header_size, "epoch_parameters.max_block_header_size"),
  stakeKeyDeposit: toNumber(response.key_deposit, "epoch_parameters.key_deposit"),
  poolDeposit: toNumber(response.pool_deposit, "epoch_parameters.pool_deposit"),
  poolRetirementEpochBound: toNumber(response.e_max, "epoch_parameters.e_max"),
  desiredNumberOfPools: toNumber(response.n_opt, "epoch_parameters.n_opt"),
  poolInfluence: String(response.a0),
  monetaryExpansion: String(response.rho),
  treasuryExpansion: String(response.tau),
  minPoolCost: toNumber(response.min_pool_cost, "epoch_parameters.min_pool_cost"),
  protocolVersion: {
    major: toNumber(response.protocol_major_ver, "epoch_parameters.protocol_major_ver"),
    minor: toNumber(response.protocol_minor_ver, "epoch_parameters.protocol_minor_ver"),
  },
  maxValueSize: toNumber(response.max_val_size, "epoch_parameters.max_val_size"),
  collateralPercentage: toNumber(response.collateral_percent, "epoch_parameters.collateral_percent"),
  maxCollateralInputs: toNumber(response.max_collateral_inputs, "epoch_parameters.max_collateral_inputs"),
  costModels: mapCostModels(response.cost_models_raw),
  prices: {
    memory: toNumber(response.price_mem, "epoch_parameters.price_mem"),
    steps: toNumber(response.price_step, "epoch_parameters.price_step"),
  },
  maxExecutionUnitsPerTransaction: {
    memory: toNumber(response.max_tx_ex_mem, "epoch_parameters.max_tx_ex_mem"),
    steps: toNumber(response.max_tx_ex_steps, "epoch_parameters.max_tx_ex_steps"),
  },
  maxExecutionUnitsPerBlock: {
    memory: toNumber(response.max_block_ex_mem, "epoch_parameters.max_block_ex_mem"),
    steps: toNumber(response.max_block_ex_steps, "epoch_parameters.max_block_ex_steps"),
  },
  minFeeCoefficient: toNumber(response.min_fee_a, "epoch_parameters.min_fee_a"),
  minFeeConstant: toNumber(response.min_fee_b, "epoch_parameters.min_fee_b"),
  minFeeRefScriptCostPerByte: String(response.min_fee_ref_script_cost_per_byte ?? 0),
});

export const getBlockfrostBuildContext = async (network, apiKey, { fetchFn = fetch } = {}) => {
  const [_latestBlock, _genesis, epochParameters] = await Promise.all([
    fetchBlockfrostJson("/blocks/latest", apiKey, network, fetchFn),
    fetchBlockfrostJson("/genesis", apiKey, network, fetchFn),
    fetchBlockfrostJson("/epochs/latest/parameters", apiKey, network, fetchFn),
  ]);
  return {
    protocolParameters: mapBlockfrostProtocolParameters(epochParameters),
    // Settings-update txs are built offline and signed manually — no expiry needed.
    validityInterval: {},
  };
};
