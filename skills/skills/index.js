const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SKILLS_DIR = path.join(__dirname, '..', '..');
const SKILL_REGISTRY = path.join(__dirname, '..', '..', 'brain', 'skills-registry.json');
const CLAWHUB_API = 'https://registry.clawhub.com/api';
const GITHUB_RAW = 'https://raw.githubusercontent.com/openclaw/skills/main/skills';
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:' + (process.env.PORT || 3000);

const SKILL = {
  id: 'skills',
  name: 'Skill Manager',

  async run(params) {
    const { action, query, slug, source } = params;

    switch (action) {
      case 'search': return this.search(query);
      case 'install': return this.install(slug, source);
      case 'remove': return this.remove(slug);
      case 'list': return this.list();
      case 'update': return this.update(slug);
      case 'info': return this.info(slug);
      default: return { error: 'Actions: search, install, remove, list, update, info' };
    }
  },

  async search(query) {
    if (!query) return { error: 'Provide a search query' };

    try {
      // Search ClawHub
      const res = await fetch(`${CLAWHUB_API}/skills/search?q=${encodeURIComponent(query)}&limit=10`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();

      if (data.skills && data.skills.length > 0) {
        return {
          source: 'ClawHub',
          results: data.skills.map(s => ({
            slug: s.slug || s.id,
            name: s.name,
            description: s.description,
            author: s.author,
            downloads: s.downloads,
            install: `install skill: ${s.slug || s.id}`,
          })),
        };
      }
    } catch {}

    // Fallback: search GitHub awesome list categories
    const categories = {
      'coding': 'Coding Agents & IDEs',
      'web': 'Web & Frontend Development',
      'design': 'Web & Frontend Development',
      'ui': 'Web & Frontend Development',
      'tailwind': 'Web & Frontend Development',
      'react': 'Web & Frontend Development',
      'vue': 'Web & Frontend Development',
      'next': 'Web & Frontend Development',
      'automate': 'Browser & Automation',
      'browser': 'Browser & Automation',
      'api': 'DevOps & Cloud',
      'deploy': 'DevOps & Cloud',
      'docker': 'DevOps & Cloud',
      'search': 'Search & Research',
      'github': 'Git & GitHub',
      'git': 'Git & GitHub',
    };

    const matchedCategory = Object.entries(categories).find(([key]) =>
      query.toLowerCase().includes(key)
    );

    return {
      source: 'Suggestion',
      query,
      suggestion: matchedCategory
        ? `Check "${matchedCategory[1]}" category on https://github.com/VoltAgent/awesome-openclaw-skills`
        : 'Try a more specific search term',
      tip: 'You can also paste a GitHub skill URL and I will install it',
    };
  },

  async install(slug, source) {
    if (!slug) return { error: 'Provide a skill slug or GitHub URL' };

    // If it's a GitHub URL, clone it
    if (slug.includes('github.com') || slug.includes('raw.githubusercontent.com')) {
      return this.installFromGitHub(slug);
    }

    // Try ClawHub first
    try {
      const res = await fetch(`${CLAWHUB_API}/skills/${slug}`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();

      if (data.skill) {
        return this.installFromClawHub(data.skill);
      }
    } catch {}

    // Try GitHub openclaw/skills repo
    try {
      const res = await fetch(`${GITHUB_RAW}/${slug}/skill.json`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const meta = await res.json();
        return this.installFromGitHubDir(slug, meta);
      }
    } catch {}

    return {
      error: `Skill '${slug}' not found on ClawHub or GitHub`,
      tip: 'Try: search skill: <keyword> to find available skills',
    };
  },

  async installFromGitHub(url) {
    // Extract owner/repo/path from GitHub URL
    const match = url.match(/github\.com\/([^\/]+\/[^\/]+)(?:\/tree\/[^\/]+\/(.+))?/);
    if (!match) return { error: 'Invalid GitHub URL' };

    const repo = match[1];
    const skillPath = match[2] || '';
    const skillName = skillPath ? skillPath.split('/').pop() : repo.split('/')[1];

    const targetDir = path.join(SKILLS_DIR, skillName);

    if (fs.existsSync(targetDir)) {
      return { error: `Skill '${skillName}' already installed. Remove it first.` };
    }

    return new Promise((resolve) => {
      const cloneUrl = `https://github.com/${repo}.git`;
      exec(`git clone --depth 1 ${cloneUrl} "${targetDir}" 2>&1`, { timeout: 30000 }, async (err, stdout) => {
        if (err) {
          resolve({ error: `Clone failed: ${err.message}` });
          return;
        }

        // Read skill metadata
        const metaPath = path.join(targetDir, skillPath ? '' : '', 'skill.json');
        let meta = {};
        if (fs.existsSync(metaPath)) {
          meta = JSON.parse(fs.readFileSync(metaPath));
        }

        this.registerSkill(skillName, meta);

        const reloaded = await this.hotReload(skillName);

        resolve({
          success: true,
          installed: skillName,
          name: meta.name || skillName,
          description: meta.description || '',
          source: 'GitHub',
          active: reloaded,
          message: reloaded
            ? `✅ Skill '${skillName}' installed AND activated!`
            : `Skill '${skillName}' installed. Restart server to activate.`,
        });
      });
    });
  },

  async installFromClawHub(skill) {
    const skillName = skill.slug || skill.id;
    const targetDir = path.join(SKILLS_DIR, skillName);

    if (fs.existsSync(targetDir)) {
      return { error: `Skill '${skillName}' already installed` };
    }

    // Download skill files
    fs.mkdirSync(targetDir, { recursive: true });

    // Write metadata
    const meta = {
      id: skill.id || skillName,
      name: skill.name,
      description: skill.description,
      version: skill.version || '1.0.0',
      source: 'ClawHub',
    };
    fs.writeFileSync(path.join(targetDir, 'skill.json'), JSON.stringify(meta, null, 2));

    // Download code files
    if (skill.files) {
      for (const file of skill.files) {
        try {
          const res = await fetch(file.download_url || file.url, { signal: AbortSignal.timeout(10000) });
          const content = await res.text();
          const filePath = path.join(targetDir, file.name);
          fs.writeFileSync(filePath, content);
        } catch {}
      }
    }

    this.registerSkill(skillName, meta);

    const reloaded = await this.hotReload(skillName);

    return {
      success: true,
      installed: skillName,
      name: skill.name,
      description: skill.description,
      source: 'ClawHub',
      active: reloaded,
      message: reloaded
        ? `✅ Skill '${skill.name}' installed AND activated!`
        : `Skill '${skill.name}' installed. Restart to activate.`,
    };
  },

  async installFromGitHubDir(slug, meta) {
    const targetDir = path.join(SKILLS_DIR, slug);

    if (fs.existsSync(targetDir)) {
      return { error: `Skill '${slug}' already installed` };
    }

    return new Promise((resolve) => {
      exec(`git clone --depth 1 https://github.com/openclaw/skills.git /tmp/openclaw-skills-cache 2>&1`, { timeout: 60000 }, async (err) => {
        if (err) {
          resolve({ error: `Clone failed: ${err.message}` });
          return;
        }

        const srcDir = path.join('/tmp/openclaw-skills-cache', 'skills', slug);
        if (!fs.existsSync(srcDir)) {
          resolve({ error: `Skill path not found in repo` });
          return;
        }

        // Copy skill files
        exec(`cp -r "${srcDir}" "${targetDir}" 2>&1`, async (err2) => {
          if (err2) {
            resolve({ error: `Copy failed: ${err2.message}` });
            return;
          }

          this.registerSkill(slug, meta);
          const reloaded = await this.hotReload(slug);
          resolve({
            success: true,
            installed: slug,
            name: meta.name || slug,
            source: 'GitHub/OpenClaw',
            active: reloaded,
            message: reloaded
              ? `✅ Skill '${meta.name || slug}' installed AND activated!`
              : `Skill installed. Restart to activate.`,
          });
        });
      });
    });
  },

  remove(slug) {
    const targetDir = path.join(SKILLS_DIR, slug);

    if (!fs.existsSync(targetDir)) {
      return { error: `Skill '${slug}' not installed` };
    }

    // Don't remove core skills
    const protectedSkills = ['skills', 'coding', 'automation', 'tailwind', 'uiux', 'vibe', 'translator'];
    if (protectedSkills.includes(slug)) {
      return { error: `'${slug}' is a core skill. Cannot remove.` };
    }

    fs.rmSync(targetDir, { recursive: true });
    this.unregisterSkill(slug);

    return { success: true, removed: slug };
  },

  list() {
    const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .filter(d => fs.existsSync(path.join(SKILLS_DIR, d.name, 'skill.json')) || fs.existsSync(path.join(SKILLS_DIR, d.name, 'index.js')));

    const skills = dirs.map(d => {
      const metaPath = path.join(SKILLS_DIR, d.name, 'skill.json');
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)) : {};
      return {
        id: d.name,
        name: meta.name || d.name,
        description: meta.description || '',
        icon: meta.icon || '🔧',
        version: meta.version || '1.0.0',
        hasCode: fs.existsSync(path.join(SKILLS_DIR, d.name, 'index.js')),
      };
    });

    return { skills, total: skills.length };
  },

  registerSkill(slug, meta) {
    try {
      let registry = {};
      if (fs.existsSync(SKILL_REGISTRY)) {
        registry = JSON.parse(fs.readFileSync(SKILL_REGISTRY));
      }
      if (!registry.skills) registry.skills = {};

      registry.skills[slug] = {
        name: meta.name || slug,
        icon: meta.icon || '🔧',
        triggers: meta.triggers || [],
        description: meta.description || '',
      };

      fs.writeFileSync(SKILL_REGISTRY, JSON.stringify(registry, null, 2));
    } catch (err) {
      console.error('Failed to register skill:', err.message);
    }
  },

  unregisterSkill(slug) {
    try {
      if (!fs.existsSync(SKILL_REGISTRY)) return;
      const registry = JSON.parse(fs.readFileSync(SKILL_REGISTRY));
      if (registry.skills) {
        delete registry.skills[slug];
        fs.writeFileSync(SKILL_REGISTRY, JSON.stringify(registry, null, 2));
      }
    } catch {}
  },

  async hotReload(slug) {
    try {
      const res = await fetch(`${SERVER_URL}/skills/reload/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      return data.success;
    } catch {
      return false;
    }
  },

  async info(slug) {
    const metaPath = path.join(SKILLS_DIR, slug, 'skill.json');
    if (!fs.existsSync(metaPath)) return { error: `Skill '${slug}' not found` };

    const meta = JSON.parse(fs.readFileSync(metaPath));
    const hasCode = fs.existsSync(path.join(SKILLS_DIR, slug, 'index.js'));

    return {
      ...meta,
      installed: true,
      hasCode,
      path: path.join(SKILLS_DIR, slug),
    };
  },
};

module.exports = SKILL;
