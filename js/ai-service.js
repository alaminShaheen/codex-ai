window.AIService = class AIService {
	constructor () {
		// ADD SECRET HERE
		this.OPENROUTER_API_KEY = '';
		this.OPENAI_API_KEY= ''
		this.openAIModel = 'gpt-4o-mini';
		this.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
		this.OPEN_AI_BASE_URL = 'https://api.openai.com/v1';
		this.AI_CHAT_SYSTEM_PROMPT = "You are a helpful coding assistant. You help users write, debug and understand code.";
		this.AI_CODE_COMPLETION_SYSTEM_PROMPT = "You are a helpful coding assistant. You help users write, debug and understand code.";
	}

	async getChatResponse(userMessage, contextObject, model, debugMode = false) {
		let context = "";

		if (contextObject.code) {
			context += `Full code:\n\`\`\`${contextObject.language}\n${contextObject.code}\n\`\`\`\n\n`;
		}

		if (contextObject.input) {
			context += `Input:\n\`\`\`\n${contextObject.input}\n\`\`\`\n\n`;
		}
		if (contextObject.output) {
			context += `Output:\n\`\`\`\n${contextObject.output}\n\`\`\`\n\n`;
		}
		if (contextObject.compilerOutput && contextObject.compilerOutput.includes("Error")) {
			context += `Compiler Output:\n\`\`\`\n${contextObject.compilerOutput}\n\`\`\`\n\n`;
		}

		let prompt = context ?
			`Given this context:\n\n${context}\n${userMessage}` :
			userMessage;

		if (debugMode) {
			prompt += `
			If the user is asking for help to debug the code, help the user debug their code **without giving the solution directly**.
	
			When the user shares their code, follow these steps:
			1. **Ask clarifying questions** to help the user understand the issue. Provide line numbers as well.
			2. **Encourage debugging techniques** (e.g., logging, breaking down the problem).
			3. **Point out possible problem areas** with hints, but do not fix them outright.
			4. **Guide the user step by step**, asking them what they observe and think.
			5. **If the user struggles, provide progressively stronger hints**, but only as a last resort.
	
			Your goal is to **lead the user toward finding the solution themselves**, not to solve it for them.
	
			For example:
			- Instead of saying, *"You forgot to initialize \`x\`"*, say:
			  - *"What value does \`x\` have when it is first used? Can you check that?"*
			- Instead of saying, *"There's a syntax error on line 5"*, say:
			  - *"Try running the code and check what error message appears. What does it say?"*
	
			Be patient, encouraging, and make debugging a **learning experience**.
			`
		}


		try {
			return await this.fetchAIChatResponse(prompt, model);
		} catch (error) {
			console.error('Chat response error:', error);
			return "Sorry, I encountered an error. Please try again.";
		}
	}

	async fetchAIChatResponse(prompt, model = 'google/gemma-2-9b-it:free') {
		try {
			const response = await fetch(`${this.OPENROUTER_BASE_URL}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.OPENROUTER_API_KEY}`,
					'HTTP-Referer': window.location.href,
					'X-Title': 'Code IDE Assistant'
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{ role: "system", content: this.AI_CHAT_SYSTEM_PROMPT },
						{ role: "user", content: prompt }
					],
					// max_tokens: model.maxTokens
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'API request failed');
			}

			const data = await response.json();
			return data.choices[0].message.content;
		} catch (error) {
			console.error('AI API Error:', error);
			return "Sorry, I encountered an error. Please try again.";
		}
	}

	async getCodeCompletion(code, position, language, availableSpace) {
		const lineContent = code.split('\n')[position.lineNumber - 1];
		const currentLine = lineContent.slice(0, position.column - 1);
		const prompt = `
			Available space: ${availableSpace} lines.
			${availableSpace === 0 ? "Please provide a single-line completion." :
			`Please complete the code in ${Math.min(availableSpace, 5)} lines or less.`}
			The suggestion should be concise and fit within the available space.
			Given this code context in ${language}: ${code}
		
			Current line: "${currentLine}"
			Cursor position: column ${position.column}
			
			Provide a short, natural completion that:
			1. Matches the existing code style
			2. Completes the current statement/block
			3. Is contextually relevant
			4. Doesn't repeat existing code
			5. Stops at a natural break point (semicolon, bracket, etc.)
			
			Respond with ONLY the completion text, no explanations.
    	`;

		try {
			return await this.fetchAICodeCompletion(prompt);
		} catch (error) {
			console.error('Code completion error:', error);
			return null;
		}
	}

	async fetchAICodeCompletion(prompt, tools = null) {
		try {
			const response = await fetch(`${this.OPENROUTER_BASE_URL}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.OPENROUTER_API_KEY}`,
					'HTTP-Referer': window.location.href,
					'X-Title': 'Code IDE Assistant'
				},
				// headers: {
				// 	'Content-Type': 'application/json',
				// 	'Authorization': `Bearer ${this.OPENAI_API_KEY}`
				// },
				body: JSON.stringify({
					model: 'qwen/qwen-2.5-coder-32b-instruct',
					messages: [
						{
							role: "system",
							content: this.AI_CODE_COMPLETION_SYSTEM_PROMPT
						},
						{
							role: "user",
							content: prompt
						}
					],
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error?.message || 'API request failed');
			}

			const data = await response.json();
			return data.choices[0].message.content.trim();
		} catch (error) {
			console.error('AI API Error:', error);
			throw error;
		}
	}
}