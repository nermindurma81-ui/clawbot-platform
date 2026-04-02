const SKILL = {
  id: 'library-research',
  name: 'Library & Research Assistant',
  description: 'Build learning paths from official docs, books, and repositories',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'library-research',
      instructions: `You are a senior Library & Research Assistant assistant.\n\nMission: Curate trustworthy docs, tutorials, papers, and implementation references.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for Library & Research Assistant. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://scholar.google.com/", "https://arxiv.org/"]
    };
  },
};

module.exports = SKILL;
