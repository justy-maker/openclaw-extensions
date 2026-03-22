import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// ============================================================================
// Smart Router Plugin
// 根據訊息內容自動選擇最適合的模型
// ============================================================================

const PROVIDER       = "anthropic";
const SONNET_MODEL   = "claude-sonnet-4-20250514";
const OPUS_MODEL     = "claude-opus-4-6";

// Opus 關鍵字：深度研究、策略規劃、創意生成
const OPUS_PATTERNS = [
  /深度研究/,
  /策略(報告|規劃|分析|建議)?/,
  /企劃(書|案)?/,
  /創意(生成|發想|腦力)?/,
  /跨領域/,
  /多步驟(規劃|計畫|流程)?/,
  /全面(分析|評估|報告)/,
  /@opus\b/i,
];

// Sonnet 關鍵字：架構設計、程式分析、除錯、商業決策
const SONNET_PATTERNS = [
  /架構(設計|分析|規劃|問題)?/,
  /設計(方案|文件|模式)/,
  /程式(碼|分析|重構|問題)/,
  /除錯|debug/i,
  /refactor|重構/i,
  /資安|安全(漏洞|問題|分析)/,
  /商業(決策|分析|模型)/,
  /重大決策/,
  /系統(設計|架構|優化)/,
  /code\s*review/i,
  /@sonnet\b/i,
];

// Haiku 強制保留（不升級）
const HAIKU_PATTERNS = [
  /@haiku\b/i,
  /^(現在|今天|幾點|天氣|你好|hi|hello)/i,
];

export default function register(api: OpenClawPluginApi) {
  api.on("before_model_resolve", (event) => {
    const prompt = (event.prompt ?? "").trim();
    if (!prompt) return;

    // Haiku 強制保留（優先判斷）
    for (const pattern of HAIKU_PATTERNS) {
      if (pattern.test(prompt)) {
        api.logger.debug(`smart-router: haiku forced (matched: ${pattern})`);
        return;
      }
    }

    // Opus 升級
    for (const pattern of OPUS_PATTERNS) {
      if (pattern.test(prompt)) {
        api.logger.info(`smart-router: → Opus (matched: ${pattern})`);
        return { modelOverride: OPUS_MODEL };
      }
    }

    // Sonnet 升級
    for (const pattern of SONNET_PATTERNS) {
      if (pattern.test(prompt)) {
        api.logger.info(`smart-router: → Sonnet (matched: ${pattern})`);
        return { modelOverride: SONNET_MODEL };
      }
    }

    // 預設：不 override，維持 Haiku
    api.logger.debug(`smart-router: → Haiku (no pattern matched)`);
  });

  api.logger.info("smart-router: registered (before_model_resolve hook active)");
}
