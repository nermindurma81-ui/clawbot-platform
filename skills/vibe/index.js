const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = path.join(__dirname, '..', '..', 'data', 'projects');

const SKILL = {
  id: 'vibe',
  name: 'Vibe Coding',
  description: 'Describe what you want, get working code — agentic coding powered by Groq',

  async run(params) {
    const { task, action, project, files } = params;

    switch (action) {
      case 'create-project': return this.createProject(project || task);
      case 'file': return this.generateFile(task, project);
      case 'list': return this.listProjects();
      case 'read': return this.readFile(project, params.file);
      case 'write': return this.writeFile(project, params.file, params.content);
      case 'run': return this.runProject(project);
      case 'iterate': return this.iterate(project, task);
      default: return this.vibe(task);
    }
  },

  vibe(task) {
    return {
      action: 'vibe',
      task,
      instructions: `You are a senior full-stack developer. The user wants: "${task}"

Generate a complete, working project structure with all files needed.

Return JSON:
{
  "projectName": "kebab-case-name",
  "description": "what this app does",
  "tech": ["html", "css", "js"] or ["react"] or ["express"] etc,
  "files": [
    {
      "path": "index.html",
      "content": "full file content",
      "description": "what this file does"
    }
  ],
  "setup": ["npm install", "etc"],
  "run": "how to start the app",
  "port": 3000
}

Rules:
- Complete, working code — not snippets
- Modern best practices
- Beautiful default styling (Tailwind or clean CSS)
- Handle errors
- Mobile responsive
- Comments where needed`,
      systemPrompt: `You are an expert full-stack developer who writes clean, production-ready code. 
You create complete working applications from descriptions.
You prefer: vanilla JS for simplicity, Tailwind for styling, Node.js for backend.
You write code that works on first try.`,
    };
  },

  createProject(task) {
    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });

    const name = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const projectDir = path.join(PROJECTS_DIR, name);

    if (fs.existsSync(projectDir)) return { error: `Project '${name}' already exists` };

    fs.mkdirSync(projectDir, { recursive: true });

    const meta = {
      name,
      description: task,
      created: new Date().toISOString(),
      files: [],
      status: 'scaffolded',
    };

    fs.writeFileSync(path.join(projectDir, '.clawbot.json'), JSON.stringify(meta, null, 2));

    return {
      success: true,
      project: name,
      path: projectDir,
      next: 'Generate files with: /skills/vibe { action: "file", task: "create index.html", project: "' + name + '" }',
    };
  },

  writeFile(project, filePath, content) {
    if (!project || !filePath || !content) return { error: 'Need project, file, and content' };

    const projectDir = path.join(PROJECTS_DIR, project);
    if (!fs.existsSync(projectDir)) return { error: `Project '${project}' not found` };

    const fullPath = path.join(projectDir, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(fullPath, content);

    // Update meta
    const metaPath = path.join(projectDir, '.clawbot.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath));
      if (!meta.files.includes(filePath)) meta.files.push(filePath);
      meta.updated = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    return { success: true, file: filePath, size: content.length };
  },

  readFile(project, filePath) {
    const fullPath = path.join(PROJECTS_DIR, project, filePath);
    if (!fs.existsSync(fullPath)) return { error: `File not found: ${filePath}` };
    return { file: filePath, content: fs.readFileSync(fullPath, 'utf8') };
  },

  listProjects() {
    if (!fs.existsSync(PROJECTS_DIR)) return { projects: [] };

    const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    const projects = dirs.map(d => {
      const metaPath = path.join(PROJECTS_DIR, d.name, '.clawbot.json');
      if (fs.existsSync(metaPath)) return JSON.parse(fs.readFileSync(metaPath));
      return { name: d.name };
    });

    return { projects };
  },

  async runProject(project) {
    const projectDir = path.join(PROJECTS_DIR, project);
    if (!fs.existsSync(projectDir)) return { error: `Project '${project}' not found` };

    // Check for package.json
    const pkgPath = path.join(projectDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return new Promise((resolve) => {
        exec('npm install && npm start', { cwd: projectDir, timeout: 60000 }, (err, stdout, stderr) => {
          if (err) resolve({ error: stderr || err.message, output: stdout });
          else resolve({ success: true, output: stdout });
        });
      });
    }

    // Check for index.html
    const htmlPath = path.join(projectDir, 'index.html');
    if (fs.existsSync(htmlPath)) {
      return { success: true, type: 'static', file: htmlPath, content: fs.readFileSync(htmlPath, 'utf8').substring(0, 500) };
    }

    return { error: 'No runnable file found (need package.json or index.html)' };
  },

  iterate(project, task) {
    return {
      action: 'iterate',
      project,
      task,
      instructions: `You are iterating on the project "${project}". Task: "${task}"

Read the existing files, understand the current state, and return ONLY the files that need to change.

Return JSON:
{
  "files": [
    { "path": "file-to-change.js", "content": "full updated content" }
  ],
  "summary": "what changed and why"
}`,
      systemPrompt: 'You are iterating on existing code. Make minimal, targeted changes. Preserve existing functionality.',
    };
  },
};

module.exports = SKILL;
