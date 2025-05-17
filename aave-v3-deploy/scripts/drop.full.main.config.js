/** PM2 Config file */

/**
 * @deployment Dropping of Tokens
 * @description This config file allows to deploy UiPoolDataProvider contract at
 *              multiple networks and distributed in parallel processes.
 */

const commons = {
  script: "npx",
  args: "hardhat drop-tokens",
  restart_delay: 100000000000,
  autorestart: false,
};

module.exports = {
  apps: [
    {
      name: "plume-drop-tokens",
      env: {
        HARDHAT_NETWORK: "plume",
      },
      ...commons,
    },
  ],
};
