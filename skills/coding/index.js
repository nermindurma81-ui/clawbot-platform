const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL = {
  id: 'coding',
  name: 'Coding Agent',
  description: 'Write, execute, and debug code in multiple languages',

  async run(params) {
    const { task, language = 'javascript', code, action = 'generate' } = params;

    if (action === 'execute' && code) {
      return await this.execute(code, language);
    }

    if (action === 'debug' && code) {
      return await this.debug(code, language, task);
    }

    // Default: generate code from task description
    return {
      task,
      language,
      instructions: `Generate ${language} code for: ${task}. Return ONLY code, no explanation.`,
      systemPrompt: this.getSystemPrompt(language),
    };
  },

  getSystemPrompt(language) {
    return `You are an expert ${language} programmer. Write clean, efficient, well-commented code.
Rules:
- Return ONLY the code, no markdown blocks, no explanation
- Handle errors properly
- Use modern best practices
- If the task is ambiguous, make reasonable assumptions`;
  },

  async execute(code, language) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawbot-code-'));
    let filePath, command;

    switch (language.toLowerCase()) {
      case 'javascript':
      case 'js':
        filePath = path.join(tmpDir, 'script.js');
        fs.writeFileSync(filePath, code);
        command = `node "${filePath}"`;
        break;

      case 'python':
      case 'py':
        filePath = path.join(tmpDir, 'script.py');
        fs.writeFileSync(filePath, code);
        command = `python3 "${filePath}"`;
        break;

      case 'bash':
      case 'sh':
        filePath = path.join(tmpDir, 'script.sh');
        fs.writeFileSync(filePath, code);
        fs.chmodSync(filePath, '755');
        command = `bash "${filePath}"`;
        break;

      case 'html':
        filePath = path.join(tmpDir, 'index.html');
        fs.writeFileSync(filePath, code);
        return {
          success: true,
          language,
          file: filePath,
          output: `HTML file created at ${filePath}`,
          preview: code.substring(0, 500),
        };

      default:
        return { error: `Unsupported language: ${language}. Supported: js, python, bash, html` };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ error: 'Execution timed out (30s limit)' });
      }, 30000);

      exec(command, { timeout: 29000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        clearTimeout(timeout);

        // Cleanup
        try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

        if (error && !stdout) {
          resolve({
            success: false,
            language,
            error: stderr || error.message,
            exitCode: error.code,
          });
        } else {
          resolve({
            success: true,
            language,
            output: stdout || '(no output)',
            warnings: stderr || null,
          });
        }
      });
    });
  },

  async debug(code, language, errorDescription) {
    return {
      action: 'debug',
      language,
      error: errorDescription,
      code,
      instructions: `Debug this ${language} code. The error is: ${errorDescription}

Original code:
${code}

Return the FIXED code only, no explanation.`,
      systemPrompt: `You are a ${language} debugging expert. Fix the code and return ONLY the corrected code.`,
    };
  },
};

module.exports = SKILL;
