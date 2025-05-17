/** PM2 Config file */

/**
 * @deployment Listing of Tokens
 * @description This config file allows to deploy UiPoolDataProvider contract at
 *              multiple networks and distributed in parallel processes.
 */

const commons = {
  script: "npx",
  args: "hardhat list-new-tokens",
  restart_delay: 100000000000,
  autorestart: false,
};

module.exports = {
  apps: [
    {
      name: "plume-new-tokens",
      env: {
        HARDHAT_NETWORK: "plume",
      },
      ...commons,
    },
  ],
};
