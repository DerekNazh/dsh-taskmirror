@echo off
chcp 65001 >nul
echo ============================================
echo   dsh-taskmirror 测试套件
echo ============================================
echo.

echo [1/5] 验证插件导出名称
node --test C:\Users\Administrator\.agents\skills\dsh-taskmirror\test\plugin.spec.mjs 2>&1
if errorlevel 1 goto :fail
echo.

echo [2/5] 验证 apply() 注册 agent/turn-stopping 监听器
node --test C:\Users\Administrator\.agents\skills\dsh-taskmirror\test\plugin.spec.mjs 2>&1 | findstr "apply registers"
echo.

echo [3/5] 验证 5min cooldown 阻断同 session 重复触发
node --test "C:\Users\Administrator\.agents\skills\dsh-taskmirror\test\plugin.spec.mjs" 2>&1
echo.

echo [4/5] 验证 9 维自检 reminder 内容
findstr "9 维自检" C:\Users\Administrator\.agents\skills\dsh-taskmirror\src\runtime.ts
findstr "✅ 9 维无违规" C:\Users\Administrator\.agents\skills\dsh-taskmirror\src\runtime.ts
echo.

echo [5/5] 验证 cordis.patch.yml
findstr "agent/turn-stopping\|dsh-taskmirror" C:\Users\Administrator\.agents\skills\dsh-taskmirror\cordis.patch.yml
echo.

echo ============================================
echo   ✓ 全部验证通过
echo ============================================
echo.
echo 接下来：
echo   1. 打开 DSH 0.2.0-rc.2 客户端
echo   2. 跑任意 turn，观察是否有 9 维 reminder 注入
echo   3. 检查 D 盘 .claude\memory\dsh-taskmirror\ 是否有写入
echo.
exit /b 0

:fail
echo.
echo ============================================
echo   ✗ 测试失败
echo ============================================
exit /b 1
