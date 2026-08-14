// AiFP MCP 运行时验证：完整握手 + 核心工具链路测试
const path = require('path');
const SDK_CLIENT = path.join(__dirname, 'node_modules/@modelcontextprotocol/sdk/dist/cjs/client');
const { Client } = require(path.join(SDK_CLIENT, 'index.js'));
const { StdioClientTransport } = require(path.join(SDK_CLIENT, 'stdio.js'));

async function main() {
  const t0 = Date.now();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [require('path').join(__dirname, 'dist/index.js')],
    cwd: __dirname,
    env: {
      ...process.env,
      COGNITION_MODE: 'local',
      COGNITION_RECOGNIZER: '0', // 测识别器时手动开
    },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'pi-verify', version: '1.0.0' });
  await client.connect(transport);
  console.log(`[1] 握手完成 ${Date.now() - t0}ms`);

  // 工具列表
  const { tools } = await client.listTools();
  console.log(`[2] 工具数量: ${tools.length}`);
  const names = tools.map(t => t.name);
  console.log(`    工具: ${names.join(', ')}`);
  console.log('    包含 save_memory:', names.includes('save_memory'), '| search_memories:', names.includes('search_memories'), '| observe_turn:', names.includes('observe_turn'), '| recall_context:', names.includes('recall_context'));

  // get_stats
  const stats = await client.callTool({ name: 'get_stats', arguments: {} });
  const statsText = stats.content.filter(c => c.type === 'text').map(c => c.text).join('');
  console.log(`[3] get_stats: ${statsText.slice(0, 200)}`);

  // search_memories（检索链路）
  const t1 = Date.now();
  const search = await client.callTool({ name: 'search_memories', arguments: { query: '咖啡' } });
  const searchText = search.content.filter(c => c.type === 'text').map(c => c.text).join('');
  console.log(`[4] search_memories('咖啡') ${Date.now() - t1}ms: ${searchText.slice(0, 200)}`);

  // observe_turn（写入链路：入队）
  const t2 = Date.now();
  const obs = await client.callTool({ name: 'observe_turn', arguments: { user_message: '验证测试：用户说喜欢喝乌龙茶' } });
  console.log(`[5] observe_turn ${Date.now() - t2}ms: ${JSON.stringify(obs).slice(0, 120)}`);

  await client.close();
  await transport.close();
  console.log('[6] 验证完成，连接已关闭');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
