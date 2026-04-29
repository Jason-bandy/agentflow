# Claude AI Agent 集成指南

## 快速开始

1. 复制 .env.example 为 .env
2. 填入 ANTHROPIC_API_KEY
3. 运行 `npm run test:claude` 测试连接

## Agent 类型

- **HardwareAgent**: 硬件研发
- **SoftwareAgent**: 软件开发
- **TestAgent**: 测试集成
- **PMAgent**: 项目管理
- **ReleaseAgent**: 发布管理

## 开发

继承 ClaudeBaseAgent 创建新 Agent:

```typescript
export class MyAgent extends ClaudeBaseAgent {
  constructor() {
    const tools = [/* ... */];
    super('my-role', tools);
  }
}
```
