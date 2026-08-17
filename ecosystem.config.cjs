module.exports = {
  apps: [
    {
      name: 'apex_aff',
      cwd: __dirname,
      script: 'server/app.js',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
