const API_KEY = ""; // Get yours at https://platform.sulu.sh/apis/judge0

const AUTH_HEADERS = API_KEY ? {
    "Authorization": `Bearer ${API_KEY}`
} : {};

const CE = "CE";
const EXTRA_CE = "EXTRA_CE";

const AUTHENTICATED_CE_BASE_URL = "https://judge0-ce.p.sulu.sh";
const AUTHENTICATED_EXTRA_CE_BASE_URL = "https://judge0-extra-ce.p.sulu.sh";

var AUTHENTICATED_BASE_URL = {};
AUTHENTICATED_BASE_URL[CE] = AUTHENTICATED_CE_BASE_URL;
AUTHENTICATED_BASE_URL[EXTRA_CE] = AUTHENTICATED_EXTRA_CE_BASE_URL;

const UNAUTHENTICATED_CE_BASE_URL = "https://ce.judge0.com";
const UNAUTHENTICATED_EXTRA_CE_BASE_URL = "https://extra-ce.judge0.com";

var UNAUTHENTICATED_BASE_URL = {};
UNAUTHENTICATED_BASE_URL[CE] = UNAUTHENTICATED_CE_BASE_URL;
UNAUTHENTICATED_BASE_URL[EXTRA_CE] = UNAUTHENTICATED_EXTRA_CE_BASE_URL;

const INITIAL_WAIT_TIME_MS = 0;
const WAIT_TIME_FUNCTION = i => 100;
const MAX_PROBE_REQUESTS = 50;

var fontSize = 13;

var layout;

var sourceEditor;
var stdinEditor;
var stdoutEditor;

var $selectLanguage;
var $compilerOptions;
var $commandLineArguments;
var $runBtn;
var $statusLine;

var timeStart;
var timeEnd;

var sqliteAdditionalFiles;
var languages = {};



let completionTimeout = null;
let decorationIds = [];
const COMPLETION_DELAY = 600;
let aiService;
const stopWords = ["return", "break", "continue", "import", "export", "end", ";", "}"];
let isSelecting = false;
let isCreatingMenu = false;


var AI_MODELS = {
    'google/gemma-2-9b-it:free': {
        name: 'Google Gemini',
        maxTokens: 200000,
    },
    'qwen/qwen-2.5-coder-32b-instruct': {
        name: 'Qwen2.5 Coder 32B Instruct',
        maxTokens: 200000,
    },
    'meta-llama/codellama-70b-instruct': {
        name: 'Meta: CodeLlama 70B Instruct'
    }
};

var currentModel = 'google/gemma-2-9b-it:free'; // default model
var aiChatHistory = [];

var layoutConfig = {
    settings: {
        showPopoutIcon: false,
        reorderEnabled: true
    },
    content: [{
        type: "row",
        content: [{
            type: "component",
            width: 66,
            componentName: "source",
            id: "source",
            title: "Source Code",
            isClosable: false,
            componentState: {
                readOnly: false
            }
        }, {
            type: "column",
            content: [{
                type: "component",
                componentName: "stdin",
                id: "stdin",
                title: "Input",
                isClosable: false,
                componentState: {
                    readOnly: false
                }
            }, {
                type: "component",
                componentName: "stdout",
                id: "stdout",
                title: "Output",
                isClosable: false,
                componentState: {
                    readOnly: true
                }
            }, {
                type: "component",
                componentName: "ai-chat",
                id: "ai-chat",
                title: "AI Assistant",
                height: 30,
                isClosable: false,
                componentState: {
                    readOnly: false
                }
            }, {
                    type: "component",
                    componentName: "bug-finder",
                    id: "bug-finder",
                    title: "Bug Finder",
                    height: 30,
                    isClosable: true,
                    componentState: {
                        readOnly: false
                    }
            }]
        }]
    }]
};

async function getInlineCompletion(code, position) {
    console.log(code)
    const model = sourceEditor.getModel();
    const language = $selectLanguage.find(":selected").text();

    // Calculate available space
    let availableLines = 0;
    const currentLine = model.getLineContent(position.lineNumber);
    const hasSpaceAfterCursor = currentLine.substring(position.column - 1).trim().length === 0;

    if (hasSpaceAfterCursor) {
        // Count empty lines after current position
        let lineCount = 0;
        let lineNumber = position.lineNumber + 1;

        while (lineNumber <= model.getLineCount()) {
            const lineContent = model.getLineContent(lineNumber).trim();
            if (lineContent.length > 0) break;
            lineCount++;
            lineNumber++;
        }
        availableLines = lineCount + 1; // +1 for current line
    }

    try {
        const suggestion = await aiService.getCodeCompletion(
            code,
            position,
            language,
            availableLines
        );

        if (!suggestion) return null;

        // Clean the suggestion
        let cleanSuggestion = suggestion
            .replace(/^```[\w-]*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();

        // Limit lines to available space
        const lines = cleanSuggestion.split('\n');
        if (lines.length > availableLines) {
            cleanSuggestion = lines.slice(0, availableLines).join('\n');
        }

        return cleanSuggestion;
    } catch (error) {
        console.error('OpenAI completion error:', error);
        return null;
    }
}

function createModelSelector() {
    const selectorHtml = `
        <div class="model-selector">
            <label>AI Model:</label>
            <select class="ui dropdown" id="modelSelector">
                ${Object.entries(AI_MODELS).map(([key, model]) => `
                    <option value="${key}" ${key === currentModel ? 'selected' : ''}>
                        ${model.name}
                    </option>
                `).join('')}
            </select>
        </div>
    `;

    const selector = $(selectorHtml);

    // Add change handler directly to the selector
    selector.find('#modelSelector').on('change', function() {
        const selectedModel = $(this).val();
        currentModel = selectedModel;
        const model = AI_MODELS[selectedModel];

        // Add system message about model change
        addMessage(`Switched to ${model.name}\n${model.description}`, 'system');
    });

    return selector;
}

function createChatInterface() {
    const chatHtml = `
        <div class="ai-chat-container">
            <div class="chat-messages" id="chatMessages">
                <div class="chat-message system-message">
                    <div class="message-content">
                        Hello! I'm your AI coding assistant. I can help you with:
                        <ul>
                            <li>Explaining code</li>
                            <li>Suggesting improvements</li>
                            <li>Debugging issues</li>
                            <li>Answering programming questions</li>
                        </ul>
                        Feel free to ask anything!
                    </div>
                </div>
            </div>
            <div class="chat-input-container">
                <div id="codeContext" class="code-context-container"></div>
                <div style="display: flex; gap: 8px">
                    <textarea
                        id="chatInput"
                        placeholder="Ask a question about your code..."
                        rows="2"
                        class="chat-input"
                    ></textarea>
                    <button id="sendChat" class="ui primary button">
                        <i class="paper plane icon"></i>
                        Send
                    </button>
                </div>
            </div>
        </div>
    `;
    return $(chatHtml);
}

async function handleChatMessage(message, debugMode = false) {
    const $chatMessages = $("#chatMessages");
    const $chatInput = $("#chatInput");
    const $sendButton = $("#sendChat");

    // Render user message
    addMessage(message, 'user');

    const contextElement = document.querySelector('.active-code-context');
    let code = '';

    if (contextElement) {
        // Use the code from context above textarea
        const codeBlock = contextElement.querySelector('pre code');
        code = codeBlock.textContent;
    } else {
        // Use whole file if no context
        code = sourceEditor.getValue();
    }

    const language = $selectLanguage.find(":selected").text();
    const input = !contextElement ? stdinEditor.getValue() : "";
    const output = !contextElement ? stdoutEditor.getValue() : "";
    const compilerOutput = !contextElement ? $statusLine.text() : "";

    // Typing indicator
    const loadingIndicator = showTypingIndicator();
    $chatMessages.append(loadingIndicator);
    $chatMessages.scrollTop($chatMessages[0].scrollHeight);

    try {
        const response = await aiService.getChatResponse(message, {code, language, input, output, compilerOutput}, currentModel);
        addMessage(response, 'ai');

        // Store in chat history
        aiChatHistory.push({ role: 'user', content: message });
        aiChatHistory.push({ role: 'assistant', content: response });

        // Keep last 50 messages
        if (aiChatHistory.length > 50) {
            aiChatHistory = aiChatHistory.slice(-50);
        }
    } catch (error) {
        console.log(error)
        addMessage("Sorry, I encountered an error. Please try again.", 'error');
    } finally {
        loadingIndicator.remove();

        // Re-enable input and button
        $chatInput.attr('disabled', false);
        $sendButton.removeClass('disabled');
        $chatInput.focus();
    }
}

function showTypingIndicator() {
    return $(`
        <div class="chat-message ai-message">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `);
}

function addMessage(content, type = 'ai') {
    const chatMessages = $("#chatMessages");
    const messageClass = type === 'user' ? 'user-message' :
        type === 'system' ? 'system-message' :
            type === 'error' ? 'error-message' : 'ai-message';

    const messageHtml = `
        <div class="chat-message ${messageClass}">
            <div class="message-content">
                ${type === 'user' ? content : marked.parse(content)}
            </div>
        </div>
    `;

    chatMessages.append(messageHtml);
    chatMessages.scrollTop(chatMessages[0].scrollHeight);
}

function toggleDebugDisability(shouldDisable) {
    const $debugWithAIBtn = $("#debug-with-ai")

    $debugWithAIBtn.prop('disabled', shouldDisable);

    if (shouldDisable) {
        $debugWithAIBtn.off('click');
    } else {
        $debugWithAIBtn.click(function (event) {
            handleChatMessage("Help me debug this code.");
        })
    }
}

function showInlineSuggestion(suggestion, position) {
    // Clear existing decorations first
    if (decorationIds.length > 0) {
        sourceEditor.deltaDecorations(decorationIds, []);
        decorationIds = [];
    }

    const model = sourceEditor.getModel();
    const suggestionLines = suggestion.split('\n');
    const decorations = [];

    // Check if there's content after cursor on first line
    const firstLineContent = model.getLineContent(position.lineNumber);
    const textAfterCursor = firstLineContent.substring(position.column - 1);

    // If there's content after cursor, don't show suggestion
    if (textAfterCursor.trim().length > 0) {
        return [];
    }

    // Check if we have space for all lines
    let hasSpace = true;
    for (let i = 1; i < suggestionLines.length; i++) {
        const lineNumber = position.lineNumber + i;
        if (lineNumber <= model.getLineCount()) {
            const lineContent = model.getLineContent(lineNumber);
            if (lineContent.trim().length > 0) {
                hasSpace = false;
                break;
            }
        }
    }

    // Only show suggestion if we have space for all lines
    if (hasSpace) {
        // Add first line
        decorations.push({
            range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
            ),
            options: {
                after: {
                    content: suggestionLines[0],
                    inlineClassName: 'ghost-text'
                },
                showIfCollapsed: true,
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
            }
        });

        // Add subsequent lines
        for (let i = 1; i < suggestionLines.length; i++) {
            decorations.push({
                range: new monaco.Range(
                    position.lineNumber + i,
                    1,
                    position.lineNumber + i,
                    1
                ),
                options: {
                    after: {
                        content: suggestionLines[i],
                        inlineClassName: 'ghost-text'
                    },
                    showIfCollapsed: true,
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            });
        }
    }

    // Apply decorations
    decorationIds = sourceEditor.deltaDecorations([], decorations);

    // Store the suggestion for tab completion
    sourceEditor._currentSuggestion = {
        text: suggestion,
        position: position
    };

    return decorationIds;
}

function isCursorInsideCommentOrString(code, position) {
    const beforeCursor = code.substring(0, position);
    return /\/\/|\/\*|\*\/|".*"|'.*'/.test(beforeCursor);
}

async function analyzeCode(code, language) {
    const codeWithLineNumbers = code.split('\n')
        .map((line, index) => `${index + 1}: ${line}`)
        .join('\n');

    const prompt = `
        Analyze this ${language} code and identify specific code snippets that contain potential issues.
        Also identify snippets that has bugs. The code below includes line numbers at the start of each line (format: "lineNumber: code").
        Use these EXACT line numbers in your response.
        Return your analysis as a JSON array of issues. Each issue should have this exact structure:
        {
            "title": "Brief title of the issue",
            "location": "Line X" (where X is the exact line number from where the issue arises, e.g., "Line 42"),
            "badCode": "The problematic code snippet",
            "problem": "Detailed explanation of why this is an issue",
            "fixedCode": "The corrected version of the code",
            "explanation": "Why the fix works"
        }
        

        Example response format:
        [{"title": "Null Reference", "location": "Line 45", "badCode": "user.getName()", "problem": "No null check", "fixedCode": "if (user) { user.getName(); }", "explanation": "Added null check"}]

        Important:
        - Format the response as a single line starting with [{ and ending with }]
        - Return valid JSON that can be parsed
        - For location, use EXACT format "Line X" where X is the line number where the issue arises
        - Keep the exact section headers as shown above
        - Don't use markdown code blocks or backticks
        - Only include snippets that have actual issues
        - Make sure PROBLEM and EXPLANATION sections are not empty
        - Provide specific FIXED CODE examples, not just general advice
        - Focus on the most important issues first
        - Limit to 3-5 most critical issues

        CODE TO ANALYZE:
        ${codeWithLineNumbers}
    `;

    // Get analysis from AI
    const analysis = await aiService.fetchAIChatResponse(prompt);
    const issues = JSON.parse(analysis);
    displayResults(issues);
}

function splitCodeIntoSegments(code) {
    // Split code into logical segments (functions, classes, blocks)
    const segments = [];

    // For demonstration, using a simple split by double newline
    // You might want to use a proper parser for your specific language
    const rawSegments = code.split(/\n\s*\n/);

    rawSegments.forEach((segment, index) => {
        if (segment.trim()) {
            segments.push({
                id: index,
                code: segment.trim(),
                startLine: code.slice(0, code.indexOf(segment)).split('\n').length,
                endLine: code.slice(0, code.indexOf(segment) + segment.length).split('\n').length
            });
        }
    });

    return segments;
}

function handleTabCompletion() {
    if (sourceEditor._currentSuggestion) {
        // If there's a suggestion, accept it
        const suggestion = sourceEditor._currentSuggestion;
        const position = suggestion.position;

        sourceEditor.executeEdits('suggestion', [{
            range: {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: position.column,
                endColumn: position.column
            },
            text: suggestion.text
        }]);

        // Clear the decorations and suggestion
        if (decorationIds.length > 0) {
            sourceEditor.deltaDecorations(decorationIds, []);
            decorationIds = [];
        }
        sourceEditor._currentSuggestion = null;
        return true;
    }
    return false;
}

const PUTER = puter.env === "app";
var gPuterFile;

function encode(str) {
    return btoa(unescape(encodeURIComponent(str || "")));
}

function decode(bytes) {
    var escaped = escape(atob(bytes || ""));
    try {
        return decodeURIComponent(escaped);
    } catch {
        return unescape(escaped);
    }
}

function displayResults(issues) {
    // Clear loading message
    $('#bugFinderResults').empty();

    if (issues.length === 0) {
        $('#bugFinderResults').html(`
            <div class="bug-finder-message success">
                <i class="check circle icon"></i> No significant issues found in the code.
            </div>
        `);
        return;
    }

    // Display each issue
    issues.forEach((issue) => {
        const issueElement = $(`
            <div class="issue-container">
                <div class="issue-header">
                    <i class="warning circle icon"></i>
                    ${issue.title}
                    ${issue.location ? `<span class="location-badge">${issue.location}</span>` : ''}
                </div>
                <div class="issue-content">
                    <div class="code-section">
                        <div class="code-header problematic">
                            <i class="times circle icon"></i> Problematic Code
                        </div>
                        <pre><code>${issue.badCode}</code></pre>
                    </div>
                    
                    ${issue.problem ? `
                        <div class="problem-section">
                            <div class="section-label">Problem:</div>
                            <div class="section-content">${issue.problem}</div>
                        </div>
                    ` : ''}

                    ${issue.fixedCode ? `
                        <div class="code-section">
                            <div class="code-header fixed">
                                <i class="check circle icon"></i> Fixed Code
                            </div>
                            <pre><code>${issue.fixedCode}</code></pre>
                        </div>
                    ` : ''}

                    ${issue.explanation ? `
                        <div class="explanation-section">
                            <div class="section-label">Explanation:</div>
                            <div class="section-content">${issue.explanation}</div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `);

        $('#bugFinderResults').append(issueElement);
    });
}

function showError(title, content) {
    $("#judge0-site-modal #title").html(title);
    $("#judge0-site-modal .content").html(content);

    let reportTitle = encodeURIComponent(`Error on ${window.location.href}`);
    let reportBody = encodeURIComponent(
        `**Error Title**: ${title}\n` +
        `**Error Timestamp**: \`${new Date()}\`\n` +
        `**Origin**: ${window.location.href}\n` +
        `**Description**:\n${content}`
    );

    $("#report-problem-btn").attr("href", `https://github.com/judge0/ide/issues/new?title=${reportTitle}&body=${reportBody}`);
    $("#judge0-site-modal").modal("show");
}

function showHttpError(jqXHR) {
    showError(`${jqXHR.statusText} (${jqXHR.status})`, `<pre>${JSON.stringify(jqXHR, null, 4)}</pre>`);
}

function handleRunError(jqXHR) {
    showHttpError(jqXHR);
    $runBtn.removeClass("disabled");

    window.top.postMessage(JSON.parse(JSON.stringify({
        event: "runError",
        data: jqXHR
    })), "*");
}

function handleResult(data) {
    const tat = Math.round(performance.now() - timeStart);
    console.log(`It took ${tat}ms to get submission result.`);

    const status = data.status;
    const stdout = decode(data.stdout);
    const compileOutput = decode(data.compile_output);
    const time = (data.time === null ? "-" : data.time + "s");
    const memory = (data.memory === null ? "-" : data.memory + "KB");

    $statusLine.html(`${status.description}, ${time}, ${memory} (TAT: ${tat}ms)`);

    const output = [compileOutput, stdout].join("\n").trim();

    stdoutEditor.setValue(output);

    $runBtn.removeClass("disabled");

    window.top.postMessage(JSON.parse(JSON.stringify({
        event: "postExecution",
        status: data.status,
        time: data.time,
        memory: data.memory,
        output: output
    })), "*");
}

function removeContextMenu() {
    const menu = $('#selection-context-menu');
    if (menu.length) {
        menu.find('.ui.dropdown').dropdown('destroy');
        menu.remove();
    }
}

async function getSelectedLanguage() {
    return getLanguage(getSelectedLanguageFlavor(), getSelectedLanguageId())
}

function getSelectedLanguageId() {
    return parseInt($selectLanguage.val());
}

function getSelectedLanguageFlavor() {
    return $selectLanguage.find(":selected").attr("flavor");
}

function run() {
    if (sourceEditor.getValue().trim() === "") {
        showError("Error", "Source code can't be empty!");
        return;
    } else {
        $runBtn.addClass("disabled");
    }

    stdoutEditor.setValue("");
    $statusLine.html("");

    let x = layout.root.getItemsById("stdout")[0];
    x.parent.header.parent.setActiveContentItem(x);

    let sourceValue = encode(sourceEditor.getValue());
    let stdinValue = encode(stdinEditor.getValue());
    let languageId = getSelectedLanguageId();
    let compilerOptions = $compilerOptions.val();
    let commandLineArguments = $commandLineArguments.val();

    let flavor = getSelectedLanguageFlavor();

    if (languageId === 44) {
        sourceValue = sourceEditor.getValue();
    }

    let data = {
        source_code: sourceValue,
        language_id: languageId,
        stdin: stdinValue,
        compiler_options: compilerOptions,
        command_line_arguments: commandLineArguments,
        redirect_stderr_to_stdout: true
    };

    let sendRequest = function (data) {
        window.top.postMessage(JSON.parse(JSON.stringify({
            event: "preExecution",
            source_code: sourceEditor.getValue(),
            language_id: languageId,
            flavor: flavor,
            stdin: stdinEditor.getValue(),
            compiler_options: compilerOptions,
            command_line_arguments: commandLineArguments
        })), "*");

        timeStart = performance.now();
        $.ajax({
            url: `${AUTHENTICATED_BASE_URL[flavor]}/submissions?base64_encoded=true&wait=false`,
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify(data),
            headers: AUTH_HEADERS,
            success: function (data, textStatus, request) {
                console.log(`Your submission token is: ${data.token}`);
                let region = request.getResponseHeader('X-Judge0-Region');
                setTimeout(fetchSubmission.bind(null, flavor, region, data.token, 1), INITIAL_WAIT_TIME_MS);
            },
            error: handleRunError
        });
    }

    if (languageId === 82) {
        if (!sqliteAdditionalFiles) {
            $.ajax({
                url: `./data/additional_files_zip_base64.txt`,
                contentType: "text/plain",
                success: function (responseData) {
                    sqliteAdditionalFiles = responseData;
                    data["additional_files"] = sqliteAdditionalFiles;
                    sendRequest(data);
                },
                error: handleRunError
            });
        }
        else {
            data["additional_files"] = sqliteAdditionalFiles;
            sendRequest(data);
        }
    } else {
        sendRequest(data);
    }
}

function fetchSubmission(flavor, region, submission_token, iteration) {
    if (iteration >= MAX_PROBE_REQUESTS) {
        handleRunError({
            statusText: "Maximum number of probe requests reached.",
            status: 504
        }, null, null);
        return;
    }

    $.ajax({
        url: `${UNAUTHENTICATED_BASE_URL[flavor]}/submissions/${submission_token}?base64_encoded=true`,
        headers: {
            "X-Judge0-Region": region
        },
        success: function (data) {
            if (data.status.id <= 2) { // In Queue or Processing
                $statusLine.html(data.status.description);
                setTimeout(fetchSubmission.bind(null, flavor, region, submission_token, iteration + 1), WAIT_TIME_FUNCTION(iteration));
            } else {
                toggleDebugDisability(!data.status.description.toLowerCase().includes("error"));
                handleResult(data);
            }
        },
        error: handleRunError
    });
}

function setSourceCodeName(name) {
    $(".lm_title")[0].innerText = name;
}

function getSourceCodeName() {
    return $(".lm_title")[0].innerText;
}

function openFile(content, filename) {
    clear();
    sourceEditor.setValue(content);
    selectLanguageForExtension(filename.split(".").pop());
    setSourceCodeName(filename);
}

function saveFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

async function openAction() {
    if (PUTER) {
        gPuterFile = await puter.ui.showOpenFilePicker();
        openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
    } else {
        document.getElementById("open-file-input").click();
    }
}

async function saveAction() {
    if (PUTER) {
        if (gPuterFile) {
            gPuterFile.write(sourceEditor.getValue());
        } else {
            gPuterFile = await puter.ui.showSaveFilePicker(sourceEditor.getValue(), getSourceCodeName());
            setSourceCodeName(gPuterFile.name);
        }
    } else {
        saveFile(sourceEditor.getValue(), getSourceCodeName());
    }
}

function setFontSizeForAllEditors(fontSize) {
    sourceEditor.updateOptions({ fontSize: fontSize });
    stdinEditor.updateOptions({ fontSize: fontSize });
    stdoutEditor.updateOptions({ fontSize: fontSize });
}

async function loadLangauges() {
    return new Promise((resolve, reject) => {
        let options = [];

        $.ajax({
            url: UNAUTHENTICATED_CE_BASE_URL + "/languages",
            success: function (data) {
                for (let i = 0; i < data.length; i++) {
                    let language = data[i];
                    let option = new Option(language.name, language.id);
                    option.setAttribute("flavor", CE);
                    option.setAttribute("langauge_mode", getEditorLanguageMode(language.name));

                    if (language.id !== 89) {
                        options.push(option);
                    }

                    if (language.id === DEFAULT_LANGUAGE_ID) {
                        option.selected = true;
                    }
                }
            },
            error: reject
        }).always(function () {
            $.ajax({
                url: UNAUTHENTICATED_EXTRA_CE_BASE_URL + "/languages",
                success: function (data) {
                    for (let i = 0; i < data.length; i++) {
                        let language = data[i];
                        let option = new Option(language.name, language.id);
                        option.setAttribute("flavor", EXTRA_CE);
                        option.setAttribute("langauge_mode", getEditorLanguageMode(language.name));

                        if (options.findIndex((t) => (t.text === option.text)) === -1 && language.id !== 89) {
                            options.push(option);
                        }
                    }
                },
                error: reject
            }).always(function () {
                options.sort((a, b) => a.text.localeCompare(b.text));
                $selectLanguage.append(options);
                resolve();
            });
        });
    });
};

async function loadSelectedLanguage(skipSetDefaultSourceCodeName = false) {
    monaco.editor.setModelLanguage(sourceEditor.getModel(), $selectLanguage.find(":selected").attr("langauge_mode"));

    if (!skipSetDefaultSourceCodeName) {
        setSourceCodeName((await getSelectedLanguage()).source_file);
    }
}

function selectLanguageByFlavorAndId(languageId, flavor) {
    let option = $selectLanguage.find(`[value=${languageId}][flavor=${flavor}]`);
    if (option.length) {
        option.prop("selected", true);
        $selectLanguage.trigger("change", { skipSetDefaultSourceCodeName: true });
    }
}

function selectLanguageForExtension(extension) {
    let language = getLanguageForExtension(extension);
    selectLanguageByFlavorAndId(language.language_id, language.flavor);
}

async function getLanguage(flavor, languageId) {
    return new Promise((resolve, reject) => {
        if (languages[flavor] && languages[flavor][languageId]) {
            resolve(languages[flavor][languageId]);
            return;
        }

        $.ajax({
            url: `${UNAUTHENTICATED_BASE_URL[flavor]}/languages/${languageId}`,
            success: function (data) {
                if (!languages[flavor]) {
                    languages[flavor] = {};
                }

                languages[flavor][languageId] = data;
                resolve(data);
            },
            error: reject
        });
    });
}

function setDefaults() {
    setFontSizeForAllEditors(fontSize);
    sourceEditor.setValue(DEFAULT_SOURCE);
    stdinEditor.setValue(DEFAULT_STDIN);
    $compilerOptions.val(DEFAULT_COMPILER_OPTIONS);
    $commandLineArguments.val(DEFAULT_CMD_ARGUMENTS);

    $statusLine.html("");

    loadSelectedLanguage();
}

function clear() {
    sourceEditor.setValue("");
    stdinEditor.setValue("");
    $compilerOptions.val("");
    $commandLineArguments.val("");

    $statusLine.html("");
}

function refreshSiteContentHeight() {
    const navigationHeight = $("#judge0-site-navigation").outerHeight();
    $("#judge0-site-content").height($(window).height() - navigationHeight);
    $("#judge0-site-content").css("padding-top", navigationHeight);
}

function refreshLayoutSize() {
    refreshSiteContentHeight();
    layout.updateSize();
}

$(window).resize(refreshLayoutSize);

$(document).ready(async function () {
    $("#select-language").dropdown();
    $("[data-content]").popup({
        lastResort: "left center"
    });

    aiService = new AIService();

    refreshSiteContentHeight();

    console.log("Hey, Judge0 IDE is open-sourced: https://github.com/judge0/ide. Have fun!");

    $selectLanguage = $("#select-language");
    $selectLanguage.change(function (event, data) {
        let skipSetDefaultSourceCodeName = (data && data.skipSetDefaultSourceCodeName) || !!gPuterFile;
        loadSelectedLanguage(skipSetDefaultSourceCodeName);
    });

    await loadLangauges();

    $compilerOptions = $("#compiler-options");
    $commandLineArguments = $("#command-line-arguments");

    $runBtn = $("#run-btn");
    $runBtn.click(run);

    $("#open-file-input").change(function (e) {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = function (e) {
                openFile(e.target.result, selectedFile.name);
            };

            reader.onerror = function (e) {
                showError("Error", "Error reading file: " + e.target.error);
            };

            reader.readAsText(selectedFile);
        }
    });

    $statusLine = $("#judge0-status-line");

    $(document).on("keydown", "body", function (e) {
        if (e.metaKey || e.ctrlKey) {
            switch (e.key) {
                case "Enter": // Ctrl+Enter, Cmd+Enter
                    e.preventDefault();
                    run();
                    break;
                case "s": // Ctrl+S, Cmd+S
                    e.preventDefault();
                    save();
                    break;
                case "o": // Ctrl+O, Cmd+O
                    e.preventDefault();
                    open();
                    break;
                case "+": // Ctrl+Plus
                case "=": // Some layouts use '=' for '+'
                    e.preventDefault();
                    fontSize += 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "-": // Ctrl+Minus
                    e.preventDefault();
                    fontSize -= 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "0": // Ctrl+0
                    e.preventDefault();
                    fontSize = 13;
                    setFontSizeForAllEditors(fontSize);
                    break;
            }
        }
    });

    require(["vs/editor/editor.main"], function (ignorable) {
        layout = new GoldenLayout(layoutConfig, $("#judge0-site-content"));

        layout.registerComponent("source", function (container, state) {
            sourceEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: true,
                readOnly: state.readOnly,
                language: "cpp",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: true
                }
            });


            // Track current suggestion decorations
            sourceEditor._currentSuggestionDecorations = [];
            sourceEditor._currentSuggestion = null;

            sourceEditor.onDidChangeModelContent((e) => {
                // Clear any pending requests
                if (completionTimeout) {
                    clearTimeout(completionTimeout);
                }

                // Clear current suggestions
                if (decorationIds.length > 0) {
                    sourceEditor.deltaDecorations(decorationIds, []);
                    decorationIds = [];
                }

                // Don't show suggestions while composing or undoing
                if (e.isFlush || e.isUndoing || e.isRedoing) {
                    return;
                }

                // Set new timeout for completion request
                completionTimeout = setTimeout(async () => {
                    // Make sure editor still has focus
                    if (!sourceEditor.hasTextFocus()) {
                        return;
                    }

                    const position = sourceEditor.getPosition();
                    const model = sourceEditor.getModel();

                    if (!position || !model) {
                        return;
                    }


                    // Get the current line content
                    const lineContent = model.getLineContent(position.lineNumber);
                    const currentLine = lineContent.substring(0, position.column - 1);

                    // Enhanced checks for when not to show suggestions
                    if (
                        !currentLine.trim() || // Empty line
                        position.column === 1 || // Cursor at start
                        currentLine.trim().length < 3 || // Too short
                        stopWords.some(word => currentLine.trim().endsWith(word)) || // Ends with stop word
                        isCursorInsideCommentOrString(model.getValue(), model.getOffsetAt(position)) || // In comment/string
                        /[{};]$/.test(currentLine.trim()) // Just typed a block delimiter
                    ) {
                        return;
                    }

                    try {
                        const suggestion = await getInlineCompletion(model.getValue(), position);

                        // Verify position hasn't changed while waiting for suggestion
                        if (!sourceEditor.getPosition().equals(position)) {
                            return;
                        }

                        if (suggestion) {
                            decorationIds = showInlineSuggestion(suggestion, position);
                        }
                    } catch (error) {
                        // Clear any partial decorations on error
                        if (decorationIds.length > 0) {
                            sourceEditor.deltaDecorations(decorationIds, []);
                            decorationIds = [];
                        }
                    }
                }, COMPLETION_DELAY);
            });

            sourceEditor.getDomNode().addEventListener('mousedown', (e) => {
                isSelecting = true;
            });

            sourceEditor.getDomNode().addEventListener('mouseup', (e) => {
                if (!isSelecting) return;
                isSelecting = false;
                isCreatingMenu = true;

                const selection = sourceEditor.getSelection();
                const selectedText = sourceEditor.getModel().getValueInRange(selection);

                if (selectedText.trim()) {
                    // Get coordinates of selection
                    const position = sourceEditor.getScrolledVisiblePosition(selection.getStartPosition());
                    const editorCoords = sourceEditor.getDomNode().getBoundingClientRect();

                    // Remove any existing menu
                    removeContextMenu();


                    // Create context menu
                    const contextMenu = $(`
                        <div id="selection-context-menu" style="position: fixed; left: ${editorCoords.left + position.left + 10}px; top: ${editorCoords.top + position.top}px; z-index: 1000;">
                            <div class="ui dropdown">
                                <div class="text">Add to Chat</div>
                                <i class="dropdown icon"></i>
                                <div class="menu">
                                    <div class="item" id="add-context-btn">
                                        <i class="plus icon"></i>
                                        Add as Context
                                    </div>
                                </div>
                            </div>
                        </div>
                    `);

                    // Add to body
                    $('body').append(contextMenu);

                    // Initialize Semantic UI dropdown
                    $('#selection-context-menu .ui.dropdown').dropdown();

                    // Add click handler
                    $('#add-context-btn').click(() => {
                        let $codeContextDiv = $('#codeContext');
                        const language = $selectLanguage.find(":selected").text();

                        // Clear any existing context
                        $codeContextDiv.empty().append($(`
                            <div class="active-code-context">
                                <div class="context-header">
                                    <span class="context-label">
                                        <i class="code icon"></i> Selected Code
                                    </span>
                                    <button class="ui mini icon button remove-context">
                                        <i class="times icon"></i>
                                    </button>
                                </div>
                                <div class="context-content">
                                    <pre><code class="language-${language}">${selectedText}</code></pre>
                                </div>
                            </div>
                        `));

                        $codeContextDiv.find('.remove-context').on('click', function() {
                            $('#codeContext').empty();
                        });

                        // Scroll chat to bottom
                        const chatMessages = document.getElementById('chatMessages');
                        chatMessages.scrollTop = chatMessages.scrollHeight;

                        // Remove the context menu
                        $('#selection-context-menu .ui.dropdown').dropdown('destroy');
                        $('#selection-context-menu').remove();
                    });

                    setTimeout(() => {
                        isCreatingMenu = false;
                    }, 0);

                    // Stop event propagation
                    e.stopPropagation();
                }
            });

            sourceEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
            sourceEditor.addCommand(monaco.KeyCode.Tab, () => {
                if (!handleTabCompletion()) {
                    sourceEditor.trigger('keyboard', 'tab', null);
                }
            });

            sourceEditor.onDidChangeCursorPosition(() => {
                if (decorationIds.length > 0) {
                    decorationIds = sourceEditor.deltaDecorations(decorationIds, []);
                }
            });
        })

        layout.registerComponent("stdin", function (container, state) {
            stdinEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.registerComponent("stdout", function (container, state) {
            stdoutEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.registerComponent("ai-chat", function (container, state) {
            const wrapper = $('<div class="ai-chat-wrapper"></div>');
            const toolbar = $('<div class="ai-chat-toolbar"></div>');

            // Add model selector
            const modelSelector = createModelSelector();


            toolbar.append(modelSelector)
            wrapper.append(toolbar);

            // Add chat interface
            const chatInterface = createChatInterface();
            wrapper.append(chatInterface);

            container.getElement().append(wrapper);

            // Set up chat input handlers
            $("#chatInput").keydown(function(e) {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const message = $(this).val().trim();
                    if (message) {
                        handleChatMessage(message);
                        $(this).val("");
                    }
                }
            });

            wrapper.on('click', '#sendChat', function() {
                const message = $("#chatInput").val().trim();
                if (message) {
                    handleChatMessage(message);
                    $("#chatInput").val("");
                }
            });
        });

        layout.registerComponent("bug-finder", function (container, state) {
            const wrapper = $('<div class="bug-finder-wrapper"></div>');
            const toolbar = $('<div class="bug-finder-toolbar"></div>');

            // Add analyze button
            const buttonGroup = $(`
                <div class="ui buttons">
                    <button id="startAnalysis" class="ui primary button">
                        <i class="search icon"></i>
                        Start Code Analysis
                    </button>
                </div>
            `);
            toolbar.append(buttonGroup);

            wrapper.append(toolbar);

            // Add main content area
            const content = $(`
                <div class="bug-finder-content">
                    <div id="bugFinderResults" class="results-container"></div>
                </div>
            `);
            wrapper.append(content);

            container.getElement().append(wrapper);

            // Add event handler for analysis
            wrapper.on('click', '#startAnalysis', async function() {
                const button = $(this);
                button.addClass('loading disabled');

                const fileContent = sourceEditor.getValue();
                const language = $selectLanguage.find(":selected").text();

                // Clear previous results
                $('#bugFinderResults').empty().append(`
                    <div class="bug-finder-message" style="color: white">
                        <i class="spinner loading icon"></i> Scanning code for potential issues...
                    </div>
                `);

                try {
                    await analyzeCode(fileContent, language);
                } catch (error) {
                    $('#bugFinderResults').html(`
                        <div class="bug-finder-message error">
                            <i class="exclamation triangle icon"></i> Analysis failed: ${error.message}
                        </div>
                    `);
                } finally {
                    button.removeClass('loading disabled');
                }
            });
        });

        layout.on("initialised", function () {
            setDefaults();
            refreshLayoutSize();
            window.top.postMessage({ event: "initialised" }, "*");
        });

        layout.init();
    });

    let superKey = "⌘";
    if (!/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)) {
        superKey = "Ctrl";
    }

    [$runBtn].forEach(btn => {
        btn.attr("data-content", `${superKey}${btn.attr("data-content")}`);
    });

    document.querySelectorAll(".description").forEach(e => {
        e.innerText = `${superKey}${e.innerText}`;
    });

    if (PUTER) {
        puter.ui.onLaunchedWithItems(async function (items) {
            gPuterFile = items[0];
            openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
        });
        applyStyleMode("standalone");
    }

    window.onmessage = function (e) {
        if (!e.data) {
            return;
        }

        if (e.data.action === "get") {
            window.top.postMessage(JSON.parse(JSON.stringify({
                event: "getResponse",
                source_code: sourceEditor.getValue(),
                language_id: getSelectedLanguageId(),
                flavor: getSelectedLanguageFlavor(),
                stdin: stdinEditor.getValue(),
                stdout: stdoutEditor.getValue(),
                compiler_options: $compilerOptions.val(),
                command_line_arguments: $commandLineArguments.val()
            })), "*");
        } else if (e.data.action === "set") {
            if (e.data.source_code) {
                sourceEditor.setValue(e.data.source_code);
            }
            if (e.data.language_id && e.data.flavor) {
                selectLanguageByFlavorAndId(e.data.language_id, e.data.flavor);
            }
            if (e.data.stdin) {
                stdinEditor.setValue(e.data.stdin);
            }
            if (e.data.stdout) {
                stdoutEditor.setValue(e.data.stdout);
            }
            if (e.data.compiler_options) {
                $compilerOptions.val(e.data.compiler_options);
            }
            if (e.data.command_line_arguments) {
                $commandLineArguments.val(e.data.command_line_arguments);
            }
            if (e.data.api_key) {
                AUTH_HEADERS["Authorization"] = `Bearer ${e.data.api_key}`;
            }
        }
    };
});

// Document click handler
$(document).on('mousedown', (e) => {
    if (!$(e.target).closest('#selection-context-menu').length) {
        removeContextMenu();
    }
});

// Add context button click handler
$(document).on('click', '#add-context-btn', () => {
    // Your existing add context code...

    // Remove the menu after adding context
    removeContextMenu();
});

const DEFAULT_SOURCE = "\
#include <algorithm>\n\
#include <cstdint>\n\
#include <iostream>\n\
#include <limits>\n\
#include <set>\n\
#include <utility>\n\
#include <vector>\n\
\n\
using Vertex    = std::uint16_t;\n\
using Cost      = std::uint16_t;\n\
using Edge      = std::pair< Vertex, Cost >;\n\
using Graph     = std::vector< std::vector< Edge > >;\n\
using CostTable = std::vector< std::uint64_t >;\n\
\n\
constexpr auto kInfiniteCost{ std::numeric_limits< CostTable::value_type >::max() };\n\
\n\
auto dijkstra( Vertex const start, Vertex const end, Graph const & graph, CostTable & costTable )\n\
{\n\
    std::fill( costTable.begin(), costTable.end(), kInfiniteCost );\n\
    costTable[ start ] = 0;\n\
\n\
    std::set< std::pair< CostTable::value_type, Vertex > > minHeap;\n\
    minHeap.emplace( 0, start );\n\
\n\
    while ( !minHeap.empty() )\n\
    {\n\
        auto const vertexCost{ minHeap.begin()->first  };\n\
        auto const vertex    { minHeap.begin()->second };\n\
\n\
        minHeap.erase( minHeap.begin() );\n\
\n\
        if ( vertex == end )\n\
        {\n\
            break;\n\
        }\n\
\n\
        for ( auto const & neighbourEdge : graph[ vertex ] )\n\
        {\n\
            auto const & neighbour{ neighbourEdge.first };\n\
            auto const & cost{ neighbourEdge.second };\n\
\n\
            if ( costTable[ neighbour ] > vertexCost + cost )\n\
            {\n\
                minHeap.erase( { costTable[ neighbour ], neighbour } );\n\
                costTable[ neighbour ] = vertexCost + cost;\n\
                minHeap.emplace( costTable[ neighbour ], neighbour );\n\
            }\n\
        }\n\
    }\n\
\n\
    return costTable[ end ];\n\
}\n\
\n\
int main()\n\
{\n\
    constexpr std::uint16_t maxVertices{ 10000 };\n\
\n\
    Graph     graph    ( maxVertices );\n\
    CostTable costTable( maxVertices );\n\
\n\
    std::uint16_t testCases;\n\
    std::cin >> testCases;\n\
\n\
    while ( testCases-- > 0 )\n\
    {\n\
        for ( auto i{ 0 }; i < maxVertices; ++i )\n\
        {\n\
            graph[ i ].clear();\n\
        }\n\
\n\
        std::uint16_t numberOfVertices;\n\
        std::uint16_t numberOfEdges;\n\
\n\
        std::cin >> numberOfVertices >> numberOfEdges;\n\
\n\
        for ( auto i{ 0 }; i < numberOfEdges; ++i )\n\
        {\n\
            Vertex from;\n\
            Vertex to;\n\
            Cost   cost;\n\
\n\
            std::cin >> from >> to >> cost;\n\
            graph[ from ].emplace_back( to, cost );\n\
        }\n\
\n\
        Vertex start;\n\
        Vertex end;\n\
\n\
        std::cin >> start >> end;\n\
\n\
        auto const result{ dijkstra( start, end, graph, costTable ) };\n\
\n\
        if ( result == kInfiniteCost )\n\
        {\n\
            std::cout << \"NO\\n\";\n\
        }\n\
        else\n\
        {\n\
            std::cout << result << '\\n';\n\
        }\n\
    }\n\
\n\
    return 0;\n\
}\n\
";

const DEFAULT_STDIN = "\
3\n\
3 2\n\
1 2 5\n\
2 3 7\n\
1 3\n\
3 3\n\
1 2 4\n\
1 3 7\n\
2 3 1\n\
1 3\n\
3 1\n\
1 2 4\n\
1 3\n\
";

const DEFAULT_COMPILER_OPTIONS = "";
const DEFAULT_CMD_ARGUMENTS = "";
const DEFAULT_LANGUAGE_ID = 105; // C++ (GCC 14.1.0) (https://ce.judge0.com/languages/105)

function getEditorLanguageMode(languageName) {
    const DEFAULT_EDITOR_LANGUAGE_MODE = "plaintext";
    const LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE = {
        "Bash": "shell",
        "C": "c",
        "C3": "c",
        "C#": "csharp",
        "C++": "cpp",
        "Clojure": "clojure",
        "F#": "fsharp",
        "Go": "go",
        "Java": "java",
        "JavaScript": "javascript",
        "Kotlin": "kotlin",
        "Objective-C": "objective-c",
        "Pascal": "pascal",
        "Perl": "perl",
        "PHP": "php",
        "Python": "python",
        "R": "r",
        "Ruby": "ruby",
        "SQL": "sql",
        "Swift": "swift",
        "TypeScript": "typescript",
        "Visual Basic": "vb"
    }

    for (let key in LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE) {
        if (languageName.toLowerCase().startsWith(key.toLowerCase())) {
            return LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE[key];
        }
    }
    return DEFAULT_EDITOR_LANGUAGE_MODE;
}

const EXTENSIONS_TABLE = {
    "asm": { "flavor": CE, "language_id": 45 }, // Assembly (NASM 2.14.02)
    "c": { "flavor": CE, "language_id": 103 }, // C (GCC 14.1.0)
    "cpp": { "flavor": CE, "language_id": 105 }, // C++ (GCC 14.1.0)
    "cs": { "flavor": EXTRA_CE, "language_id": 29 }, // C# (.NET Core SDK 7.0.400)
    "go": { "flavor": CE, "language_id": 95 }, // Go (1.18.5)
    "java": { "flavor": CE, "language_id": 91 }, // Java (JDK 17.0.6)
    "js": { "flavor": CE, "language_id": 102 }, // JavaScript (Node.js 22.08.0)
    "lua": { "flavor": CE, "language_id": 64 }, // Lua (5.3.5)
    "pas": { "flavor": CE, "language_id": 67 }, // Pascal (FPC 3.0.4)
    "php": { "flavor": CE, "language_id": 98 }, // PHP (8.3.11)
    "py": { "flavor": EXTRA_CE, "language_id": 25 }, // Python for ML (3.11.2)
    "r": { "flavor": CE, "language_id": 99 }, // R (4.4.1)
    "rb": { "flavor": CE, "language_id": 72 }, // Ruby (2.7.0)
    "rs": { "flavor": CE, "language_id": 73 }, // Rust (1.40.0)
    "scala": { "flavor": CE, "language_id": 81 }, // Scala (2.13.2)
    "sh": { "flavor": CE, "language_id": 46 }, // Bash (5.0.0)
    "swift": { "flavor": CE, "language_id": 83 }, // Swift (5.2.3)
    "ts": { "flavor": CE, "language_id": 101 }, // TypeScript (5.6.2)
    "txt": { "flavor": CE, "language_id": 43 }, // Plain Text
};

function getLanguageForExtension(extension) {
    return EXTENSIONS_TABLE[extension] || { "flavor": CE, "language_id": 43 }; // Plain Text (https://ce.judge0.com/languages/43)
}
