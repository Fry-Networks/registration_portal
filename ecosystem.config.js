module.exports = {
  apps: [
    {
      name: 'dashboard',
      script: './start-with-1password.sh',
      interpreter: '/bin/bash',
      env: {
        NODE_ENV: 'production',
        OP_SERVICE_ACCOUNT_TOKEN: process.env.OP_SERVICE_ACCOUNT_TOKEN,
        // Non-sensitive configuration variables
        NEXTAUTH_URL: 'https://dashboard.frynetworks.com',
        NEXTAUTH_URL_INTERNAL: 'http://localhost:3007',
        NEXT_PUBLIC_API_HOST: 'https://airback.frynetworks.com',
        NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED: 'true',
        NEXT_PUBLIC_TEST_MODE: 'false',
        WEEKLY_CUTOFF_UTC: '2025-09-12T00:00:00.000Z',
        BUG_REPORT_RATE_LIMIT_HOURS: '12',
        NEXT_PUBLIC_CREDENTIALS_NEEDED: 'AEM'
      }
    }
  ]
};
