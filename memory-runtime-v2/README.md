# Memory Runtime v2 (External, Kernel-Safe)

This runtime provides memory automation without modifying Codex kernel files or `~/.codex`.

## Scope
- No changes to `E:\ClaudeCodeSrc`
- No changes to `C:\Users\aoyon\.codex`
- All data/scripts remain under `E:\workspaceCodeing\memory-runtime-v2`

## Structure
- `config/memory.config.json` config
- `data/index/memory.index.jsonl` memory index
- `data/layers/L1_session|L2_episode|L3_semantic|L4_policy` layered memory files
- `scripts/*.ps1` runtime scripts

## Scripts
- `save-memory.ps1` save one memory item
- `recall.ps1` retrieve relevant items + apply budget
- `recall-budget.ps1` budget gate for recalled entries
- `session-summary.ps1` generate and save session summary into L1
- `memory-merge.ps1` merge similar/duplicate memories into L3
- `run-maintenance.ps1` helper to run maintenance

## Quick Start

### 1) Save
```powershell
powershell -File E:\workspaceCodeing\memory-runtime-v2\scripts\save-memory.ps1 \
  -Type feedback -Title "简洁输出" -Summary "用户偏好简洁输出。" -Tags preference style
```

### 2) Recall
```powershell
powershell -File E:\workspaceCodeing\memory-runtime-v2\scripts\recall.ps1 \
  -Query "输出风格偏好" -TopK 5 -BudgetBytes 12000
```

### 3) Session Summary
```powershell
powershell -File E:\workspaceCodeing\memory-runtime-v2\scripts\session-summary.ps1 \
  -InputText "User: ...`nAssistant: ..." -Project "workspaceCodeing"
```

### 4) Merge Dry Run
```powershell
powershell -File E:\workspaceCodeing\memory-runtime-v2\scripts\memory-merge.ps1
```

### 5) Merge Apply
```powershell
powershell -File E:\workspaceCodeing\memory-runtime-v2\scripts\memory-merge.ps1 -Apply
```

## Recommended Loop
1. Before response: run `recall.ps1`
2. After response (if stable memory): run `save-memory.ps1`
3. End of session: run `session-summary.ps1`
4. Daily/weekly: run `run-maintenance.ps1 -ApplyMerge`
