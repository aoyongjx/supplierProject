# Skill管理

## 菜单与路由

- 路由：`/capability-center/skills`

## 功能说明

Skill 列表、安装与卸载。

## 关键接口

- GET /api/skills
- POST /api/skills/install|uninstall

## 业务规则

- 安装/卸载后列表即时刷新。

## 验收标准

1. 页面可正常加载，无白屏。
2. 关键操作返回成功或明确错误提示。
3. 数据变更可在页面刷新后保持一致。



