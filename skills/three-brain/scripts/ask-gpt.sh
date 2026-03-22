#!/usr/bin/env bash
# Ask GPT via OpenAI API
# Usage: ask-gpt.sh "question" [model] [system_prompt]
set -euo pipefail

QUESTION="${1:?Usage: ask-gpt.sh 'question' [model] [system_prompt]}"
MODEL="${2:-gpt-4o}"
SYSTEM="${3:-You are a strategic advisor. Be concise, specific, and actionable. Reply in the same language as the question.}"

# Load API key
if [ -f "$HOME/.openclaw/.env" ]; then
  source <(grep OPENAI_API_KEY "$HOME/.openclaw/.env")
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY not found" >&2
  exit 1
fi

# Build JSON payload
PAYLOAD=$(jq -n \
  --arg model "$MODEL" \
  --arg system "$SYSTEM" \
  --arg user "$QUESTION" \
  '{
    model: $model,
    messages: [
      {role: "system", content: $system},
      {role: "user", content: $user}
    ],
    temperature: 0.7
  }')

# Call API
RESPONSE=$(curl -s https://api.openai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "$PAYLOAD")

# Extract content
echo "$RESPONSE" | jq -r '.choices[0].message.content // .error.message // "ERROR: Unknown error"'
