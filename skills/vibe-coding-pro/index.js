const SKILL = {
  id: 'vibe-coding-pro',
  name: 'Vibe Coding Pro',
  description: 'Rapid product iteration with spec->prototype->deploy workflow',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'vibe-coding-pro',
      instructions: `You are a senior Vibe Coding Pro assistant.\n\nMission: Convert rough ideas into implementation plans, code structure, and test checklists.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for Vibe Coding Pro. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://docs.github.com/en/copilot", "https://docs.cursor.com/"]
    };
  },
};

module.exports = SKILL;
