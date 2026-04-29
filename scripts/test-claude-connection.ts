import { ClaudeAgentDriver } from '../src/integrations/claude/claude-driver';

async function test() {
  console.log('🧪 测试 Claude API 连接...\n');

  const driver = new ClaudeAgentDriver();

  try {
    const result = await driver.processTask('hardware', '你好', []);
    console.log('\n✅ Claude 连接成功！\n');
    console.log('响应:', result.finalResponse);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 连接失败:', error);
    process.exit(1);
  }
}

test();
