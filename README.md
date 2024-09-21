# Mikopilot

### 启动
`Ctrl + Shift + P` 打开命令面板，输入 `Mikopilot` 回车启动

打开文件时，先打开原文txt，再打开译文txt，打开前需保证译文中的每一行与原文对齐（如多行对应一行，用 `\n` 代替换行符，或者在 `设置` > `扩展` > `Mikopilot` > `newlineEscape` 中设置换行符的转义）。如无译文，请先新建空白txt文件

如txt文件较大，加载时间会比较长，请耐心等待

### 设置
`设置` > `扩展` > `Mikopilot` ，填写 Api Url 和 Translation Template

如果 Translation Template 包含多行，请在 `Ctrl+Shift+P` > `Preferences: Open Settings (JSON)` 中编辑 `mikopilot.translationTemplate`

### 翻译
`Ctrl + Enter` 续写当前行翻译。如无反应，请重启 vscode

### 保存
`Ctrl + S`
