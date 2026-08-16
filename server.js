const { createApp } = require('./cloud-functions/app');

process.on('uncaughtException', (error) => {
  console.error('=== 未捕获的异常 ===');
  console.error('时间:', new Date().toISOString());
  console.error('错误名称:', error.name);
  console.error('错误信息:', error.message);
  console.error('错误堆栈:', error.stack);
  console.error('====================');
});

process.on('unhandledRejection', (reason) => {
  console.error('=== 未处理的 Promise 拒绝 ===');
  console.error('时间:', new Date().toISOString());
  console.error('拒绝原因:', reason);
  console.error('============================');
});

const app = createApp();

// 获取命令行参数中的端口号
const args = process.argv.slice(2);
let portFromArgs = null;
for (const arg of args) {
  const parsed = parseInt(arg, 10);
  if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
    portFromArgs = parsed;
    break;
  }
}

const PORT = portFromArgs || process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Venera Source Converter running on port ${PORT}`);
  console.log(`Please place your .js source files in: ${__dirname}/sources`);
});
