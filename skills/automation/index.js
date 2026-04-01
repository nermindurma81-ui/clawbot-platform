const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', '..', 'data', 'workflows');
const RUNNING = new Map();

const SKILL = {
  id: 'automation',
  name: 'Automation Workflows',

  async run(params) {
    const { action, workflow, name, schedule, steps, webhook_url, trigger } = params;

    switch (action) {
      case 'create': return this.create(name, steps, schedule, trigger);
      case 'list': return this.list();
      case 'run': return this.run_workflow(name);
      case 'stop': return this.stop(name);
      case 'delete': return this.delete(name);
      case 'generate': return this.generate(params.task);
      default: return this.generate(params.task || name || 'Create a workflow');
    }
  },

  generate(task) {
    return {
      action: 'generate',
      task,
      instructions: `Generate an automation workflow for: "${task}"

Return JSON format:
{
  "name": "workflow-name",
  "description": "what it does",
  "trigger": { "type": "cron|webhook|manual", "config": {} },
  "steps": [
    { "action": "http_request", "url": "...", "method": "GET" },
    { "action": "transform", "expression": "..." },
    { "action": "notify", "channel": "..." }
  ]
}

Available step actions: http_request, transform, notify, script, delay, condition, email, log`,
      systemPrompt: 'You are a workflow automation expert. Design efficient, reliable workflows.',
    };
  },

  create(name, steps, schedule, trigger) {
    if (!fs.existsSync(WORKFLOWS_DIR)) fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

    const workflow = {
      name,
      steps: steps || [],
      trigger: trigger || { type: 'manual' },
      schedule: schedule || null,
      created: new Date().toISOString(),
      status: 'idle',
      runs: 0,
    };

    fs.writeFileSync(
      path.join(WORKFLOWS_DIR, `${name}.json`),
      JSON.stringify(workflow, null, 2)
    );

    return { success: true, message: `Workflow '${name}' created`, workflow };
  },

  list() {
    if (!fs.existsSync(WORKFLOWS_DIR)) return { workflows: [] };

    const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
    const workflows = files.map(f => {
      const data = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f)));
      return { name: data.name, status: data.status, runs: data.runs, trigger: data.trigger?.type };
    });

    return { workflows };
  },

  async run_workflow(name) {
    const filePath = path.join(WORKFLOWS_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) return { error: `Workflow '${name}' not found` };

    const workflow = JSON.parse(fs.readFileSync(filePath));
    const results = [];

    for (const step of workflow.steps) {
      try {
        const result = await this.executeStep(step);
        results.push({ step: step.action, success: true, result });
      } catch (err) {
        results.push({ step: step.action, success: false, error: err.message });
        break;
      }
    }

    workflow.runs = (workflow.runs || 0) + 1;
    workflow.lastRun = new Date().toISOString();
    workflow.status = 'completed';
    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2));

    return { name, results, completed: true };
  },

  async executeStep(step) {
    switch (step.action) {
      case 'http_request': {
        const res = await fetch(step.url, {
          method: step.method || 'GET',
          headers: step.headers || {},
          body: step.body ? JSON.stringify(step.body) : undefined,
          signal: AbortSignal.timeout(step.timeout || 30000),
        });
        const data = await res.text();
        return { status: res.status, data: data.substring(0, 1000) };
      }
      case 'delay':
        await new Promise(r => setTimeout(r, step.ms || 1000));
        return { delayed: step.ms || 1000 };
      case 'log':
        return { logged: step.message };
      case 'script':
        return new Promise((resolve, reject) => {
          exec(step.code || step.command, { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ output: stdout, warnings: stderr });
          });
        });
      default:
        return { action: step.action, note: 'Step type not directly executable, handled by LLM' };
    }
  },

  stop(name) {
    if (RUNNING.has(name)) {
      clearInterval(RUNNING.get(name));
      RUNNING.delete(name);
      return { stopped: name };
    }
    return { error: `No running instance of '${name}'` };
  },

  delete(name) {
    const filePath = path.join(WORKFLOWS_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) return { error: `Workflow '${name}' not found` };
    fs.unlinkSync(filePath);
    return { deleted: name };
  },
};

module.exports = SKILL;
