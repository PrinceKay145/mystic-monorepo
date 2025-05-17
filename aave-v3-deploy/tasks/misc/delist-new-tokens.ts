import { task } from "hardhat/config";

import {
  ConfigNames,
  deletePoolTokens,
  dropReservesByHelper,
  eNetwork,
  getReserveAddresses,
  IAaveConfiguration,
  loadPoolConfig,
  POOL_ADDRESSES_PROVIDER_ID,
  POOL_DATA_PROVIDER,
} from "../../helpers";
import { COMMON_DEPLOY_PARAMS, MARKET_NAME } from "../../helpers/env";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task(`drop-tokens`, `Drops Token`).setAction(async (_, hre) => {
  if (!hre.network.config.chainId) {
    throw new Error("INVALID_CHAIN_ID");
  }
  console.log(MARKET_NAME);
  console.log(hre.network.name);

  await dropReserve(hre);
});

const dropReserve = async (hre: HardhatRuntimeEnvironment) => {
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

  const { ReservesConfig, RateStrategies } = poolConfig;

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
  const reservesAddresses = await getReserveAddresses(poolConfig, network);

  console.log({ reservesAddresses });

  if (Object.keys(reservesAddresses).length == 0) {
    console.warn("[WARNING] Skipping initialization. Empty asset list.");
    return;
  }

  await dropReservesByHelper(ReservesConfig, reservesAddresses, deployer);
  hre.deployments.log(`[Deployment] Initialized all reserves`);

  // Save AToken and Debt tokens artifacts
  const dataProvider = await hre.deployments.get(POOL_DATA_PROVIDER);
  await deletePoolTokens(reservesAddresses, dataProvider.address);

  hre.deployments.log(`[Deployment] Dropped all reserves`);
  return true;
};
