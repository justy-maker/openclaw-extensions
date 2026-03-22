# Code Review 標準

## Review Agent 審查清單

### 程式碼品質
- TypeScript 型別完整（不允許 `any`）
- 命名清楚易懂
- 函數長度合理（< 50 行）
- 無重複程式碼（DRY）
- 錯誤處理完整

### 安全性
- 無硬編碼 credentials
- 使用者輸入有驗證
- 敏感資料安全存儲
- 依賴套件無已知漏洞

### 效能
- 無阻塞主線程操作
- 無記憶體洩漏風險
- 非同步操作正確處理

### 測試
- 有對應測試
- 覆蓋邊界情況
- Mock 合理

## PR Comment 格式

```markdown
## Review Summary
- ✅ Approve / ⚠️ 需修改 / ❌ 拒絕

## Issues Found
1. [🔴 Critical / 🟡 Warning / 🔵 Suggestion] 問題描述 + 建議

## Good Practices
- 做得好的地方
```
