module.exports = {
  apps: [
    {
      name: 'venera-source-converter',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        DEPLOY_TARGET: 'server',
        PORT: '3000',
        CACHE_DRIVER: 'file',
        IMAGE_CACHE_DRIVER: 'file',
        CACHE_DIR: './data/cache',
        IMAGE_CACHE_DIR: './data/images',
        STORAGE_DIR: './data/storage',
        ENABLED_SOURCES: 'copy_manga,manga_dex,nhentai,picacg',
        ENABLE_RELOAD: 'true'
      }
    }
  ]
}
