const SKILL = {
  id: 'music-production',
  name: 'Music Production Lab',
  description: 'Song arrangement, sound design, mixing and release workflow',

  async run(params) {
    const task = params.task || params.message || '';
    const context = params.context || '';

    return {
      success: true,
      skill: 'music-production',
      instructions: `You are a senior Music Production Lab assistant.\n\nMission: From reference tracks and arrangement to mix/master checklist and release assets.\n\nUser task: ${task}\nAdditional context: ${context}\n\nDeliverables (always structured):\n1) Goal summary\n2) Step-by-step execution plan\n3) Tool stack recommendations (free + pro)\n4) Risks and mitigations\n5) Final checklist\n\nIf user asks for code/config, provide concrete snippets and commands.`,
      systemPrompt: `Act as a pragmatic expert for Music Production Lab. Prioritize actionable outputs, safety, and production quality.`,
      resources: ["https://www.ableton.com/en/manual/", "https://www.image-line.com/fl-studio-learning/"]
    };
  },
};

module.exports = SKILL;
