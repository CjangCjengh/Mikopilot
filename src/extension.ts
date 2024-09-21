import * as vscode from 'vscode';
import * as fs from 'fs';
import axios from 'axios';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('cjangcjengh.mikopilot', async () => {
        const config = vscode.workspace.getConfiguration('mikopilot');
        const newlineEscape = config.get<string>('newlineEscape', '\\n');
        const escapedNewlineEscape = newlineEscape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const apiUrl = config.get<string>('apiUrl', 'http://0.0.0.0:5000/v1/chat/completions');
        const maxNewTokens = config.get<number>('maxNewTokens', 100);
        const contextLinesAbove = config.get<number>('contextLinesAbove', 3);
        const contextLinesBelow = config.get<number>('contextLinesBelow', 3);
        const translationTemplate = config.get<string>('translationTemplate', '<|im_start|>system\n你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。<|im_end|>\n<|im_start|>user\n将下面的日文文本翻译成中文：{original}<|im_end|>\n<|im_start|>assistant\n{translation}');

        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: {
                '': ['txt']
            }
        });

        if (!fileUris || (fileUris.length !== 1 && fileUris.length !== 2)) {
            vscode.window.showErrorMessage('Please select one or two files.');
            return;
        }

        let originalFile, translationFile;
        if (fileUris.length === 2) {
            [originalFile, translationFile] = fileUris;
        } else {
            originalFile = fileUris[0];
            const secondFileUris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    '': ['txt']
                }
            });

            if (!secondFileUris || secondFileUris.length !== 1) {
                vscode.window.showErrorMessage('Please select exactly one translation file.');
                return;
            }

            translationFile = secondFileUris[0];
        }

        const originalText = fs.readFileSync(originalFile.fsPath, 'utf-8');
        const translationText = fs.readFileSync(translationFile.fsPath, 'utf-8');

        const originalLines = originalText.split(/\r?\n/).map(line => line.replace(new RegExp(escapedNewlineEscape, 'g'), '\n'));
        const translationLines = translationText.split(/\r?\n/).map(line => line.replace(new RegExp(escapedNewlineEscape, 'g'), '\n'));

        const panel = vscode.window.createWebviewPanel(
            'mikopilot',
            'Mikopilot',
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );

        panel.webview.html = getWebviewContent(originalLines, translationLines);

        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'save': {
                    let { original, translation } = message.data;

                    original = original.map((line: string) => line.replace(/\n/g, newlineEscape)).join('\n');
                    translation = translation.map((line: string) => line.replace(/\n/g, newlineEscape)).join('\n');

                    fs.writeFileSync(originalFile.fsPath, original, 'utf-8');
                    fs.writeFileSync(translationFile.fsPath, translation, 'utf-8');

                    vscode.window.showInformationMessage('Files have been saved!');
                    panel.title = 'Mikopilot';
                    panel.webview.postMessage({ command: 'clearDirty' });
                    break;
                }
                case 'contentChange':
                    if (!panel.title.endsWith('●')) {
                        panel.title += ' ●';
                    }
                    break;
                case 'translate': {
                    const { original, translation, cursorPosition } = message.data;
                    handleTranslation(original, translation, cursorPosition, apiUrl, maxNewTokens, contextLinesAbove, contextLinesBelow, translationTemplate, panel.webview);
                    break;
                }
            }
        });

        vscode.workspace.onDidSaveTextDocument(() => {
            panel.webview.postMessage({ command: 'clearDirty' });
            panel.title = 'Mikopilot';
        });

        context.subscriptions.push(panel);
    });

    context.subscriptions.push(disposable);
}

async function handleTranslation(original: string[], translation: string[], cursorPosition: number, apiUrl: string, maxNewTokens: number, contextLinesAbove: number, contextLinesBelow: number, translationTemplate: string, webview: vscode.Webview) {
    for (let i = cursorPosition - 1; i >= Math.max(0, cursorPosition - contextLinesAbove); i--) {
        if (translation[i].trim() === '' || original[i].trim() === '') {
            contextLinesAbove = cursorPosition - i - 1
            break;
        }
    }
    for (let i = cursorPosition + 1; i <= Math.min(original.length - 1, cursorPosition + contextLinesBelow); i++) {
        if (original[i].trim() === '') {
            contextLinesBelow = i - cursorPosition - 1
            break;
        }
    }

    const originalContext = gatherContext(original, cursorPosition, contextLinesAbove, contextLinesBelow);
    const translationContext = gatherContext(translation, cursorPosition, contextLinesAbove, 0);
    const prompt = buildPrompt(translationTemplate, originalContext, translationContext);

    let stopStream = false;
    try {
        const response = await axios.post(apiUrl, {
            prompt: prompt,
            max_new_tokens: maxNewTokens,
            stream: true
        }, { responseType: 'stream' });

        if (response.status === 200) {
            response.data.on('data', (chunk: Buffer) => {
                if (stopStream) {
                    response.data.destroy();
                    return;
                }

                const chunkText = chunk.toString('utf-8').trim();
                if (chunkText.startsWith('data: ')) {
                    const jsonStr = chunkText.substring(6);
                    try {
                        const jsonData = JSON.parse(jsonStr);
                        if (jsonData.choices && jsonData.choices.length && jsonData.choices[0].delta) {
                            let content = jsonData.choices[0].delta.content;
                            if (content) {
                                if (content.includes('\n')) {
                                    content = content.replace('\n', '');
                                    stopStream = true;
                                }
                                webview.postMessage({ command: 'appendTranslation', data: { content, cursorPosition } });
                            }
                        }
                    } catch (error) { }
                }
            });
        }
    } catch (error) { }
}

function gatherContext(lines: string[], position: number, above: number, below: number): string {
    const start = Math.max(0, position - above);
    const end = Math.min(lines.length, position + below + 1);
    return lines.slice(start, end).join('\n');
}

function buildPrompt(template: string, original: string, translation: string): string {
    return template.replace('{original}', original).replace('{translation}', translation);
}

function getWebviewContent(originalLines: string[], translationLines: string[]): string {
    const pairs = originalLines.map((line, index) => {
        const translation = translationLines[index] || '';
        return `<div style="display: flex; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); padding: 4px;">
                    <textarea id="original-${index}" style="flex: 1; margin-right: 10px; border: none; background: transparent; resize: none; overflow: hidden;">${line}</textarea>
                    <textarea id="translation-${index}" style="flex: 1; border: none; background: transparent; resize: none; overflow: hidden;">${translation}</textarea>
                </div>`;
    }).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Mikopilot</title>
        <style>
            body, textarea {
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                font-family: var(--vscode-editor-font-family);
                font-size: var(--vscode-editor-font-size);
                line-height: var(--vscode-editor-line-height);
            }
            textarea {
                line-height: 1.5;
                padding: 0;
                box-sizing: border-box;
            }
            textarea:focus {
                outline: none;
            }
        </style>
    </head>
    <body>
        ${pairs}
        <script>
            const vscode = acquireVsCodeApi();

            function adjustTextareaHeight(textarea) {
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 'px';
            }

            document.querySelectorAll('textarea').forEach(textarea => {
                adjustTextareaHeight(textarea);
                textarea.addEventListener('input', () => {
                    adjustTextareaHeight(textarea);
                    vscode.postMessage({ command: 'contentChange' });
                });
            });

            function gatherTextareaContent(prefix) {
                const content = [];
                document.querySelectorAll(\`textarea[id^='\${prefix}']\`).forEach(textarea => {
                    content.push(textarea.value);
                });
                return content;
            }

            function save() {
                const originalLines = [];
                const translationLines = [];

                document.querySelectorAll('textarea[id^=original-]').forEach(textarea => {
                    originalLines.push(textarea.value);
                });

                document.querySelectorAll('textarea[id^=translation-]').forEach(textarea => {
                    translationLines.push(textarea.value);
                });

                vscode.postMessage({
                    command: 'save',
                    data: {
                        original: originalLines,
                        translation: translationLines
                    }
                });
            }

            window.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    save();
                }
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    const focusedElement = document.activeElement;
                    vscode.postMessage({
                        command: 'translate',
                        data: {
                            original: gatherTextareaContent('original-'),
                            translation: gatherTextareaContent('translation-'),
                            cursorPosition: Number(focusedElement.id.split('-')[1])
                        }
                    });
                }
            });

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'clearDirty') {
                    vscode.setState({ isDirty: false });
                }
                if (message.command === 'appendTranslation') {
                    const { content, cursorPosition } = message.data;
                    const textarea = document.getElementById(\`translation-\${cursorPosition}\`);
                    if (textarea) {
                        textarea.value += content;
                        adjustTextareaHeight(textarea);
                        vscode.postMessage({ command: 'contentChange' });
                    }
                }
            });

            vscode.setState({ isDirty: false });
        </script>
    </body>
    </html>`;
}

export function deactivate() { }
