const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SKILLS_DIR = path.join(__dirname, '..', '..');
const SOUL_PATH = path.join(DATA_DIR, 'soul.md');
const MEMORY_PATH = path.join(DATA_DIR, 'memory.md');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const SKILL = {
  id: 'upload',
  name: 'File Upload & Config',
  description: 'Upload skill.md, SOUL.md, MEMORY.md to configure the bot',

  async run(params) {
    const { action, type, content, filename, url, query, slug, task } = params;

    switch (action) {
      case 'install-skill-md': return this.installSkillMd(content, filename);
      case 'install-soul': return this.installSoul(content);
      case 'install-memory': return this.installMemory(content);
      case 'get-soul': return this.getSoul();
      case 'get-memory': return this.getMemory();
      case 'get-config': return this.getConfig();
      case 'from-url': return this.fromUrl(url, type);
      case 'search': return this.searchSkills(query || task || '');
      case 'install': return this.installFromClawhub(slug || query || '');
      case 'install-url': return this.fromUrl(url, 'skill');
      default: return {
        response: '🔧 **Skill Manager**\n\nDostupne akcije:\n• **search** — Pretraži ClawHub skillove\n• **install** — Instaliraj skill po nazivu\n• **install-url** — Instaliraj sa URL-a\n• **install-skill-md** — Instaliraj skill.md sadržaj',
        action: 'default'
      };
    }
  },

  // Parse skill.md format and install as executable skill
  async installSkillMd(content, filename) {
    if (!content) return { error: 'No content provided' };

    // Parse skill.md format:
    // # Skill Name
    // ## Description
    // ## Triggers
    // ## Code (js/python/bash)
    // ## Config

    const parsed = this.parseSkillMd(content);
    if (!parsed.name) return { error: 'Could not parse skill name from markdown' };

    const skillId = parsed.id || parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const targetDir = path.join(SKILLS_DIR, skillId);

    // Create skill directory
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // Write skill.json metadata
    const meta = {
      id: skillId,
      name: parsed.name,
      description: parsed.description || '',
      version: parsed.version || '1.0.0',
      icon: parsed.icon || '🔧',
      triggers: parsed.triggers || [],
      source: 'upload',
      uploadedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(targetDir, 'skill.json'), JSON.stringify(meta, null, 2));

    // Write executable code if present
    if (parsed.code) {
      const ext = parsed.language === 'python' ? '.py' : parsed.language === 'bash' ? '.sh' : '.js';

      if (ext === '.js') {
        // JavaScript skill — wrap in module format
        const wrapped = this.wrapJsSkill(parsed.code, parsed);
        fs.writeFileSync(path.join(targetDir, 'index.js'), wrapped);
      } else {
        // Non-JS — save as script, create JS wrapper that executes it
        fs.writeFileSync(path.join(targetDir, `script${ext}`), parsed.code);
        const wrapper = this.createScriptWrapper(skillId, ext, parsed);
        fs.writeFileSync(path.join(targetDir, 'index.js'), wrapper);
      }
    } else {
      // No code — create prompt-based skill
      const promptSkill = this.createPromptSkill(parsed);
      fs.writeFileSync(path.join(targetDir, 'index.js'), promptSkill);
    }

    // Save original .md
    if (filename) {
      fs.writeFileSync(path.join(targetDir, filename), content);
    }

    // Hot-reload
    const reloaded = await this.hotReload(skillId);

    // Register in skills-registry
    this.registerSkill(skillId, meta);

    return {
      success: true,
      installed: skillId,
      name: parsed.name,
      triggers: parsed.triggers,
      hasCode: !!parsed.code,
      language: parsed.language || 'prompt',
      active: reloaded,
      message: reloaded
        ? `✅ Skill '${parsed.name}' installed AND activated!`
        : `Skill installed. Restart to activate.`,
    };
  },

  parseSkillMd(content) {
    const result = { triggers: [], code: null, language: null };

    // Extract name from first H1
    const nameMatch = content.match(/^#\s+(.+)$/m);
    if (nameMatch) result.name = nameMatch[1].trim();

    // Extract icon
    const iconMatch = content.match(/^[#]+\s*(?:Icon|emoji)[:\s]*(\p{Emoji_Presentation}|\p{Extended_Pictographic})/imu);
    if (iconMatch) result.icon = iconMatch[1];

    // Extract description
    const descMatch = content.match(/##\s*Description\s*\n+(.*?)(?=\n##|\n```|$)/si);
    if (descMatch) result.description = descMatch[1].trim().split('\n')[0];

    // Extract triggers
    const triggersMatch = content.match(/##\s*Triggers?\s*\n+(.*?)(?=\n##|\n```|$)/si);
    if (triggersMatch) {
      result.triggers = triggersMatch[1]
        .split(/[,\n]/)
        .map(t => t.replace(/^[-*]\s*/, '').replace(/["`]/g, '').trim())
        .filter(Boolean);
    }

    // Extract version
    const versionMatch = content.match(/(?:version|ver)[:\s]*["`]?(\d+\.\d+\.\d+)/i);
    if (versionMatch) result.version = versionMatch[1];

    // Extract code blocks — take the largest one
    const codeBlocks = [...content.matchAll(/```(\w+)?\n([\s\S]*?)```/g)];
    if (codeBlocks.length > 0) {
      // Find the largest code block
      let largest = codeBlocks[0];
      for (const block of codeBlocks) {
        if (block[2].length > largest[2].length) largest = block;
      }
      result.language = largest[1] || 'javascript';
      result.code = largest[2].trim();
    }

    // Extract config/settings section
    const configMatch = content.match(/##\s*(?:Config|Settings|Parameters)\s*\n+(.*?)(?=\n##|\n```|$)/si);
    if (configMatch) {
      try {
        result.config = JSON.parse(configMatch[1].trim());
      } catch {
        result.configText = configMatch[1].trim();
      }
    }

    return result;
  },

  wrapJsSkill(code, parsed) {
    // If code already has module.exports, use as-is
    if (code.includes('module.exports')) return code;

    // Otherwise wrap it
    return `const SKILL = {
  id: '${parsed.id || 'custom'}',
  name: '${parsed.name}',

  async run(params) {
    ${code}
  },
};

module.exports = SKILL;
`;
  },

  createScriptWrapper(skillId, ext, parsed) {
    return `const { exec } = require('child_process');
const path = require('path');

const SKILL = {
  id: '${skillId}',
  name: '${parsed.name}',

  async run(params) {
    const scriptPath = path.join(__dirname, 'script${ext}');
    const args = JSON.stringify(params);
    const cmd = '${ext === '.py' ? 'python3' : 'bash'} "' + scriptPath + '" ' + args;

    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve({ output: stdout, warnings: stderr || null });
      });
    });
  },
};

module.exports = SKILL;
`;
  },

  createPromptSkill(parsed) {
    const prompt = parsed.description || parsed.name;
    return `const SKILL = {
  id: '${parsed.id || 'custom'}',
  name: '${parsed.name}',

  async run(params) {
    return {
      instructions: \`You are ${parsed.name}. ${prompt}\\n\\nUser request: \${params.task || params.message || ''}\`,
      systemPrompt: \`You are ${parsed.name}. ${prompt}\`,
    };
  },
};

module.exports = SKILL;
`;
  },

  // SOUL — bot personality
  async installSoul(content) {
    if (!content) return { error: 'No SOUL content provided' };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SOUL_PATH, content);

    return {
      success: true,
      type: 'soul',
      size: content.length,
      preview: content.substring(0, 200) + '...',
      message: '✅ SOUL.md installed — this bot now has a personality!',
      usage: 'Set SOUL_PATH in environment or the chat endpoint will auto-load it',
    };
  },

  getSoul() {
    if (!fs.existsSync(SOUL_PATH)) return { error: 'No SOUL.md installed' };
    return { content: fs.readFileSync(SOUL_PATH, 'utf8') };
  },

  // MEMORY — persistent context
  async installMemory(content) {
    if (!content) return { error: 'No MEMORY content provided' };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Append to existing memory (don't overwrite)
    if (fs.existsSync(MEMORY_PATH)) {
      const existing = fs.readFileSync(MEMORY_PATH, 'utf8');
      const separator = '\n\n---\n\n';
      fs.writeFileSync(MEMORY_PATH, existing + separator + content);
    } else {
      fs.writeFileSync(MEMORY_PATH, content);
    }

    return {
      success: true,
      type: 'memory',
      size: content.length,
      message: '✅ Memory updated — bot will remember this!',
    };
  },

  getMemory() {
    if (!fs.existsSync(MEMORY_PATH)) return { error: 'No MEMORY.md installed' };
    return { content: fs.readFileSync(MEMORY_PATH, 'utf8') };
  },

  getConfig() {
    const soul = fs.existsSync(SOUL_PATH) ? fs.readFileSync(SOUL_PATH, 'utf8').substring(0, 500) : null;
    const memory = fs.existsSync(MEMORY_PATH) ? fs.readFileSync(MEMORY_PATH, 'utf8').substring(0, 500) : null;

    const skillsList = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, d.name, 'index.js')))
      .map(d => d.name);

    return {
      soul: soul ? { installed: true, preview: soul } : { installed: false },
      memory: memory ? { installed: true, preview: memory } : { installed: false },
      skills: skillsList,
    };
  },

  // Install from URL
  async fromUrl(url, type) {
    if (!url) return { error: 'No URL provided' };

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const content = await res.text();

      // Auto-detect type from URL or content
      if (!type) {
        if (url.includes('skill.md') || content.includes('## Triggers')) type = 'skill';
        else if (url.includes('SOUL') || url.includes('soul')) type = 'soul';
        else if (url.includes('MEMORY') || url.includes('memory')) type = 'memory';
        else type = 'skill';
      }

      switch (type) {
        case 'skill': return this.installSkillMd(content, 'skill.md');
        case 'soul': return this.installSoul(content);
        case 'memory': return this.installMemory(content);
        default: return { error: `Unknown type: ${type}` };
      }
    } catch (err) {
      return { error: `Failed to fetch URL: ${err.message}` };
    }
  },

  // Search skills on ClawHub
  async searchSkills(query) {
    if (!query) return { response: '🔍 Napiši šta tražiš. Npr: "nađi skill za prevodjenje"' };

    try {
      const res = await fetch(`https://clawhub.com/api/skills?q=${encodeURIComponent(query)}&limit=5`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();

      if (data.skills && data.skills.length > 0) {
        // AUTO-INSTALL first result
        const best = data.skills[0];
        if (best.content || best.skill_md) {
          const result = await this.installSkillMd(best.content || best.skill_md, 'skill.md');
          if (result.success) {
            let response = `✅ Instalirao **${result.name}**!\n🎯 Triggeri: ${(result.triggers || []).join(', ') || 'none'}\n\n`;
            if (data.skills.length > 1) {
              response += `_Još ${data.skills.length - 1} rezultata:_\n`;
              data.skills.slice(1).forEach((s, i) => {
                response += `${i + 2}. ${s.icon || '🔧'} ${s.name} — _instaliraj skill ${s.slug || s.name}_\n`;
              });
            }
            return { response, success: true, installed: result.installed };
          }
        }
      }
    } catch {}

    return { response: `🔍 Nisam našao skill za "${slug}". Pošalji URL skill.md da instaliram.` };
  },

  // Install skill from ClawHub by slug/name
  async installFromClawhub(slug) {
    if (!slug) return { response: '❌ Napiši koji skill. Npr: "install skill translator"' };

    try {
      // Try ClawHub API first — exact match
      const res = await fetch(`https://clawhub.com/api/skills/${encodeURIComponent(slug)}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const skill = await res.json();
        if (skill.content || skill.skill_md) {
          const content = skill.content || skill.skill_md;
          const result = await this.installSkillMd(content, 'skill.md');

          if (result.success) {
            return {
              response: `✅ **${result.name}** instaliran i aktivan!\n\n🎯 Triggeri: ${(result.triggers || []).join(', ') || 'none'}\n\n_Piši nešto da testiraš._`,
              success: true,
              installed: result.installed,
            };
          }
          return { response: `❌ Greška: ${result.error}` };
        }
      }
    } catch {}

    // No exact match — search and auto-install first result
    try {
      const searchRes = await fetch(`https://clawhub.com/api/skills?q=${encodeURIComponent(slug)}&limit=1`, {
        signal: AbortSignal.timeout(10000),
      });
      const searchData = await searchRes.json();

      if (searchData.skills && searchData.skills.length > 0) {
        const best = searchData.skills[0];
        const content = best.content || best.skill_md;

        if (content) {
          const result = await this.installSkillMd(content, 'skill.md');
          if (result.success) {
            return {
              response: `✅ Instalirao **${result.name}** (najbolji match za "${slug}")!\n\n🎯 Triggeri: ${(result.triggers || []).join(', ') || 'none'}\n\n_Skill aktivan!_`,
              success: true,
              installed: result.installed,
            };
          }
        }

        // No content in API — try to fetch from URL
        if (best.url || best.download_url) {
          try {
            const fileRes = await fetch(best.url || best.download_url, { signal: AbortSignal.timeout(10000) });
            const fileContent = await fileRes.text();
            const result = await this.installSkillMd(fileContent, 'skill.md');
            if (result.success) {
              return {
                response: `✅ Instalirao **${result.name}** sa ClawHub-a!\n🎯 Triggeri: ${(result.triggers || []).join(', ') || 'none'}`,
                success: true,
                installed: result.installed,
              };
            }
          } catch {}
        }
      }
    } catch {}

    return { response: `❌ Nisam našao skill "${slug}" na ClawHub-u. Probaj drugačiji naziv ili pošalji URL.` };
  },

  async hotReload(slug) {
    try {
      const serverUrl = process.env.SERVER_URL || 'http://localhost:' + (process.env.PORT || 3000);
      const res = await fetch(\`\${serverUrl}/skills/reload/\${slug}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      return data.success;
    } catch { return false; }
  },

  registerSkill(slug, meta) {
    try {
      const registryPath = path.join(SKILLS_DIR, 'brain', 'skills-registry.json');
      let registry = {};
      if (fs.existsSync(registryPath)) {
        registry = JSON.parse(fs.readFileSync(registryPath));
      }
      if (!registry.skills) registry.skills = {};
      registry.skills[slug] = {
        name: meta.name || slug,
        icon: meta.icon || '🔧',
        triggers: meta.triggers || [],
        description: meta.description || '',
      };
      fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
    } catch {}
  },
};

module.exports = SKILL;
