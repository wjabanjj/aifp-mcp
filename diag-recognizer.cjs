// 识别器全链路诊断：flush_recognizer 处理 pending 队列
const path = require('path');
const fs = require('fs');
const SDK_CLIENT = path.join(__dirname, 'node_modules/@modelcontextprotocol/sdk/dist/cjs/client');
const { Client } = require(path.join(SDK_CLIENT, 'index.js'));
const { StdioClientTransport } = require(path.join(SDK_CLIENT, 'stdio.js'));

const auth = JSON.parse(fs.readFileSync(process.env.HOME + '/.pi/agent/auth.json', 'utf-8'));
const key = auth.deepseek?.key || '';

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, 'dist/index.js')],
    cwd: __dirname,
    env: {
      ...process.env,
      COGNITION_MODE: 'local',
      COGNITION_RECOGNIZER: '1',
      COGNITION_LLM_API_KEY: key,
      COGNITION_LLM_BASE_URL: 'https://api.deepseek.com',
      COGNITION_LLM_MODEL: 'deepseek-chat',
    },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'pi-diag', version: '1.0.0' }, { requestTimeoutMs: 180000 });
  await client.connect(transport);
  console.log('[1] 连接成功');

  // 先看 pending 数量
  const before = await client.callTool({ name: 'get_stats', arguments: {} });
  console.log('[2] stats:', before.content[0].text.slice(0, 100));

  // 触发识别（flush_recognizer）
  console.log('[3] 调用 flush_recognizer...');
  const t0 = Date.now();
  const res = await client.callTool({ name: 'flush_recognizer', arguments: {} });
  console.log(`[4] flush_recognizer ${Date.now() - t0}ms:`, JSON.stringify(res).slice(0, 400));

  await client.close();
  await transport.close();
  console.log('[5] 完成');
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
