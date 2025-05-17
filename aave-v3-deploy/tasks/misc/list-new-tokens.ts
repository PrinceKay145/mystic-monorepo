import {
  deployContract,
  getContract,
  waitForTx,
} from "./../../helpers/utilities/tx";
import { task } from "hardhat/config";
import {
  chainlinkAggregatorProxy,
  chainlinkEthUsdAggregatorProxy,
  ZERO_ADDRESS,
} from "../../helpers/constants";
import {
  AaveOracle,
  AToken,
  ATOKEN_IMPL_ID,
  ConfigNames,
  configureReservesByHelper,
  DELEGATION_AWARE_ATOKEN_IMPL_ID,
  DelegationAwareAToken,
  eNetwork,
  ePlumeNetwork,
  getReserveAddresses,
  getTreasuryAddress,
  IAaveConfiguration,
  initReservesByHelper,
  loadPoolConfig,
  ORACLE_ID,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER,
  PoolAddressesProvider,
  savePoolTokens,
  STABLE_DEBT_TOKEN_IMPL_ID,
  StableDebtToken,
  VARIABLE_DEBT_TOKEN_IMPL_ID,
  VariableDebtToken,
} from "../../helpers";
import { COMMON_DEPLOY_PARAMS, MARKET_NAME } from "../../helpers/env";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task(`list-new-tokens`, `Lists new Token`).setAction(async (_, hre) => {
  if (!hre.network.config.chainId) {
    throw new Error("INVALID_CHAIN_ID");
  }
  console.log(MARKET_NAME);
  console.log(hre.network.name);

  await deployImpl(hre);
  await initReserve(hre);
  await addAssetOracle(hre);
});

const deployImpl = async (hre: HardhatRuntimeEnvironment) => {
  const { deploy } = hre.deployments;
  const { deployer } = await hre.getNamedAccounts();

  const { address: addressesProvider } = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  const addressesProviderInstance = (await getContract(
    "PoolAddressesProvider",
    addressesProvider
  )) as PoolAddressesProvider;

  const poolAddress = await addressesProviderInstance.getPool();

  const aTokenArtifact = await deploy(ATOKEN_IMPL_ID, {
    contract: "AToken",
    from: deployer,
    args: [poolAddress],
    ...COMMON_DEPLOY_PARAMS,
  });

  const aToken = (await hre.ethers.getContractAt(
    aTokenArtifact.abi,
    aTokenArtifact.address
  )) as AToken;
  try {
    await waitForTx(
      await aToken.initialize(
        poolAddress, // initializingPool
        ZERO_ADDRESS, // treasury
        ZERO_ADDRESS, // underlyingAsset
        ZERO_ADDRESS, // incentivesController
        0, // aTokenDecimals
        "ATOKEN_IMPL", // aTokenName
        "ATOKEN_IMPL", // aTokenSymbol
        "0x00" // params
      )
    );
  } catch {}

  const delegationAwareATokenArtifact = await deploy(
    DELEGATION_AWARE_ATOKEN_IMPL_ID,
    {
      contract: "DelegationAwareAToken",
      from: deployer,
      args: [poolAddress],
      ...COMMON_DEPLOY_PARAMS,
    }
  );

  const delegationAwareAToken = (await hre.ethers.getContractAt(
    delegationAwareATokenArtifact.abi,
    delegationAwareATokenArtifact.address
  )) as DelegationAwareAToken;
  try {
    await waitForTx(
      await delegationAwareAToken.initialize(
        poolAddress, // initializingPool
        ZERO_ADDRESS, // treasury
        ZERO_ADDRESS, // underlyingAsset
        ZERO_ADDRESS, // incentivesController
        0, // aTokenDecimals
        "DELEGATION_AWARE_ATOKEN_IMPL", // aTokenName
        "DELEGATION_AWARE_ATOKEN_IMPL", // aTokenSymbol
        "0x00" // params
      )
    );
  } catch {}

  const stableDebtTokenArtifact = await deploy(STABLE_DEBT_TOKEN_IMPL_ID, {
    contract: "StableDebtToken",
    from: deployer,
    args: [poolAddress],
    ...COMMON_DEPLOY_PARAMS,
  });

  const stableDebtToken = (await hre.ethers.getContractAt(
    stableDebtTokenArtifact.abi,
    stableDebtTokenArtifact.address
  )) as StableDebtToken;
  try {
    await waitForTx(
      await stableDebtToken.initialize(
        poolAddress, // initializingPool
        ZERO_ADDRESS, // underlyingAsset
        ZERO_ADDRESS, // incentivesController
        0, // debtTokenDecimals
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "STABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00" // params
      )
    );
  } catch {}

  const variableDebtTokenArtifact = await deploy(VARIABLE_DEBT_TOKEN_IMPL_ID, {
    contract: "VariableDebtToken",
    from: deployer,
    args: [poolAddress],
    ...COMMON_DEPLOY_PARAMS,
  });

  const variableDebtToken = (await hre.ethers.getContractAt(
    variableDebtTokenArtifact.abi,
    variableDebtTokenArtifact.address
  )) as VariableDebtToken;
  try {
    await waitForTx(
      await variableDebtToken.initialize(
        poolAddress, // initializingPool
        ZERO_ADDRESS, // underlyingAsset
        ZERO_ADDRESS, // incentivesController
        0, // debtTokenDecimals
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenName
        "VARIABLE_DEBT_TOKEN_IMPL", // debtTokenSymbol
        "0x00" // params
      )
    );
  } catch {}

  console.log("done");

  return true;
};

const initReserve = async (hre: HardhatRuntimeEnvironment) => {
  const network = (
    process.env.FORK ? process.env.FORK : hre.network.name
  ) as eNetwork;
  const { deployer } = await hre.getNamedAccounts();

  const poolConfig = (await loadPoolConfig(
    MARKET_NAME as ConfigNames
  )) as IAaveConfiguration;

  const addressProviderArtifact = await hre.deployments.get(
    POOL_ADDRESSES_PROVIDER_ID
  );

  const {
    ATokenNamePrefix,
    StableDebtTokenNamePrefix,
    VariableDebtTokenNamePrefix,
    SymbolPrefix,
    ReservesConfig,
    RateStrategies,
  } = poolConfig;

  // Deploy Rate Strategies
  for (const strategy in RateStrategies) {
    const strategyData = RateStrategies[strategy];
    const args = [
      addressProviderArtifact.address,
      strategyData.optimalUsageRatio,
      strategyData.baseVariableBorrowRate,
      strategyData.variableRateSlope1,
      strategyData.variableRateSlope2,
      strategyData.stableRateSlope1,
      strategyData.stableRateSlope2,
      strategyData.baseStableRateOffset,
      strategyData.stableRateExcessOffset,
      strategyData.optimalStableToTotalDebtRatio,
    ];
    await hre.deployments.deploy(`ReserveStrategy-${strategyData.name}`, {
      from: deployer,
      args: args,
      contract: "DefaultReserveInterestRateStrategy",
      log: true,
    });
  }

  // Deploy Reserves ATokens

  const treasuryAddress = await getTreasuryAddress(poolConfig, network);
  const incentivesController = await hre.deployments.get("IncentivesProxy");
  const reservesAddresses = await getReserveAddresses(poolConfig, network);

  if (Object.keys(reservesAddresses).length == 0) {
    console.warn("[WARNING] Skipping initialization. Empty asset list.");
    return;
  }

  await initReservesByHelper(
    ReservesConfig,
    reservesAddresses,
    ATokenNamePrefix,
    StableDebtTokenNamePrefix,
    VariableDebtTokenNamePrefix,
    SymbolPrefix,
    deployer,
    treasuryAddress,
    incentivesController.address
  );
  hre.deployments.log(`[Deployment] Initialized all reserves`);

  await configureReservesByHelper(ReservesConfig, reservesAddresses);

  // Save AToken and Debt tokens artifacts
  const dataProvider = await hre.deployments.get(POOL_DATA_PROVIDER);
  await savePoolTokens(reservesAddresses, dataProvider.address);

  hre.deployments.log(`[Deployment] Configured all reserves`);
  return true;
};

const addAssetOracle = async (hre: HardhatRuntimeEnvironment) => {
  const network = (
    process.env.FORK ? process.env.FORK : hre.network.name
  ) as eNetwork;
  const { deployer } = await hre.getNamedAccounts();

  const poolConfig = (await loadPoolConfig(
    MARKET_NAME as ConfigNames
  )) as IAaveConfiguration;

  const oracleArtifact = await hre.deployments.get(ORACLE_ID);
  const oracle = (await hre.ethers.getContractAt(
    oracleArtifact.abi,
    oracleArtifact.address
  )) as AaveOracle;

  const { ReserveAssets, ChainlinkAggregator } = poolConfig;
  const assets = [];
  const oracles = [];

  // set oracle sources
  for (const asset in ReserveAssets?.[network]) {
    const assetAddress = ReserveAssets?.[network][asset];
    const oracleAddress = ChainlinkAggregator?.[network]?.[asset] as string;
    console.log(asset, assetAddress, oracleAddress, oracleArtifact.address);
    assets.push(assetAddress);
    oracles.push(oracleAddress);
  }
  // oracle.setAssetSources(assets, oracles);
  console.log(deployer);

  await waitForTx(await oracle.setAssetSources(assets, oracles));

  hre.deployments.log(`Updated all reserves oracle`);
  return true;
};
